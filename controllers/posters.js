/*
 * controllers/posters.js — lo que se puede hacer con el póster de una serie sin entrar a ella:
 *  - en el teléfono, mantenerlo presionado abre un menú rápido (ver, Más tarde, descargar, marcar como vista);
 *  - en la computadora, dejar el ratón encima un momento muestra una tarjeta con la sinopsis y el botón para ver.
 * También: al tocar un póster, el póster "vuela" a la portada de la serie (View Transitions, donde el navegador
 * lo tiene; si no, se entra como siempre).
 */
import { esc, plural } from '../lib/util.js';
import { state } from '../models/store.js';
import { prog, isLater, setProgress } from '../models/progress.js';
import { heroPlan } from '../models/plans.js';
import { displayMeta, synopsisOf } from '../models/fichas.js';
import { isCollection } from '../models/collections.js';
import { app } from '../views/components.js';
import { showSheet, closeSheet, askConfirm } from '../views/sheet.js';
import { ICON } from '../views/icons.js';
import { softRender } from './router.js';
import { sync } from './sync.js';

/** El póster de serie (no película ni capítulo) bajo ese elemento, y su serie. @param {EventTarget | null} t */
function seriesPoster(t) {
  const a = /** @type {HTMLAnchorElement | null} */ (
    t instanceof Element ? t.closest('a.shelf-item[href^="#/serie/"]') : null
  );
  if (!a || !app.contains(a)) return null;
  const si = Number(a.getAttribute('href').split('/')[2]);
  const s = state.library && state.library.series[si];
  return s && !isCollection(s) ? { a, si, s } : null;
}

/** Lo que se dice de una serie: el botón grande, cuánto lleva y la sinopsis. */
function about(s) {
  const plan = heroPlan(s);
  const m = displayMeta(s);
  const seen = s.all.filter((e) => (prog(e) || {}).w).length;
  const facts = [
    m && m.year,
    m && m.format,
    seen ? `${seen} de ${s.all.length} vistos` : plural(s.all.length, 'capítulo', 'capítulos'),
  ].filter(Boolean);
  return { plan, m, seen, facts, syn: synopsisOf(m) };
}

/* ── teléfono: mantener presionado ── */

/** El menú rápido de una serie. @param {number} si */
export function openPosterSheet(si) {
  const s = state.library && state.library.series[si];
  if (!s) return;
  const { plan, seen } = about(s);
  const all = seen === s.all.length;
  showSheet(
    `<div class="sheet-back" data-act="close"></div>
    <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="${esc(s.name)}">
      <p class="sheet-title">${esc(s.name)}</p>
      <p class="sheet-sub">${esc(plan.left ? `${plan.label}, ${plan.left}` : plan.label)}</p>
      ${plan.next ? `<a class="sheet-btn" data-act="close" href="#/play/${encodeURIComponent(plan.next.id)}">${esc(plan.label)}</a>` : ''}
      <a class="sheet-btn" data-act="close" href="#/serie/${si}">Ir a la serie</a>
      <button class="sheet-btn" data-act="later" data-si="${si}">${isLater(s) ? 'Quitar de Más tarde' : 'Ver más tarde'}</button>
      ${plan.next ? `<button class="sheet-btn" data-act="series-dl" data-si="${si}">Descargar los siguientes</button>` : ''}
      <button class="sheet-btn" data-act="qs-seen">${all ? 'Marcar como no vista' : 'Marcar toda como vista'}</button>
      <button class="sheet-btn is-quiet" data-act="close">Cerrar</button>
    </div>`,
    (e) => {
      const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-act]'));
      if (!b) return;
      closeSheet(); // "later" y "series-dl" los hace el manejador de siempre (el clic sigue hasta el documento)
      if (b.dataset.act === 'later') setTimeout(softRender, 0);
      if (b.dataset.act === 'qs-seen') setTimeout(() => markSeries(s, !all), 220); // después de cerrar la hoja
    },
  );
}

