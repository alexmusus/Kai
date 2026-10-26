/*
 * Kai, el gatito del inicio. Animación por cuadros (stop-motion) con dibujos sueltos.
 * Duerme casi siempre; a ratos se despierta, se estira, parpadea, se acicala y se vuelve a dormir.
 * Si lo tocas te mira y juega con el estambre. Nunca aparece fuera del inicio ni con un video sonando.
 */
(() => {
  const DIR = 'gato/';
  // ancho y alto de cada dibujo, en unidades del tamaño base (ya igualados para que el gato mida lo mismo)
  const P = {
    dormido: [0.6104, 0.4293], sentado: [0.5312, 0.7314], 'sentado-cierra': [0.5312, 0.7314],
    estira: [1.0641, 0.9633], echado: [1.3211, 0.5692], parado: [0.7778, 0.6249], lame: [0.7831, 0.617],
    cara: [0.8042, 0.6188], frente: [0.5359, 0.4941], asoma: [0.2975, 0.5472],
  };
  const YARN = ['estambre', 'estambre-1', 'estambre-2', 'estambre-3', 'estambre-4'];
  const YARN_RATIO = 0.7445; // ancho / alto del cuadro del estambre
  const YARN_X = 0.3405; // a qué distancia del borde derecho del cuadro cae el hilo
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const rnd = (a, b) => a + Math.random() * (b - a);
  let demo = 1; // solo para pruebas: acorta la espera entre despertares
  try { demo = Number(localStorage.getItem('kai.catDemo')) || 1; } catch {}

  const root = document.createElement('div');
  root.className = 'kcat';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `<div class="kcat-peek"><img alt="" draggable="false"></div>
    <div class="kcat-yarn"><img alt="" draggable="false"></div>
    <div class="kcat-body"><img class="is-on" alt="" draggable="false"><img alt="" draggable="false"></div>`;
  const body = root.querySelector('.kcat-body');
  const [imgA, imgB] = body.querySelectorAll('img');
  const peekBox = root.querySelector('.kcat-peek');
  const peekImg = peekBox.querySelector('img');
  const yarnBox = root.querySelector('.kcat-yarn');
  const yarnImg = yarnBox.querySelector('img');

  let on = imgA;
  let current = '';
  let token = 0; // cambia para cancelar la secuencia en curso
  let mounted = false;
  let started = false; // ya se presentó en esta sesión (no repetir la entrada cada vez que vuelves al inicio)
  let loaded = false;
  let playingYarn = false;
  let running = false; // hay una rutina en marcha

  const unit = () => (innerWidth < 700 ? 105 : 150);
  // vive abajo a la derecha, justo a la izquierda del botón flotante: distancia del borde derecho al centro del gato
  const x0 = () => 92 + unit() * 0.66;

  function preload() {
    if (loaded) return;
    loaded = true;
    for (const n of [...Object.keys(P), ...YARN]) { const i = new Image(); i.src = DIR + n + '.webp'; }
  }

  function place(img, name) {
    const u = unit();
    const [w, h] = P[name];
    img.style.width = w * u + 'px';
    img.style.height = h * u + 'px';
    img.style.right = x0() - (w * u) / 2 + 'px';
  }

  /** Cambia de dibujo: de golpe (stop-motion) o con un fundido corto. */
  async function pose(name, fade = true) {
    if (name === current) return;
    current = name;
    body.classList.toggle('is-asleep', name === 'dormido');
    if (!fade) { place(on, name); on.src = DIR + name + '.webp'; return; }
    const next = on === imgA ? imgB : imgA;
    place(next, name);
    next.src = DIR + name + '.webp';
    try { await next.decode(); } catch {}
    next.classList.add('is-on');
    on.classList.remove('is-on');
    on = next;
  }

  const paused = () => !mounted || !root.isConnected || document.hidden || document.body.classList.contains('is-playing');

  function wait(ms, t) {
    return new Promise((ok, no) => {
      const end = Date.now() + ms;
      const tick = () => {
        if (t !== token) return no(new Error('cancel'));
        if (paused()) return no(new Error('cancel'));
        const left = end - Date.now();
        if (left <= 0) return ok();
        setTimeout(tick, Math.min(left, 500));
      };
      tick();
    });
  }

  async function blink(t) {
    await pose('sentado-cierra', false);
    await wait(170, t);
    await pose('sentado', false);
  }

  async function groom(t) {
    await pose('parado');
    await wait(900, t);
    for (let i = 0; i < 3; i++) {
      await pose('lame', false); await wait(520, t);
      await pose('cara', false); await wait(620, t);
    }
    await pose('lame', false); await wait(420, t);
    await pose('parado', false); await wait(800, t);
    await pose('sentado');
  }

  async function sitAround(ms, t, canGroom = true) {
    const end = Date.now() + ms;
    let groomed = !canGroom;
    while (Date.now() < end) {
      await wait(rnd(2200, 4800), t);
      if (!groomed && Math.random() < 0.4) { groomed = true; await groom(t); } else await blink(t);
    }
  }

  async function lieDown(t) {
    await pose('echado');
    await wait(rnd(3500, 6000), t);
    await pose('dormido');
  }

  async function peek(t) {
    const u = unit();
    const [w, h] = P.asoma;
    peekBox.style.width = w * u + 'px';
    peekBox.style.height = h * u + 'px';
    peekImg.src = DIR + 'asoma.webp';
    try { await peekImg.decode(); } catch {}
    body.classList.add('is-away');
    await wait(600, t);
    peekBox.classList.add('is-out');
    await wait(2600, t);
    peekBox.classList.remove('is-out');
    await wait(900, t);
  }

  async function yarn(t) {
    const u = unit();
    const hgt = Math.min(innerHeight * 0.45, u * 2.1);
    const wid = hgt * YARN_RATIO;
    yarnBox.style.height = hgt + 'px';
    yarnBox.style.width = wid + 'px';
    yarnBox.style.right = x0() - wid * YARN_X + 'px';
    yarnImg.src = DIR + 'estambre.webp';
    try { await yarnImg.decode(); } catch {}
    yarnBox.classList.add('is-down');
    await wait(900, t);
    body.classList.add('is-away');
    // cuadros del juego: abajo, trepa, trepa, arriba dándole al estambre
    const frames = [['estambre-1', 700], ['estambre-2', 420], ['estambre-4', 420], ['estambre-2', 420], ['estambre-4', 420], ['estambre-3', 1500], ['estambre-4', 380], ['estambre-2', 380], ['estambre-1', 700]];
    for (const [n, ms] of frames) { yarnImg.src = DIR + n + '.webp'; await wait(ms, t); }
    yarnImg.src = DIR + 'estambre.webp';
    await pose('sentado', false);
    body.classList.remove('is-away');
    await wait(500, t);
    yarnBox.classList.remove('is-down');
  }

  function reset() {
    body.classList.remove('is-away');
    peekBox.classList.remove('is-out');
    yarnBox.classList.remove('is-down');
    playingYarn = false;
  }

  async function life(intro) {
    const t = ++token;
    running = true;
    try {
      if (intro) {
        if (innerWidth >= 900) await peek(t);
        await pose('sentado');
        body.classList.remove('is-away');
        await sitAround(rnd(7000, 11000), t, false);
        await lieDown(t);
      }
      for (;;) {
        await wait(rnd(35000, 80000) / demo, t);
        await pose('estira');
        await wait(1900, t);
        await pose('sentado');
        await sitAround(rnd(10000, 20000), t);
        if (Math.random() < 0.35) { await yarn(t); await sitAround(rnd(4000, 7000), t, false); } // a veces juega solo
        await lieDown(t);
      }
    } catch {
      if (t === token) { running = false; reset(); pose('dormido', false); }
    }
  }

  async function play() {
    if (playingYarn || still.matches) return;
    playingYarn = true;
    running = true;
    const t = ++token;
    try {
      await pose('frente');
      await wait(1300, t);
      await yarn(t);
      await sitAround(rnd(5000, 8000), t, false);
      await lieDown(t);
    } catch {
      playingYarn = false;
      if (t !== token) return;
      running = false;
      reset(); pose('dormido', false);
    }
    playingYarn = false;
    if (t === token) life(false);
  }

  body.addEventListener('click', play);

  // al volver a la pestaña o al terminar un video, sigue durmiendo y retoma su rutina
  function resume() {
    if (!mounted || paused() || still.matches) return;
    if (!running) life(false);
  }
  document.addEventListener('visibilitychange', resume);
  setInterval(resume, 3000);
  new MutationObserver(() => {
    if (!mounted) return;
    if (paused()) { token++; running = false; reset(); pose('dormido', false); } else resume();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  addEventListener('resize', () => { if (current) { place(on, current); } });

  window.KaiCat = {
    /** Pone al gato en la portada (si ya estaba, solo lo mueve: no reinicia lo que hacía). */
    mount(host, enabled) {
      if (!enabled || !host) { this.unmount(); return; }
      if (root.parentNode !== host) host.appendChild(root);
      host.classList.add('has-cat');
      if (mounted) { resume(); return; }
      mounted = true;
      preload();
      if (still.matches) { token++; pose('dormido', false); return; }
      const intro = !started;
      started = true;
      if (intro) { body.classList.add('is-away'); place(on, 'sentado'); } else pose('dormido', false);
      if (!paused()) life(intro); else pose('dormido', false);
    },
    unmount() {
      if (!mounted && !root.parentNode) return;
      mounted = false;
      token++;
      running = false;
      reset();
      root.remove();
      if (current) pose('dormido', false);
    },
  };
})();
