// @ts-check
/*
 * views/thumbs.js — miniaturas de los capítulos y la etiqueta de códec ("H.264", "AV1") sobre cada una.
 * Se cargan solo cuando la tarjeta está por entrar en pantalla (IntersectionObserver), para no pedir de más a MEGA.
 * La etiqueta lleva un puntito rojo si ESTE dispositivo no puede reproducir ese formato.
 */

import { epById } from '../models/library.js';
import { thumbFor, thumbReady } from '../models/thumbs.js';
import { knownCodec, formatProblem, readCodec } from '../models/media.js';
import { esc } from '../lib/util.js';

/** Mira cuándo una tarjeta está por entrar en pantalla. @param {string} margin @param {(el: HTMLElement) => void} onSeen */
function watcher(margin, onSeen) {
  if (!('IntersectionObserver' in window)) return null;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        onSeen(/** @type {HTMLElement} */ (e.target));
      }
    },
    { rootMargin: margin },
  );
  return io;
}

/* ── miniaturas ── */

const thumbObserver = watcher('300px', loadThumb);

/** @param {HTMLElement} el @param {string} u */
function putThumb(el, u) {
  const img = new Image();
  img.alt = '';
  img.className = 'no-fade';
  img.src = u;
  el.prepend(img);
  el.classList.add('has-img');
}

/** @param {HTMLElement} el */
function loadThumb(el) {
  const ep = epById(el.dataset.thumb || '');
  if (!ep) return;
  thumbFor(ep).then((u) => {
    if (!u) return;
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.onload = () => {
      el.prepend(img);
      el.classList.add('has-img');
    };
    img.src = u;
  });
}

/** Empieza a vigilar las miniaturas y etiquetas nuevas dentro de `scope`. @param {ParentNode} [scope] */
export function hydrateThumbs(scope = document) {
  scope.querySelectorAll('[data-thumb]:not(.thumb-seen)').forEach((el) => {
    el.classList.add('thumb-seen');
    // ya vista en esta sesión: se pone de una vez, sin el cuadro vacío al volver a la página
    const ready = thumbReady(/** @type {HTMLElement} */ (el).dataset.thumb || '');
    if (ready) putThumb(/** @type {HTMLElement} */ (el), ready);
    else if (thumbObserver) thumbObserver.observe(el);
    else loadThumb(/** @type {HTMLElement} */ (el));
  });
  hydrateCodecs(scope);
}

/* ── etiqueta de códec ── */

/** @type {Record<string, string>} */
const CODEC_NAMES = {
  avc1: 'H.264',
  avc3: 'H.264',
  hvc1: 'HEVC',
  hev1: 'HEVC',
  av01: 'AV1',
  vp09: 'VP9',
  vp08: 'VP8',
  mp4v: 'MPEG-4',
};

/** Etiqueta de códec de un capítulo (vacía mientras no se sabe; se llena al verse). @param {import('../models/types.js').Episode} ep */
export function codecTagHTML(ep) {
  if (!/mp4|quicktime/.test(ep.mime || '')) return '';
  const f = knownCodec(ep);
  if (!f) return `<span class="ep-codec is-pending" data-codec="${esc(ep.id)}"></span>`;
  return codecTagInner(f);
}
/** @param {import('../models/media.js').Formats} f */
function codecTagInner(f) {
  if (!f.video) return '';
  const name = CODEC_NAMES[f.video.codec] || f.video.codec.toUpperCase();
  const prob = formatProblem(f);
  const title = prob ? `${name}: este dispositivo no lo puede reproducir` : name;
  return `<span class="ep-codec ${prob ? 'is-bad' : ''}" title="${esc(title)}">${prob ? '<i aria-hidden="true"></i>' : ''}${esc(name)}</span>`;
}

/** @type {HTMLElement[]} etiquetas por leer (máximo 2 a la vez) */
const codecQueue = [];
let codecActive = 0;
const codecObserver = watcher('200px', (thumb) => {
  const tag = thumb.querySelector('.ep-codec.is-pending');
  if (tag) codecQueue.push(/** @type {HTMLElement} */ (tag));
  pumpCodecs();
});

/** @param {ParentNode} [scope] */
function hydrateCodecs(scope = document) {
  if (!codecObserver || !navigator.onLine) return;
  // se observa la miniatura (la etiqueta pendiente está oculta y el navegador no avisa de lo oculto)
  scope.querySelectorAll('.ep-codec.is-pending:not(.codec-seen)').forEach((el) => {
    el.classList.add('codec-seen');
    const target = el.closest('.ep-thumb') || el.parentElement;
    if (target) codecObserver.observe(target);
  });
}

function pumpCodecs() {
  while (codecActive < 2 && codecQueue.length) {
    const el = /** @type {HTMLElement} */ (codecQueue.shift());
    const ep = epById(el.dataset.codec || '');
    if (!ep || !el.isConnected) continue;
    codecActive++;
    readCodec(ep)
      .then((f) => {
        if (!f) return;
        document.querySelectorAll(`.ep-codec[data-codec="${CSS.escape(ep.id)}"]`).forEach((x) => {
          x.outerHTML = codecTagInner(f);
        });
      })
      .catch(() => {})
      .finally(() => {
        codecActive--;
        pumpCodecs();
      });
  }
}