/** Marca (o desmarca) todos los capítulos de una serie, preguntando antes. */
async function markSeries(s, seen) {
  const ok = await askConfirm(seen ? `¿Marcar ${s.name} como vista?` : `¿Marcar ${s.name} como no vista?`, {
    detail: seen
      ? 'Todos sus capítulos quedan como vistos en este perfil.'
      : 'Todos sus capítulos quedan sin ver en este perfil.',
    ok: seen ? 'Marcar como vista' : 'Marcar como no vista',
  });
  if (!ok) return;
  for (const e of s.all) {
    const d = (prog(e) || {}).d || 0;
    setProgress(e, seen ? d : 0, d, seen);
  }
  softRender();
  sync();
}

let press = /** @type {{ timer: number, x: number, y: number, si: number } | null} */ (null);
let swallowUntil = 0; // el clic que sigue a mantener presionado no abre la serie
function cancelPress() {
  if (press) clearTimeout(press.timer);
  press = null;
}
app.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  const p = seriesPoster(e.target);
  if (!p) return;
  cancelPress();
  press = {
    x: e.clientX,
    y: e.clientY,
    si: p.si,
    timer: window.setTimeout(() => {
      if (!press) return;
      const si = press.si;
      press = null;
      swallowUntil = Date.now() + 800;
      navigator.vibrate?.(12);
      openPosterSheet(si);
    }, 480),
  };
});
app.addEventListener(
  'pointermove',
  (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
  },
  { passive: true },
);
for (const ev of ['pointerup', 'pointercancel']) app.addEventListener(ev, cancelPress);
addEventListener('scroll', cancelPress, { passive: true });
app.addEventListener(
  'click',
  (e) => {
    if (Date.now() < swallowUntil && seriesPoster(e.target)) {
      swallowUntil = 0; // solo ese clic
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true,
);
// el menú del navegador al mantener presionado un enlace (Android) no sale sobre los pósters
app.addEventListener('contextmenu', (e) => {
  if (matchMedia('(pointer: coarse)').matches && seriesPoster(e.target)) e.preventDefault();
});

/* ── computadora: la tarjeta al pasar el ratón ── */

const card = document.createElement('div');
card.className = 'poster-card';
card.hidden = true;
document.body.appendChild(card);
let cardSi = -1;
let showTimer = 0;
let hideTimer = 0;

function hideCard() {
  clearTimeout(showTimer);
  cardSi = -1;
  card.classList.remove('is-in');
  hideTimer = window.setTimeout(() => {
    if (cardSi < 0) card.hidden = true;
  }, 160);
}

/** Muestra la tarjeta de la serie junto a su póster (a la derecha; si no cabe, a la izquierda). */
function showCard(/** @type {HTMLElement} */ a, /** @type {number} */ si) {
  const s = state.library && state.library.series[si];
  if (!s) return;
  const { plan, facts, syn } = about(s);
  card.innerHTML = `<p class="pc-title">${esc(s.name)}</p>
    <p class="pc-facts">${facts.map((f) => `<span>${esc(String(f))}</span>`).join('')}</p>
    ${syn ? `<p class="pc-syn">${esc(syn)}</p>` : ''}
    <div class="pc-actions">
      ${plan.next ? `<a class="tv-btn is-primary" href="#/play/${encodeURIComponent(plan.next.id)}">${ICON.play}<span>${esc(plan.label)}</span></a>` : ''}
      <button class="pc-btn" data-act="later" data-si="${si}" aria-label="Más tarde" aria-pressed="${isLater(s)}">${isLater(s) ? ICON.laterOn : ICON.later}</button>
    </div>`;
  const r = (a.querySelector('.shelf-poster') || a).getBoundingClientRect();
  const W = 320;
  const right = r.right + 12 + W <= innerWidth - 12;
  const left = right ? r.right + 12 : Math.max(12, r.left - 12 - W);
  card.style.left = `${left + scrollX}px`;
  card.style.top = `${Math.max(scrollY + 12, r.top + scrollY)}px`;
  card.dataset.side = right ? 'right' : 'left';
  clearTimeout(hideTimer);
  card.hidden = false;
  cardSi = si;
  requestAnimationFrame(() => card.classList.add('is-in'));
}

const HOVER = matchMedia('(hover: hover) and (pointer: fine)');
app.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse' || !HOVER.matches) return;
  const p = seriesPoster(e.target);
  if (!p) return;
  if (p.si === cardSi) return clearTimeout(hideTimer);
  clearTimeout(showTimer);
  showTimer = window.setTimeout(() => showCard(p.a, p.si), cardSi >= 0 ? 120 : 550);
});
app.addEventListener('pointerout', (e) => {
  if (e.pointerType !== 'mouse') return;
  const p = seriesPoster(e.target);
  if (!p || (e.relatedTarget instanceof Node && (p.a.contains(e.relatedTarget) || card.contains(e.relatedTarget))))
    return;
  clearTimeout(showTimer);
  hideTimer = window.setTimeout(hideCard, 180);
});
card.addEventListener('pointerenter', () => clearTimeout(hideTimer));
card.addEventListener('pointerleave', () => (hideTimer = window.setTimeout(hideCard, 180)));
card.addEventListener('click', (e) => {
  const b = /** @type {HTMLElement} */ (e.target).closest('[data-act="later"]');
  if (b) setTimeout(() => cardSi >= 0 && card.querySelector('[data-act="later"]') && refreshLater(b), 0);
  else if (/** @type {HTMLElement} */ (e.target).closest('a')) hideCard();
});
function refreshLater(/** @type {HTMLElement} */ b) {
  const s = state.library && state.library.series[Number(b.dataset.si)];
  if (!s) return;
  b.setAttribute('aria-pressed', String(isLater(s)));
  b.innerHTML = isLater(s) ? ICON.laterOn : ICON.later;
}
// al cambiar de página o desplazarse, la tarjeta se va
addEventListener('scroll', () => cardSi >= 0 && hideCard(), { passive: true });
addEventListener('hashchange', hideCard);

