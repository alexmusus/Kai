/*
 * controllers/posters.js — lo que se puede hacer con el póster de una serie o de una película sin entrar a ella (y las
 * flechas de las filas que se deslizan, en la computadora):
 *  - en el teléfono, mantenerlo presionado abre un menú rápido (ver, Más tarde, descargar, marcar como vista);
 *  - en la computadora, dejar el ratón encima un momento muestra una tarjeta con la sinopsis y el botón para ver.
 */
import { esc, plural } from '../lib/util.js';
import { state } from '../models/store.js';
import { prog, isLater, setProgress } from '../models/progress.js';
import { heroPlan, moviePlan, seasonPlan } from '../models/plans.js';
import {
  displayMeta,
  synopsisOf,
  withSeriesScore,
  seasonOwnMeta,
  seasonFullName,
  isFranchise,
} from '../models/fichas.js';
import { isCollection, collectionItems, itemMeta, movieTitle } from '../models/collections.js';
import { movieHref } from '../lib/route.js';
import { app } from '../views/components.js';
import { showSheet, closeSheet, askConfirm } from '../views/sheet.js';
import { ICON } from '../views/icons.js';
import { softRender } from './router.js';
import { sync } from './sync.js';

/**
 * El póster (de serie, de temporada o de película, no de capítulo) bajo ese elemento: su serie y, si es una película
 * o una temporada, cuál. `id` lo distingue de los demás ("3" una serie, "3#1" su segunda temporada, "5/Kimi no Na wa"
 * una película): con el mismo id para todas las temporadas, la tarjeta se quedaba con la primera.
 * @param {EventTarget | null} t
 */
function seriesPoster(t) {
  const a = /** @type {HTMLAnchorElement | null} */ (
    t instanceof Element ? t.closest('a.shelf-item[href^="#/serie/"], a.shelf-item[href^="#/pelicula/"]') : null
  );
  if (!a || !app.contains(a)) return null;
  const parts = (a.getAttribute('href') || '').split('/');
  const si = Number(parts[2]);
  const s = state.library && state.library.series[si];
  if (!s) return null;
  if (parts[1] === 'pelicula') {
    const key = decodeURIComponent(parts.slice(3).join('/'));
    const it = isCollection(s) ? collectionItems(s).find((x) => x.key === key) : null;
    return it ? { a, si, s, it, id: `${si}/${key}` } : null;
  }
  if (isCollection(s)) return null;
  const ki = parts[3] != null && parts[3] !== '' ? Number(parts[3]) : null;
  if (ki != null && s.seasons[ki]) return { a, si, s, it: null, ki, id: `${si}#${ki}` };
  return { a, si, s, it: null, ki: null, id: String(si) };
}

/** Lo que se dice de una película: el botón grande, sus datos y la sinopsis. */
function aboutMovie(s, it) {
  const plan = moviePlan(it);
  const m = itemMeta(s, it.key);
  const facts = [m && m.year, m && m.format, plan.seen ? 'Vista' : plan.left].filter(Boolean);
  return { plan, m, facts, syn: synopsisOf(m), title: movieTitle(s, it) };
}

/** La nota en la tarjeta: ★ 82. @param {any} m */
const scoreFact = (m) => (m && m.score ? `★ ${m.score}` : '');

/** Lo que se dice de una serie: el botón grande, cuánto lleva, la nota (el promedio de sus temporadas) y la sinopsis. */
function about(s) {
  const plan = heroPlan(s);
  const m = displayMeta(s);
  const seen = s.all.filter((e) => (prog(e) || {}).w).length;
  const facts = [
    scoreFact(withSeriesScore(s, m)),
    m && m.year,
    m && m.format,
    seen ? `${seen} de ${s.all.length} vistos` : plural(s.all.length, 'capítulo', 'capítulos'),
  ].filter(Boolean);
  return { plan, m, seen, facts, syn: synopsisOf(m) };
}

