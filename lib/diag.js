// @ts-check
/*
 * lib/diag.js — registro de diagnóstico en pantalla, para ver en el teléfono qué pasa al navegar (el pantallazo al
 * volver con el gesto del sistema) y ajustar las animaciones en vivo.
 *
 * Apagado no hace nada. Se enciende abriendo Kai con ?diag=1 (por ejemplo kai.musus.dev/?diag=1) y queda encendido
 * en esa pestaña hasta abrirla con ?diag=0 o cerrarla. Interruptores, también en la dirección:
 *   &nofade=1    la página que llega no hace su fundido de entrada
 *   &sr=manual   el scroll al volver lo pone solo Kai (no el navegador)
 */

const KEY = 'kai.diag';
const MAX = 400;

/** @param {() => void} fn */
function safely(fn) {
  try {
    fn();
  } catch {
    /* sessionStorage bloqueado: el registro queda apagado */
  }
}

const q = new URLSearchParams(location.search);
let on = false;
/** @type {{ nofade: boolean, sr: string }} */
const saved = { nofade: false, sr: '' };
let boots = 0;
safely(() => {
  if (q.get('diag') === '1') sessionStorage.setItem(KEY, '1');
  if (q.get('diag') === '0') sessionStorage.removeItem(KEY);
  on = sessionStorage.getItem(KEY) === '1';
  if (!on) return;
  const old = JSON.parse(sessionStorage.getItem(KEY + '.flags') || '{}');
  saved.nofade = q.has('nofade') ? q.get('nofade') === '1' : !!old.nofade;
  saved.sr = q.has('sr') ? q.get('sr') || '' : old.sr || '';
  sessionStorage.setItem(KEY + '.flags', JSON.stringify(saved));
  // cuántas veces arrancó la página en esta pestaña: si sube sin recargar a mano, hubo una recarga de verdad
  boots = Number(sessionStorage.getItem(KEY + '.boots') || 0) + 1;
  sessionStorage.setItem(KEY + '.boots', String(boots));
});

/** ¿Está encendido el registro? */
export const diagOn = on;
/** Interruptores de prueba (todos apagados si el registro no está encendido). */
export const flags = saved;

/** @type {string[]} */
const lines = [];
/** @type {HTMLElement | null} */
let logEl = null;
let paintQueued = false;

function paint() {
  paintQueued = false;
  if (!logEl) return;
  logEl.textContent = lines.slice(-80).join('\n');
  logEl.scrollTop = logEl.scrollHeight;
}

/**
 * Anota algo en el registro (si está encendido).
 * @param {string} name
 * @param {Record<string, unknown>} [data]
 */
export function diag(name, data) {
  if (!on) return;
  const extra = data
    ? ' ' +
      Object.entries(data)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
    : '';
  lines.push(`${String(Math.round(performance.now())).padStart(7)} ${name}${extra}`);
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
  if (!paintQueued) {
    paintQueued = true;
    requestAnimationFrame(paint);
  }
}

/** Anota cuándo el navegador pinta de verdad lo recién dibujado (dos cuadros después). @param {string} name */
export function diagPainted(name) {
  if (!on) return;
  requestAnimationFrame(() => requestAnimationFrame(() => diag(name)));
}