/* ── filas que se deslizan: flechas en la computadora ── */

/** Si la fila está al principio o al final (las flechas de ese lado se esconden). @param {Element} wrap */
function paintRow(wrap) {
  const row = wrap.querySelector('.shelf.is-row');
  if (!row) return;
  const max = row.scrollWidth - row.clientWidth;
  wrap.classList.toggle('is-start', row.scrollLeft <= 4);
  wrap.classList.toggle('is-end', row.scrollLeft >= max - 4);
}
/** Las flechas: avanzan casi una pantalla de pósters. @param {HTMLElement} el @param {number} dir */
export function scrollRow(el, dir) {
  const row = el.closest('.row-scroll')?.querySelector('.shelf.is-row');
  if (row) row.scrollBy({ left: dir * row.clientWidth * 0.85, behavior: 'smooth' });
}
app.addEventListener('pointerover', (e) => {
  const wrap = e.target instanceof Element && e.target.closest('.row-scroll');
  if (wrap) paintRow(wrap);
});
app.addEventListener(
  'scroll',
  (e) => {
    const t = /** @type {Element} */ (e.target);
    if (t instanceof Element && t.matches('.shelf.is-row') && t.parentElement) paintRow(t.parentElement);
  },
  { capture: true, passive: true },
);

/* ── el póster vuela a la portada ── */

let morph = /** @type {HTMLElement | null} */ (null);
app.addEventListener(
  'click',
  (e) => {
    const p = seriesPoster(e.target);
    morph = p && !e.defaultPrevented ? /** @type {HTMLElement} */ (p.a.querySelector('.shelf-poster')) : null;
  },
  true,
);

/**
 * Dibuja la página nueva; si se llegó tocando un póster y el navegador sabe, con el póster volando a la portada.
 * @param {() => void} draw
 */
export function drawWithMorph(draw) {
  const from = morph;
  morph = null;
  const doc = /** @type {any} */ (document);
  if (
    !from ||
    !from.isConnected ||
    !doc.startViewTransition ||
    document.documentElement.classList.contains('lite') ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  )
    return draw();
  from.style.viewTransitionName = 'kai-art';
  /** @type {HTMLElement | null} */
  let to = null;
  const t = doc.startViewTransition(() => {
    from.style.viewTransitionName = '';
    draw();
    to = app.querySelector('.series-hero .hero-art') || app.querySelector('.series-hero');
    if (to) to.style.viewTransitionName = 'kai-art';
  });
  t.finished.finally(() => to && (to.style.viewTransitionName = ''));
}
