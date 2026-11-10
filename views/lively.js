// @ts-check
/*
 * views/lively.js — las animaciones al tocar del estilo Bloques (Laboratorio): la píldora que se desliza en los
 * selectores y en la barra de abajo, y los números de Tu resumen que suben hasta su valor. El resto (el ✓ de las
 * casillas, el botón de descarga que se completa, Sincronizar ahora, los plegables) es CSS de styles.css.
 *
 * Solo trabaja con Bloques, con las animaciones encendidas (sin html.calm) y si el sistema no pide reducir el
 * movimiento: con Vidrio no observa nada.
 * Todo es mover y escalar (transform), lo más barato para el teléfono.
 */

import { on } from '../lib/events.js';

const GROUPS = '.segmented, .lang-switch, .dock-tabs';
/** dónde estaba la píldora de cada grupo (por su nombre): al redibujar Ajustes, la nueva sale de ahí y se desliza */
const lastPill = new Map();
/** el último valor que se mostró de cada número de Tu resumen (en esta sesión) */
const lastNum = new Map();
/** @type {WeakSet<Element>} */
const known = new WeakSet();
/** @type {MutationObserver | null} */
let observer = null;
let queued = false;

const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const active = () => {
  const d = document.documentElement;
  return d.dataset.style === 'bloques' && !d.classList.contains('calm') && !reduceMQ.matches;
};

/** @param {HTMLElement} g */
function placePill(g) {
  const sel = /** @type {HTMLElement | null} */ (g.querySelector(':scope > .is-on'));
  if (!sel) {
    if (g.classList.contains('has-pill')) g.classList.remove('has-pill');
    return;
  }
  const key = g.getAttribute('aria-label') || g.className;
  const now = { x: sel.offsetLeft, y: sel.offsetTop, w: sel.offsetWidth, h: sel.offsetHeight };
  const set = (/** @type {typeof now} */ p) => {
    g.style.setProperty('--pill-x', p.x + 'px');
    g.style.setProperty('--pill-y', p.y + 'px');
    g.style.setProperty('--pill-w', p.w + 'px');
    g.style.setProperty('--pill-h', p.h + 'px');
  };
  const was = lastPill.get(key);
  if (!known.has(g)) {
    known.add(g);
    // un grupo recién dibujado: la píldora aparece donde estaba antes, sin animar, y luego se desliza
    g.classList.add('pill-still', 'has-pill');
    set(was || now);
    void g.offsetWidth;
    g.classList.remove('pill-still');
  }
  // (sin tocar la clase si ya la tiene: cambiarla avisaría al observador y daría otra vuelta)
  if (!g.classList.contains('has-pill')) g.classList.add('has-pill');
  set(now);
  lastPill.set(key, now);
}

/** Los números de Tu resumen ("2 h", "15") suben desde el último valor que se vio (o desde 0 la primera vez). */
function countUp() {
  document.querySelectorAll('.stat b').forEach((b, i) => {
    if (known.has(b)) return;
    known.add(b);
    const m = /^(\d+)(\D*)$/.exec((b.textContent || '').trim());
    if (!m) return;
    const to = Number(m[1]);
    const key = i + '|' + m[2];
    const from = lastNum.has(key) ? lastNum.get(key) : 0;
    lastNum.set(key, to);
    if (from === to) return;
    const t0 = performance.now();
    const dur = 650;
    const step = (/** @type {number} */ t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      b.textContent = Math.round(from + (to - from) * e) + m[2];
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function pass() {
  queued = false;
  if (!active()) return;
  document.querySelectorAll(GROUPS).forEach((g) => placePill(/** @type {HTMLElement} */ (g)));
  countUp();
}
const schedule = () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(pass);
};

/** Enciende o apaga el observador según el estilo y las animaciones (se llama al cambiar el tema). */
function refresh() {
  if (active()) {
    if (!observer) {
      observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      addEventListener('resize', schedule);
    }
    schedule();
  } else if (observer) {
    observer.disconnect();
    observer = null;
    removeEventListener('resize', schedule);
    document.querySelectorAll('.has-pill').forEach((g) => g.classList.remove('has-pill'));
  }
}

export function startLively() {
  on('theme', refresh);
  reduceMQ.addEventListener('change', refresh);
  refresh();
}