function buildPanel() {
  const root = document.documentElement;
  const box = document.createElement('div');
  box.id = 'kai-diag';
  box.style.cssText =
    'position:fixed;left:6px;right:6px;top:calc(env(safe-area-inset-top) + 6px);z-index:2000;pointer-events:none;' +
    'font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#e8ffe8;';
  const btn =
    'pointer-events:auto;font:inherit;color:#fff;background:#333;border:1px solid #666;border-radius:6px;padding:6px 8px;';
  box.innerHTML =
    `<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;pointer-events:auto;background:rgba(0,0,0,.82);padding:4px;border-radius:8px 8px 0 0">` +
    `<button data-d="hide" style="${btn}">Ocultar</button><button data-d="copy" style="${btn}">Copiar</button>` +
    `<button data-d="clear" style="${btn}">Limpiar</button>` +
    `<label style="display:flex;align-items:center;gap:4px">vuelo <input data-d="dur" type="range" min="0" max="800" step="10" style="width:90px"><span data-d="durv"></span></label>` +
    `<input data-d="ease" aria-label="Curva del vuelo" placeholder="curva (cubic-bezier…)" style="flex:1;min-width:120px;font:inherit;padding:5px;border-radius:6px;border:1px solid #666;background:#111;color:#fff">` +
    `</div><pre data-d="log" style="margin:0;max-height:32vh;overflow:auto;white-space:pre-wrap;word-break:break-all;background:rgba(0,0,0,.82);padding:4px 6px;border-radius:0 0 8px 8px;pointer-events:auto"></pre>`;
  document.body.appendChild(box);
  const $d = (/** @type {string} */ k) => /** @type {any} */ (box.querySelector(`[data-d="${k}"]`));
  logEl = $d('log');
  const dur = $d('dur');
  const cur = parseFloat(getComputedStyle(root).getPropertyValue('--kai-fly-dur')) || 0;
  dur.value = String(cur);
  $d('durv').textContent = cur + ' ms';
  dur.addEventListener('input', () => {
    root.style.setProperty('--kai-fly-dur', dur.value + 'ms');
    $d('durv').textContent = dur.value + ' ms';
  });
  $d('ease').addEventListener('change', () => {
    const v = $d('ease').value.trim();
    if (v) root.style.setProperty('--kai-fly-ease', v);
    else root.style.removeProperty('--kai-fly-ease');
    diag('curva', { v: v || '(la de siempre)' });
  });
  box.addEventListener('click', (e) => {
    const act = /** @type {HTMLElement} */ (e.target).dataset.d;
    if (act === 'hide') {
      const hidden = logEl && logEl.style.display === 'none';
      if (logEl) logEl.style.display = hidden ? '' : 'none';
      $d('hide').textContent = hidden ? 'Ocultar' : 'Mostrar';
    } else if (act === 'clear') {
      lines.length = 0;
      paint();
    } else if (act === 'copy') {
      const text = lines.join('\n');
      const done = () => ($d('copy').textContent = 'Copiado');
      // si el navegador no deja copiar, el registro queda en un cuadro de texto seleccionado para copiarlo a mano
      const byHand = () => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'pointer-events:auto;width:100%;height:30vh;font:inherit;background:#111;color:#fff';
        box.appendChild(ta);
        ta.select();
      };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, byHand);
      else byHand();
    }
  });
}

if (on) {
  buildPanel();
  const vv = window.visualViewport;
  const size = () => ({ alto: innerHeight, visible: vv ? Math.round(vv.height) : '-', y: Math.round(scrollY) });
  diag('arranque', { n: boots, nofade: saved.nofade, sr: saved.sr || 'auto', ...size() });
  let waitScroll = false;
  addEventListener('popstate', () => {
    waitScroll = true;
    diag('popstate', { hash: location.hash, ...size() });
  });
  addEventListener('hashchange', () => diag('hashchange', { hash: location.hash }));
  addEventListener('pageshow', (e) => diag('pageshow', { persisted: e.persisted }));
  addEventListener('pagehide', (e) => diag('pagehide', { persisted: e.persisted }));
  document.addEventListener('visibilitychange', () => diag('visibilidad', { estado: document.visibilityState }));
  addEventListener('resize', () => diag('resize', size()));
  if (vv) vv.addEventListener('resize', () => diag('viewport', size()));
  addEventListener(
    'scroll',
    () => {
      if (!waitScroll) return;
      waitScroll = false;
      diag('scroll', size());
    },
    { passive: true },
  );
  // el dedo en el borde: el inicio del gesto de volver del sistema
  addEventListener(
    'touchstart',
    (e) => {
      const x = e.touches[0] ? e.touches[0].clientX : -1;
      if (x >= 0 && (x < 28 || x > innerWidth - 28)) diag('toque-borde', { x: Math.round(x), ...size() });
    },
    { passive: true },
  );
}
