(() => {
  'use strict';

  /* ---------------------------------------------------------------
   * Programa que se "depura" (código mostrado, con colores)
   * ------------------------------------------------------------- */
  const CODE = [
    '<span class="k">public class</span> <span class="t">Main</span> {',
    '    <span class="k">static int</span> <span class="f">factorial</span>(<span class="k">int</span> n) {',
    '        <span class="k">if</span> (n &lt;= <span class="n">1</span>) <span class="k">return</span> <span class="n">1</span>;',
    '        <span class="k">int</span> r = n * <span class="f">factorial</span>(n - <span class="n">1</span>);',
    '        <span class="k">return</span> r;',
    '    }',
    '    <span class="k">public static void</span> <span class="f">main</span>(<span class="t">String</span>[] args) {',
    '        <span class="k">int</span> x = <span class="n">3</span>;',
    '        <span class="k">int</span> f = <span class="f">factorial</span>(x);',
    '        <span class="t">System</span>.out.<span class="f">println</span>(f);',
    '    }',
    '}'
  ];

  /* ---------------------------------------------------------------
   * Traza: se simula el programa y se guarda una "foto" por cada
   * línea que la JVM ejecuta. Así el depurador puede ir adelante
   * (Into / Over / Out / Continue) con la misma lógica real.
   * ------------------------------------------------------------- */
  const steps = [];
  (function buildTrace() {
    const stack = [];
    const out = [];
    const top = () => stack[stack.length - 1];
    function snap(line, note, tag) {
      top().line = line;
      steps.push({
        line,
        depth: stack.length,
        stack: stack.map(f => ({ sig: f.sig, line: f.line, vars: { ...f.vars } })),
        out: [...out],
        note,
        tag
      });
    }
    function factorial(n) {
      stack.push({ sig: 'factorial(int n)', line: 2, vars: { n } });
      snap(3, `Entramos en factorial con n = ${n}. Aparece un marco nuevo en la pila. Se evalúa if (n <= 1).`, 'Pila');
      if (n <= 1) {
        stack.pop();
        return 1;
      }
      snap(4, `n = ${n} no es ≤ 1, así que se llama a factorial(${n - 1}). Con Step Into entras; con Step Over se ejecuta entera.`, 'Recursión');
      const v = factorial(n - 1);
      top().vars.r = n * v;
      snap(5, `factorial(${n - 1}) devolvió ${v}. Ahora r = ${n} × ${v} = ${n * v}. Falta devolver r.`, 'Variables');
      stack.pop();
      return n * v;
    }
    stack.push({ sig: 'main(String[] args)', line: 7, vars: { args: '[]' } });
    snap(8, 'La JVM se suspendió en el breakpoint de esta línea. Todavía NO se ejecutó int x = 3;', 'Breakpoint');
    top().vars.x = 3;
    snap(9, 'Se ejecutó la línea anterior: x vale 3. Siguiente: llamar a factorial(x).', 'Variables');
    const res = factorial(3);
    top().vars.f = res;
    snap(10, `factorial(3) terminó y devolvió ${res}. Se guarda en f. Siguiente: imprimir f.`, 'Variables');
    out.push(String(res));
    snap(11, 'println escribió el resultado en la consola. Solo queda cerrar main.', 'Consola');
    stack.pop();
    steps.push({
      line: 0, depth: 0, stack: [], out: [...out], done: true,
      note: 'El programa terminó. La JVM envía un evento VM_DEATH y la sesión de depuración se cierra.',
      tag: 'Fin'
    });
  })();

  /* ---------------------------------------------------------------
   * Estado
   * ------------------------------------------------------------- */
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const breakpoints = new Set([4, 8]);
  let idx = -1;           // -1 = programa sin iniciar
  let selFrame = null;    // marco elegido en la pila (índice en stack[])
  let busy = false;
  let auto = false;
  let autoTimer = null;
  let logItems = [];

  const $ = id => document.getElementById(id);
  const el = {
    code: $('code'), stack: $('stack'), vars: $('vars'), varsOwner: $('varsOwner'),
    console: $('console'), note: $('note'), tag: $('tag'), log: $('log'),
    jvm: $('jvmState'), packet: $('packet'), speed: $('speed'),
    start: $('btnStart'), cont: $('btnContinue'), into: $('btnInto'), over: $('btnOver'),
    out: $('btnOut'), auto: $('btnAuto'), reset: $('btnReset')
  };

  /* ---------------------------------------------------------------
   * Código fuente
   * ------------------------------------------------------------- */
  CODE.forEach((html, i) => {
    const n = i + 1;
    const row = document.createElement('div');
    row.className = 'line';
    row.id = 'line-' + n;
    row.setAttribute('role', 'listitem');
    row.innerHTML =
      '<span class="gutter"><span class="bpdot" aria-hidden="true"></span>' +
      '<button class="num" type="button"></button>' +
      '<span class="mark" aria-hidden="true"></span></span>' +
      '<span class="src">' + html + '</span>';
    const btn = row.querySelector('.num');
    btn.textContent = n;
    btn.addEventListener('click', () => toggleBreakpoint(n));
    el.code.appendChild(row);
  });

  function toggleBreakpoint(n) {
    if (breakpoints.has(n)) breakpoints.delete(n); else breakpoints.add(n);
    renderCode();
  }

  function renderCode() {
    const cur = idx >= 0 ? steps[idx] : null;
    const sel = cur && !cur.done ? (selFrame ?? cur.stack.length - 1) : null;
    const topIdx = cur && !cur.done ? cur.stack.length - 1 : null;
    CODE.forEach((_, i) => {
      const n = i + 1;
      const row = $('line-' + n);
      const btn = row.querySelector('.num');
      const has = breakpoints.has(n);
      row.classList.toggle('has-bp', has);
      btn.setAttribute('aria-label', `Línea ${n}, breakpoint ${has ? 'activado' : 'desactivado'}. Clic para cambiar`);
      row.classList.remove('current', 'caller');
      if (sel !== null && cur.stack[sel].line === n) {
        row.classList.add(sel === topIdx ? 'current' : 'caller');
      }
    });
  }

  /* ---------------------------------------------------------------
   * Render de pila, variables, consola y explicación
   * ------------------------------------------------------------- */
  function renderStack(prevDepth) {
    el.stack.innerHTML = '';
    const cur = idx >= 0 ? steps[idx] : null;
    if (!cur || cur.done || !cur.stack.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = cur ? '(pila vacía: el programa terminó)' : '(el programa aún no se ejecuta)';
      el.stack.appendChild(li);
      return;
    }
    const sel = selFrame ?? cur.stack.length - 1;
    for (let i = cur.stack.length - 1; i >= 0; i--) {
      const f = cur.stack[i];
      const li = document.createElement('li');
      if (i === cur.stack.length - 1 && cur.stack.length > prevDepth) li.className = 'enter';
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(i === sel));
      const name = document.createElement('span');
      name.textContent = f.sig;
      const ln = document.createElement('span');
      ln.textContent = 'línea ' + f.line;
      b.append(name, ln);
      b.addEventListener('click', () => {
        selFrame = i;
        renderStack(Infinity);
        renderVars(null);
        renderCode();
      });
      li.appendChild(b);
      el.stack.appendChild(li);
    }
  }

  function renderVars(prevStack) {
    el.vars.innerHTML = '';
    const cur = idx >= 0 ? steps[idx] : null;
    if (!cur || cur.done || !cur.stack.length) {
      el.varsOwner.textContent = '';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 2; td.className = 'empty';
      td.textContent = '(sin variables)';
      tr.appendChild(td);
      el.vars.appendChild(tr);
      return;
    }
    const sel = selFrame ?? cur.stack.length - 1;
    const frame = cur.stack[sel];
    el.varsOwner.textContent = frame.sig;
    const before = prevStack && prevStack[sel] && prevStack[sel].sig === frame.sig ? prevStack[sel].vars : null;
    Object.entries(frame.vars).forEach(([k, v]) => {
      const tr = document.createElement('tr');
      if (prevStack && (!before || before[k] !== v)) tr.className = 'changed';
      const a = document.createElement('td'); a.textContent = k;
      const b = document.createElement('td'); b.textContent = String(v);
      tr.append(a, b);
      el.vars.appendChild(tr);
    });
  }

  function renderInfo() {
    const cur = idx >= 0 ? steps[idx] : null;
    el.console.textContent = cur && cur.out.length ? cur.out.join('\n') : '';
    el.note.textContent = cur ? cur.note :
      'El programa todavía no corre. Pulsa «Iniciar depuración»: el IDE lanzará la JVM con JDWP y se detendrá en los breakpoints (puntos rojos).';
    el.tag.textContent = cur ? cur.tag : '';
  }

  function setJvm(state) {
    const map = {
      idle: ['Sin iniciar', ''],
      running: ['Ejecutando…', 'running'],
      paused: ['Suspendida', 'paused'],
      done: ['Terminada', 'done']
    };
    el.jvm.textContent = map[state][0];
    el.jvm.className = 'badge ' + map[state][1];
  }

  function renderButtons() {
    const started = idx >= 0;
    const done = started && steps[idx].done;
    const can = started && !done && !busy;
    el.start.disabled = started || busy;
    el.cont.disabled = !can;
    el.into.disabled = !can;
    el.over.disabled = !can;
    el.out.disabled = !can;
    el.auto.disabled = done || (busy && !auto);
    el.auto.textContent = auto ? '⏸ Pausar demo' : '🎬 Demo automática';
    el.reset.disabled = !started && !auto;
  }

  /* ---------------------------------------------------------------
   * Mensajes JDWP (registro y paquete animado)
   * ------------------------------------------------------------- */
  function pushLog(dir, text) {
    logItems.push({ dir, text });
    logItems = logItems.slice(-6);
    el.log.innerHTML = '';
    logItems.forEach(it => {
      const li = document.createElement('li');
      if (it.dir === 'back') li.className = 'back';
      const b = document.createElement('b');
      b.textContent = it.dir === 'back' ? 'JVM → IDE ' : 'IDE → JVM ';
      li.append(b, it.text);
      el.log.appendChild(li);
    });
  }

  function flyPacket(text, reverse) {
    if (reduceMotion || !el.packet.animate) return;
    const p = el.packet;
    p.hidden = false;
    p.textContent = text;
    p.classList.toggle('reply', !!reverse);
    const wire = p.parentElement.getBoundingClientRect().width;
    const w = p.getBoundingClientRect().width;
    const from = reverse ? wire - w : 0;
    const to = reverse ? 0 : wire - w;
    const a = p.animate(
      [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }],
      { duration: 380, easing: 'ease-in-out', fill: 'forwards' }
    );
    a.onfinish = () => { if (reverse) p.hidden = true; };
  }

  /* ---------------------------------------------------------------
   * Lógica del depurador
   * ------------------------------------------------------------- */
  function target(kind) {
    const last = steps.length - 1;
    if (idx < 0) {
      let j = 0;
      while (j < last && !breakpoints.has(steps[j].line)) j++;
      return j;
    }
    const cur = steps[idx];
    let j = idx + 1;
    if (kind === 'into') return Math.min(j, last);
    if (kind === 'over') { while (j < last && steps[j].depth > cur.depth) j++; return j; }
    if (kind === 'out')  { while (j < last && steps[j].depth >= cur.depth) j++; return j; }
    while (j < last && !breakpoints.has(steps[j].line)) j++; // continue
    return j;
  }

  function perform(kind) {
    if (busy) return;
    const started = idx >= 0;
    if (started && steps[idx].done) return;
    busy = true;
    const next = target(kind);
    const step = steps[next];

    // 1) Mensajes que el IDE envía a la JVM
    let first;
    if (kind === 'start') {
      pushLog('go', '-agentlib:jdwp=...suspend=y (arranca la JVM)');
      breakpoints.forEach(l => pushLog('go', `EventRequest.Set BREAKPOINT línea ${l}`));
      pushLog('go', 'VirtualMachine.Resume');
      first = 'Resume';
    } else if (kind === 'continue') {
      pushLog('go', 'VirtualMachine.Resume');
      first = 'Resume';
    } else {
      pushLog('go', `EventRequest.Set STEP ${kind.toUpperCase()}`);
      pushLog('go', 'VirtualMachine.Resume');
      first = 'STEP ' + kind.toUpperCase();
    }
    flyPacket(first, false);
    setJvm('running');
    renderButtons();

    // 2) La JVM ejecuta y se detiene; responde con un evento
    const wait = reduceMotion ? 0 : 450;
    setTimeout(() => {
      const prev = idx >= 0 ? steps[idx] : null;
      const prevDepth = prev ? prev.stack.length : 0;
      const prevStack = prev ? prev.stack : null;
      idx = next;
      selFrame = null;

      const evt = step.done ? 'VM_DEATH'
        : (kind === 'into' || kind === 'over' || kind === 'out') ? 'STEP' : 'BREAKPOINT';
      pushLog('back', `Event.Composite ${evt}`);
      flyPacket(evt, true);
      if (!step.done) {
        pushLog('go', 'ThreadReference.Frames → pila');
        pushLog('go', 'StackFrame.GetValues → variables');
      }

      renderStack(prevDepth);
      renderVars(prevStack);
      renderCode();
      renderInfo();
      setJvm(step.done ? 'done' : 'paused');
      busy = false;
      if (step.done) stopAuto();
      renderButtons();
    }, wait);
  }

  /* ---------------------------------------------------------------
   * Demo automática
   * ------------------------------------------------------------- */
  function delay() { return [0, 3200, 2400, 1700, 1100, 700][+el.speed.value]; }

  function tick() {
    if (!auto) return;
    if (idx >= 0 && steps[idx].done) { stopAuto(); return; }
    perform(idx < 0 ? 'start' : 'into');
    autoTimer = setTimeout(tick, delay());
  }

  function startAuto() { auto = true; renderButtons(); tick(); }
  function stopAuto() {
    auto = false;
    clearTimeout(autoTimer);
    autoTimer = null;
    renderButtons();
  }

  function reset() {
    stopAuto();
    idx = -1; selFrame = null; busy = false; logItems = [];
    el.log.innerHTML = '';
    el.packet.hidden = true;
    setJvm('idle');
    renderStack(0); renderVars(null); renderCode(); renderInfo(); renderButtons();
  }

  /* ---------------------------------------------------------------
   * Eventos
   * ------------------------------------------------------------- */
  el.start.addEventListener('click', () => perform('start'));
  el.cont.addEventListener('click', () => { stopAuto(); perform('continue'); });
  el.into.addEventListener('click', () => { stopAuto(); perform('into'); });
  el.over.addEventListener('click', () => { stopAuto(); perform('over'); });
  el.out.addEventListener('click', () => { stopAuto(); perform('out'); });
  el.auto.addEventListener('click', () => (auto ? stopAuto() : startAuto()));
  el.reset.addEventListener('click', reset);

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input')) return;
    const k = e.key.toLowerCase();
    if (k === ' ' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      if (!el.auto.disabled) el.auto.click();
      return;
    }
    const map = { c: el.cont, i: el.into, o: el.over, u: el.out };
    if (map[k] && !map[k].disabled) { stopAuto(); map[k].click(); }
  });

  reset();
})();