/** Lo que se dice de una temporada (las tarjetas del menú de temporadas): lo suyo, con su propia nota. */
function aboutSeason(s, ki) {
  const se = s.seasons[ki];
  const plan = seasonPlan(s, se);
  const m = seasonOwnMeta(s, se) || (isFranchise(s) ? null : displayMeta(s));
  const seen = se.episodes.filter((e) => (prog(e) || {}).w).length;
  const facts = [
    scoreFact(m),
    m && m.year,
    m && m.format,
    seen ? `${seen} de ${se.episodes.length} vistos` : plural(se.episodes.length, 'capítulo', 'capítulos'),
  ].filter(Boolean);
  return { plan, m, seen, facts, syn: synopsisOf(m), title: seasonFullName(s, se) };
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

/** El menú rápido de una película. @param {number} si @param {string} key */
export function openMovieSheet(si, key) {
  const s = state.library && state.library.series[si];
  const it = s && collectionItems(s).find((x) => x.key === key);
  if (!s || !it) return;
  const { plan, title } = aboutMovie(s, it);
  const attrs = `data-si="${si}" data-key="${esc(it.key)}"`;
  const pending = it.eps.some((e) => !state.saved.has(e.id));
  showSheet(
    `<div class="sheet-back" data-act="close"></div>
    <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <p class="sheet-title">${esc(title)}</p>
      <p class="sheet-sub">${esc(plan.seen ? 'Ya la viste' : plan.left ? `${plan.label}, ${plan.left}` : plan.label)}</p>
      <a class="sheet-btn" data-act="close" href="#/play/${encodeURIComponent(plan.ep.id)}">${esc(plan.label)}</a>
      <a class="sheet-btn" data-act="close" href="${movieHref(si, it.key)}">Ir a la película</a>
      <button class="sheet-btn" data-act="later-item" ${attrs}>${isLater(s, it.key) ? 'Quitar de Más tarde' : 'Ver más tarde'}</button>
      ${pending ? `<button class="sheet-btn" data-act="movie-dl" ${attrs}>Descargar</button>` : ''}
      <button class="sheet-btn" data-act="qs-seen">${plan.seen ? 'Marcar como no vista' : 'Marcar como vista'}</button>
      <button class="sheet-btn is-quiet" data-act="close">Cerrar</button>
    </div>`,
    (e) => {
      const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-act]'));
      if (!b) return;
      closeSheet(); // "later-item" y "movie-dl" los hace el manejador de siempre (el clic sigue hasta el documento)
      if (b.dataset.act === 'later-item') setTimeout(softRender, 0);
      if (b.dataset.act === 'qs-seen') {
        // una película se marca de una vez (es una sola; lo de preguntar es para una serie entera)
        const seen = !plan.seen;
        for (const ep of it.eps) {
          const d = (prog(ep) || {}).d || 0;
          setProgress(ep, seen ? d : 0, d, seen);
        }
        softRender();
        sync();
      }
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

let press = /** @type {{ timer: number, x: number, y: number, si: number, key: string | null } | null} */ (null);
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
    key: p.it ? p.it.key : null,
    timer: window.setTimeout(() => {
      if (!press) return;
      const { si, key } = press;
      press = null;
      swallowUntil = Date.now() + 800;
      navigator.vibrate?.(12);
      if (key != null) openMovieSheet(si, key);
      else openPosterSheet(si);
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
let cardId = ''; // el póster cuya tarjeta está a la vista ('' = ninguna)
let cardHref = ''; // adónde lleva su póster: tocar la tarjeta (fuera de sus botones) es como tocar el póster
let showTimer = 0;
let hideTimer = 0;

function hideCard() {
  clearTimeout(showTimer);
  cardId = '';
  card.classList.remove('is-in');
  hideTimer = window.setTimeout(() => {
    if (!cardId) card.hidden = true;
  }, 160);
}

/** Muestra la tarjeta de la serie o película junto a su póster (a la derecha; si no cabe, a la izquierda). */
function showCard(/** @type {NonNullable<ReturnType<typeof seriesPoster>>} */ p) {
  const { a, si, s, it, ki } = p;
  const mv = it ? aboutMovie(s, it) : null;
  const sr = it ? null : ki != null ? aboutSeason(s, ki) : about(s);
  const title = mv ? mv.title : /** @type {any} */ (sr).title || s.name;
  const facts = mv ? mv.facts : /** @type {any} */ (sr).facts;
  const syn = mv ? mv.syn : /** @type {any} */ (sr).syn;
  const playId = mv ? mv.plan.ep.id : /** @type {any} */ (sr).plan.next && /** @type {any} */ (sr).plan.next.id;
  const label = mv ? mv.plan.label : /** @type {any} */ (sr).plan.label;
  const later = isLater(s, it ? it.key : '');
  const laterAttrs = it
    ? `data-act="later-item" data-si="${si}" data-key="${esc(it.key)}"`
    : `data-act="later" data-si="${si}"`;
  card.innerHTML = `<p class="pc-title">${esc(title)}</p>
    <p class="pc-facts">${facts.map((/** @type {unknown} */ f) => `<span>${esc(String(f))}</span>`).join('')}</p>
    ${syn ? `<p class="pc-syn">${esc(syn)}</p>` : ''}
    <div class="pc-actions">
      ${playId ? `<a class="tv-btn is-primary" href="#/play/${encodeURIComponent(playId)}">${ICON.play}<span>${esc(label)}</span></a>` : ''}
      <button class="pc-btn" ${laterAttrs} aria-label="Más tarde" aria-pressed="${later}">${later ? ICON.laterOn : ICON.later}</button>
    </div>`;
  /* Sobre la mitad de abajo de su propio póster, casi de su mismo ancho: al lado tapaba el póster vecino, y al ir
   * hacia él el ratón quedaba sobre la tarjeta (la del vecino no salía nunca). */
  const r = (a.querySelector('.shelf-poster') || a).getBoundingClientRect();
  const W = Math.round(Math.min(260, Math.max(196, r.width + 12)));
  card.style.width = `${W}px`;
  clearTimeout(hideTimer);
  card.hidden = false;
  const H = card.offsetHeight;
  const left = Math.min(innerWidth - 12 - W, Math.max(12, r.left + r.width / 2 - W / 2));
  const top = Math.min(innerHeight - 12 - H, Math.max(12, r.top + r.height * 0.45));
  card.style.left = `${left + scrollX}px`;
  card.style.top = `${top + scrollY}px`;
  card.dataset.side = 'over';
  cardHref = a.getAttribute('href') || '';
  cardId = p.id;
  requestAnimationFrame(() => card.classList.add('is-in'));
}

const HOVER = matchMedia('(hover: hover) and (pointer: fine)');
app.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse' || !HOVER.matches) return;
  const p = seriesPoster(e.target);
  if (!p) return;
  // el "esconder" que dejó pendiente el póster del que se viene se cancela: si no, 180 ms después apagaba también
  // el temporizador de esta tarjeta (pasando de un póster al de al lado, la tarjeta no salía)
  clearTimeout(hideTimer);
  if (p.id === cardId) return;
  clearTimeout(showTimer);
  showTimer = window.setTimeout(() => showCard(p), cardId ? 120 : 550);
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
  const b = /** @type {HTMLElement | null} */ (
    /** @type {HTMLElement} */ (e.target).closest('[data-act="later"], [data-act="later-item"]')
  );
  if (b) setTimeout(() => cardId && card.contains(b) && refreshLater(b), 0);
  else if (/** @type {HTMLElement} */ (e.target).closest('a')) hideCard();
  else if (cardHref && !(/** @type {HTMLElement} */ (e.target).closest('button'))) {
    const to = cardHref;
    hideCard();
    location.hash = to;
  }
});
function refreshLater(/** @type {HTMLElement} */ b) {
  const s = state.library && state.library.series[Number(b.dataset.si)];
  if (!s) return;
  const on = isLater(s, b.dataset.key || '');
  b.setAttribute('aria-pressed', String(on));
  b.innerHTML = on ? ICON.laterOn : ICON.later;
}
// al cambiar de página o desplazarse, la tarjeta se va
addEventListener('scroll', () => cardId && hideCard(), { passive: true });
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
