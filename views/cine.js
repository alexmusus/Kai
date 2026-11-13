/*
 * views/cine.js — la página de Cine: películas que no son anime, aparte de todo lo de anime. Tiene su propio
 * buscador (solo busca en Cine) y chips por tipo (Estrenos, Animación, Stop motion, Sagas…); una película puede
 * estar en varios. Lo elegido queda en la dirección (#/serie/3?t=sagas&q=madagascar&m=…) para volver atrás igual.
 *
 * Dos formas de verla (cada dispositivo recuerda la suya):
 *  - Sala (la de siempre): toda la pantalla es la película elegida, con su imagen de fondo, y abajo un carrusel de
 *    pósters. En el teléfono se elige deslizando (la del centro); en la computadora, pasando el ratón, con clic o
 *    con las flechas. Los tipos y la lupa van arriba, sobre la imagen, y filtran el carrusel.
 *  - Cuadrícula: todos los pósters de un vistazo.
 *
 * En Sagas, cada saga es una sola portada (con el póster de la saga de TMDB); al entrar (#/serie/3?t=sagas&g=…) salen
 * sus películas en orden. Solo cuentan como saga las que tienes con 2 películas o más en MEGA: de una saga de la que
 * tienes una sola (Harry Potter 1, por ejemplo), esa película no sale en Sagas ni dice que es de una saga.
 */

import { route, movieHref } from '../lib/route.js';
import {
  CINE_KINDS,
  cineKind,
  ofCineKind,
  movieTitle,
  sagaName,
  collectionItems,
  itemMeta,
} from '../models/collections.js';
import { state } from '../models/store.js';
import { shelfItems } from '../models/plans.js';
import { newEpisodes, markSeriesSeen, announceNew } from '../models/news.js';
import { seriesColor, synopsisOf } from '../models/fichas.js';
import { isLater } from '../models/progress.js';
import { langsOf } from '../models/library.js';
import { langText } from '../models/naming.js';
import { emit } from '../lib/events.js';
import { calmMotion } from '../lib/motion.js';
import { app, header, setTint, moviePosterHTML } from './components.js';
import { hydrateThumbs } from './thumbs.js';
import { ICON } from './icons.js';
import { esc, $, debounce, plural, hue, LS } from '../lib/util.js';

const KEY_VIEW = 'cineView'; // 'sala' | 'grid', de cada dispositivo

const norm = (/** @type {unknown} */ t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Lo que se dibuja en la página: la serie Cine, sus películas, cuáles son nuevas, la elegida en la sala y la saga en
 * la que se entró ('' = ninguna).
 * @type {{ s: any, si: number, items: any[], fresh: Set<string>, list: any[], sel: string, saga: string } | null}
 */
let page = null;

const isSala = () => LS.get(KEY_VIEW, 'sala') !== 'grid';
/** ¿Se elige con el ratón? (en el teléfono se elige deslizando el carrusel) */
const finePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

/** @param {any} s @param {number} si */
export function renderCine(s, si) {
  const fresh = new Set(newEpisodes(s).map((e) => e.id));
  const items = withOwnSagas(shelfItems(s)).map((x) => ({
    ...x,
    title: movieTitle(s, x.it),
    words: norm(
      [movieTitle(s, x.it), x.it.key, x.m && x.m.title, x.m && x.m.romaji, x.m && x.m.saga, x.m && x.m.year].join(' '),
    ),
  }));
  const q = route().q;
  const kind = cineKind(q.get('t'));
  page = { s, si, items, fresh, list: [], sel: q.get('m') || '', saga: kind.id === 'sagas' ? q.get('g') || '' : '' };
  const text = q.get('q') || '';
  if (isSala()) renderSala(kind, text);
  else renderGrid(kind, text);
  if (fresh.size) {
    markSeriesSeen(s);
    announceNew();
  }
}

/** Los chips de los tipos: los fijos siempre; los demás, cuando alguna película es de ese tipo. */
function chipsHTML(/** @type {import('../models/collections.js').CineKind} */ kind) {
  if (!page) return '';
  const year = new Date().getFullYear();
  const items = page.items;
  return CINE_KINDS.map((k) => {
    const of = ofCineKind(items, k, year);
    return { k, n: k.id === 'sagas' ? sagaGroups(of).length : of.length }; // en Sagas, cuántas sagas
  })
    .filter(({ k, n }) => k.fixed || n || k === kind)
    .map(
      ({ k, n }) =>
        `<button type="button" class="cine-kind${k === kind ? ' is-on' : ''}" data-kind="${k.id}" aria-pressed="${k === kind}">${esc(k.label)}<span class="cine-kind-n">${n}</span></button>`,
    )
    .join('');
}

const searchHTML = (/** @type {string} */ text, hidden = false) =>
  `<form class="cat-search cine-search" id="cine-form" role="search"${hidden ? ' hidden' : ''}>
      <span class="search-icon">${ICON.search}</span>
      <input id="cine-q" type="search" placeholder="Buscar en Cine" value="${esc(text)}" autocomplete="off" enterkeyhint="search" aria-label="Buscar en Cine">
    </form>`;

/** El botón para cambiar entre la sala y la cuadrícula. */
const viewBtn = () =>
  isSala()
    ? `<button class="icon-btn" data-cine="grid" aria-label="Ver como cuadrícula" title="Ver como cuadrícula">${ICON.grid}</button>`
    : `<button class="icon-btn" data-cine="sala" aria-label="Ver como sala" title="Ver como sala">${ICON.film}</button>`;

/**
 * Deja la saga solo en las películas de sagas de las que tienes 2 o más (a las demás se les quita, en una copia de
 * su ficha: la guardada no se toca).
 * @template {{ m: any }} T @param {T[]} items @returns {T[]}
 */
function withOwnSagas(items) {
  /** @type {Map<string, number>} */
  const n = new Map();
  for (const x of items) if (x.m && x.m.saga) n.set(x.m.saga, (n.get(x.m.saga) || 0) + 1);
  return items.map((x) => (x.m && x.m.saga && (n.get(x.m.saga) || 0) < 2 ? { ...x, m: { ...x.m, saga: '' } } : x));
}

const byYear = (/** @type {any} */ a, /** @type {any} */ b) =>
  (a.m.year || 0) - (b.m.year || 0) || a.title.localeCompare(b.title, 'es', { numeric: true });

/**
 * Las sagas como una portada cada una: sus películas en orden, el póster y la imagen de la saga (si TMDB los tiene;
 * si no, los de la primera película) y lo que toca ver (la primera que no has visto). Una saga de la que tienes una
 * sola película queda como esa película.
 * @param {any[]} list películas con saga
 */
function sagaGroups(list) {
  /** @type {Map<string, any[]>} */
  const by = new Map();
  for (const x of list) {
    const k = x.m && x.m.saga;
    if (!k) continue;
    if (!by.has(k)) by.set(k, []);
    by.get(k)?.push(x);
  }
  const out = [];
  for (const [saga, movies] of by) {
    movies.sort(byYear);
    if (movies.length < 2) continue; // ya no pasa (withOwnSagas), pero una saga de una sola no tiene portada propia
    const next = movies.find((y) => !y.plan.seen) || movies[0];
    const art = (/** @type {string} */ k) => (movies.find((y) => y.m[k]) || { m: {} }).m[k] || '';
    out.push({
      group: true,
      saga,
      movies,
      next,
      title: sagaName(saga),
      it: { key: 'saga:' + saga, eps: movies.flatMap((y) => y.it.eps) },
      m: { cover: art('sagaCover') || movies[0].m.cover, banner: art('sagaBanner') || movies[0].m.banner },
      plan: { ...next.plan, pct: 0, seen: movies.every((y) => y.plan.seen) },
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, 'es', { numeric: true }));
}

/** Las películas de ese tipo que coinciden con lo escrito, en su orden (en Sagas, las sagas; dentro de una, sus películas). */
function filtered(/** @type {import('../models/collections.js').CineKind} */ kind, /** @type {string} */ text) {
  if (!page) return [];
  const terms = norm(text).split(/\s+/).filter(Boolean);
  let list = ofCineKind(page.items, kind).filter((x) => terms.every((t) => x.words.includes(t)));
  // las sagas, una portada cada una; dentro de una, sus películas por año; los estrenos, lo más nuevo primero; lo demás A–Z
  if (kind.id === 'sagas') {
    const saga = page.saga;
    return saga ? list.filter((x) => x.m.saga === saga).sort(byYear) : sagaGroups(list);
  }
  if (kind.id === 'estrenos') list = [...list].sort((a, b) => (b.m.year || 0) - (a.m.year || 0));
  return list;
}

const countText = (/** @type {any[]} */ list, /** @type {string} */ text) =>
  list.length
    ? page && page.saga
      ? `Saga ${sagaName(page.saga)} · ${plural(list.length, 'película', 'películas')}`
      : list.some((x) => x.group)
        ? plural(list.length, 'saga', 'sagas')
        : plural(list.length, 'película', 'películas')
    : text.trim()
      ? 'Nada coincide con la búsqueda.'
      : 'Todavía no hay películas de este tipo.';

/** Dentro de una saga: el botón para volver a todas las sagas. */
const backHTML = () =>
  page && page.saga
    ? `<button type="button" class="cine-back" data-cine="sagas">${ICON.back}<span>Todas las sagas</span></button>`
    : '';

/** Adónde lleva entrar a una saga. @param {string} saga */
const sagaHref = (saga) => `#/serie/${page ? page.si : 0}?${new URLSearchParams({ t: 'sagas', g: saga })}`;

/** El póster de una saga en la cuadrícula: lleva a sus películas. */
function sagaPosterHTML(/** @type {any} */ x) {
  const seen = x.movies.filter((/** @type {any} */ y) => y.plan.seen).length;
  return `<li><a class="shelf-item is-saga" href="${sagaHref(x.saga)}" style="--h:${hue(x.title)}">
    <span class="shelf-poster">
      ${x.m.cover ? `<img src="${esc(x.m.cover)}" alt="" loading="lazy" decoding="async">` : `<span class="is-fallback"><span class="cover-glyph">${esc([...x.title.trim()][0] || '·')}</span></span>`}
    </span>
    <span class="shelf-title">${esc(x.title)}</span>
    <span class="shelf-sub">${esc(seen ? `${seen} de ${x.movies.length} vistas` : plural(x.movies.length, 'película', 'películas'))}</span>
  </a></li>`;
}
const gridItemHTML = (/** @type {any} */ x) =>
  x.group ? sagaPosterHTML(x) : page ? moviePosterHTML(page.s, page.si, x, page.fresh) : '';

/** Lo elegido (tipo y búsqueda) leído de la página. */
function current() {
  const on = /** @type {HTMLElement | null} */ (app.querySelector('.cine-kind.is-on'));
  return { kind: cineKind(on ? on.dataset.kind : ''), text: ($('#cine-q') || {}).value || '' };
}

/** Deja en la dirección el tipo, la búsqueda y la película elegida (sin redibujar). */
function keepInHash() {
  if (!page) return;
  const { kind, text } = current();
  const params = new URLSearchParams();
  if (kind.id) params.set('t', kind.id);
  if (text.trim()) params.set('q', text);
  if (page.saga) params.set('g', page.saga);
  if (isSala() && page.sel && page.list.length && page.list[0].it.key !== page.sel) params.set('m', page.sel);
  const h = `#/serie/${page.si}` + (params.toString() ? '?' + params : '');
  if (location.hash !== h) history.replaceState(history.state, '', h);
}

/* ── cuadrícula ── */

function renderGrid(/** @type {any} */ kind, /** @type {string} */ text) {
  if (!page) return;
  const { s } = page;
  setTint(seriesColor(s));
  const list = filtered(kind, text);
  page.list = list;
  app.innerHTML =
    header(esc(s.name), { actions: viewBtn() }) +
    `<main class="shelf-main cine-main">
    ${searchHTML(text)}
    <nav class="cine-kinds" id="cine-kinds" aria-label="Tipos de película">${chipsHTML(kind)}</nav>
    <div class="cine-head"><span id="cine-back">${backHTML()}</span><p class="dim shelf-count" id="cine-count" aria-live="polite">${esc(countText(list, text))}</p></div>
    <ul class="shelf" role="list" id="cine-list">${list.map(gridItemHTML).join('')}</ul>
  </main>`;
  bindCommon();
}

function paintGrid() {
  const box = $('#cine-list');
  if (!box || !page) return;
  const { kind, text } = current();
  const list = filtered(kind, text);
  page.list = list;
  const html = list.map(gridItemHTML).join('');
  if (box.dataset.sig !== html) {
    box.innerHTML = html;
    box.dataset.sig = html;
    hydrateThumbs(box);
  }
  $('#cine-count').textContent = countText(list, text);
  $('#cine-back').innerHTML = backHTML();
  keepInHash();
}

/* ── sala ── */

/** La imagen de fondo de una película: la panorámica de TMDB; si no hay, su póster. */
const backdrop = (/** @type {any} */ x) => (x && x.m && (x.m.banner || x.m.cover)) || '';

function renderSala(/** @type {any} */ kind, /** @type {string} */ text) {
  if (!page) return;
  const { s } = page;
  setTint(null);
  const list = filtered(kind, text);
  page.list = list;
  const sel = list.find((x) => x.it.key === page.sel) || list[0] || null;
  page.sel = sel ? sel.it.key : '';
  const bg = backdrop(sel);
  app.innerHTML =
    header(esc(s.name), {
      overlay: true,
      actions: `<button class="icon-btn" data-cine="search" aria-label="Buscar en Cine" aria-expanded="${!!text}">${ICON.search}</button>${viewBtn()}`,
    }) +
    `<main class="sala" id="sala">
    <div class="sala-bg" aria-hidden="true">
      <img class="sala-img is-on" alt="" decoding="async"${bg ? ` src="${esc(bg)}"` : ''} style="--h:${hue(sel ? sel.title : 'Cine')}">
      <img class="sala-img" alt="" decoding="async">
    </div>
    <div class="sala-top">
      ${searchHTML(text, !text)}
      <nav class="cine-kinds" id="cine-kinds" aria-label="Tipos de película">${chipsHTML(kind)}</nav>
    </div>
    <section class="sala-info" id="sala-info" aria-live="polite">${infoHTML(sel, text)}</section>
    <div class="sala-rail">
      <div class="cine-head"><span id="cine-back">${backHTML()}</span><p class="sala-count" id="cine-count">${esc(countText(list, text))}</p></div>
      <ul class="sala-row" id="sala-row" role="list">${railHTML(list)}</ul>
      <button class="sala-arrow is-prev" aria-label="Anteriores" tabindex="-1" hidden>${ICON.chev}</button>
      <button class="sala-arrow is-next" aria-label="Siguientes" tabindex="-1" hidden>${ICON.chev}</button>
    </div>
  </main>`;
  bindCommon();
  bindSala();
}

/** La película elegida: título, datos, sinopsis y botones. */
function infoHTML(/** @type {any} */ x, /** @type {string} */ text) {
  if (!page) return '';
  if (!x) return `<p class="sala-empty">${esc(countText([], text))}</p>`;
  if (x.group) return sagaInfoHTML(x);
  const { si, s } = page;
  const m = x.m;
  const later = isLater(s, x.it.key);
  const facts = [
    m && m.year,
    ...((m && m.genres) || []).slice(0, 3),
    langsOf(x.it.eps).length ? langText(langsOf(x.it.eps)) : '',
    x.plan.seen ? 'Vista' : x.plan.left,
  ].filter(Boolean);
  const syn = synopsisOf(m);
  return `<p class="sala-kicker">${m && m.saga ? `Saga · ${esc(sagaName(m.saga))}` : m && m.stop ? 'Stop motion' : 'Cine'}</p>
    <h2 class="sala-title">${esc(x.title)}</h2>
    ${facts.length ? `<p class="sala-facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</p>` : ''}
    ${syn ? `<p class="sala-syn">${esc(syn)}</p>` : ''}
    <div class="sala-actions">
      <a class="sala-btn is-play" href="#/play/${encodeURIComponent(x.plan.ep.id)}" data-cine="play">${ICON.play}<span>${esc(x.plan.label)}</span></a>
      <a class="sala-btn" href="${movieHref(si, x.it.key)}">Ficha</a>
      <button class="sala-btn is-square${later ? ' is-on' : ''}" data-act="later-item" data-si="${si}" data-key="${esc(x.it.key)}" aria-pressed="${later}" aria-label="Más tarde" title="Más tarde">${later ? ICON.laterOn : ICON.later}</button>
    </div>`;
}

/** Una saga elegida: cuántas películas y de qué años, cuáles son, y los botones para seguirla o entrar. */
function sagaInfoHTML(/** @type {any} */ x) {
  const movies = x.movies;
  const seen = movies.filter((/** @type {any} */ y) => y.plan.seen).length;
  const years = movies.map((/** @type {any} */ y) => y.m.year).filter(Boolean);
  const facts = [
    plural(movies.length, 'película', 'películas'),
    years.length ? (years[0] === years[years.length - 1] ? years[0] : `${years[0]} – ${years[years.length - 1]}`) : '',
    seen ? (seen === movies.length ? 'Vista' : `${seen} de ${movies.length} vistas`) : '',
  ].filter(Boolean);
  const names = movies.map((/** @type {any} */ y) => y.title + (y.m.year ? ` (${y.m.year})` : ''));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}.` : names[0];
  const next = x.next;
  // la que toca: "Ver Madagascar 2", "Continuar Madagascar 2" o, si ya viste todas, "Ver de nuevo Madagascar"
  const verb = x.plan.seen ? 'Ver de nuevo' : /^Continuar/.test(next.plan.label) ? 'Continuar' : 'Ver';
  const label = `${verb} ${next.title}`;
  return `<p class="sala-kicker">Saga</p>
    <h2 class="sala-title">${esc(x.title)}</h2>
    <p class="sala-facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</p>
    <p class="sala-syn">${esc(list)}</p>
    <div class="sala-actions">
      <a class="sala-btn is-play" href="#/play/${encodeURIComponent(next.plan.ep.id)}" data-cine="play">${ICON.play}<span>${esc(label)}</span></a>
      <a class="sala-btn" href="${sagaHref(x.saga)}">Ver las ${movies.length}</a>
    </div>`;
}

/** Los pósters del carrusel. */
function railHTML(/** @type {any[]} */ list) {
  if (!page) return '';
  const { fresh } = page;
  return list
    .map((x) => {
      const on = x.it.key === page?.sel;
      const isNew = x.it.eps.some((/** @type {any} */ e) => fresh.has(e.id));
      return `<li><button type="button" class="sala-poster${on ? ' is-on' : ''}${x.group ? ' is-saga' : ''}" data-key="${esc(x.it.key)}" aria-label="${esc(x.group ? `Saga ${x.title}` : x.title)}" aria-current="${on}" style="--h:${hue(x.title)}">
        ${x.m && x.m.cover ? `<img src="${esc(x.m.cover)}" alt="" loading="lazy" decoding="async">` : `<span class="is-fallback" data-thumb="${esc(x.it.eps[0].id)}"><span class="cover-glyph">${esc([...x.title.trim()][0] || '·')}</span></span>`}
        ${isNew ? '<span class="tile-badge">Nueva</span>' : ''}
        ${x.plan.pct && !x.plan.seen ? `<span class="tile-bar"><span style="width:${x.plan.pct}%"></span></span>` : ''}
      </button></li>`;
    })
    .join('');
}

/** Elige una película: cambia el fondo (fundido), los datos y el póster resaltado. */
function select(/** @type {string} */ key, { center = false, smooth = true, follow = false } = {}) {
  if (!page) return;
  const x = page.list.find((y) => y.it.key === key);
  if (!x) return;
  const row = $('#sala-row');
  const btn = row && /** @type {HTMLElement | null} */ (row.querySelector(`[data-key="${CSS.escape(key)}"]`));
  if (center && btn) btn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
  else if (follow && btn && row) followInRow(row, btn);
  if (page.sel === key && $('#sala-info')?.dataset.key === key) return;
  page.sel = key;
  for (const b of app.querySelectorAll('.sala-poster')) {
    const on = b === btn;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-current', String(on));
  }
  const info = $('#sala-info');
  if (info) {
    info.innerHTML = infoHTML(x, '');
    info.dataset.key = key;
    if (!calmMotion() && info.animate)
      info.animate(
        [
          { opacity: 0, transform: 'translateY(6px)' },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: 260,
          easing: 'ease-out',
        },
      );
  }
  swapBackdrop(backdrop(x), x.title);
  keepInHash();
}

/** Si el póster quedó cerca de un borde del carrusel, el carrusel se desliza para que se vean las de al lado. */
function followInRow(/** @type {HTMLElement} */ row, /** @type {HTMLElement} */ btn) {
  const r = row.getBoundingClientRect();
  const b = btn.getBoundingClientRect();
  const room = b.width * 1.6; // un póster y medio de aire
  if (b.right > r.right - room) row.scrollBy({ left: b.right - (r.right - room), behavior: 'smooth' });
  else if (b.left < r.left + room) row.scrollBy({ left: b.left - (r.left + room), behavior: 'smooth' });
}

/** El fondo nuevo aparece sobre el de antes cuando ya cargó (sin quedar un momento en negro). */
function swapBackdrop(/** @type {string} */ url, /** @type {string} */ title) {
  const imgs = /** @type {HTMLImageElement[]} */ ([...app.querySelectorAll('.sala-img')]);
  if (imgs.length < 2) return;
  const [cur, next] = imgs[0].classList.contains('is-on') ? imgs : [imgs[1], imgs[0]];
  if (url && cur.getAttribute('src') === url) return;
  const show = () => {
    if (next.dataset.want !== url) return; // ya se eligió otra mientras cargaba
    next.classList.add('is-on');
    cur.classList.remove('is-on');
  };
  next.dataset.want = url;
  next.style.setProperty('--h', String(hue(title)));
  next.classList.remove('is-on');
  if (!url) {
    next.removeAttribute('src');
    show();
    return;
  }
  next.onload = show;
  next.onerror = show;
  next.src = url;
  if (next.complete) show();
}

function paintSala() {
  const row = $('#sala-row');
  if (!row || !page) return;
  const { kind, text } = current();
  const list = filtered(kind, text);
  page.list = list;
  if (!list.some((x) => x.it.key === page?.sel)) page.sel = list[0] ? list[0].it.key : '';
  row.innerHTML = railHTML(list);
  hydrateThumbs(row);
  row.scrollLeft = 0;
  $('#cine-count').textContent = countText(list, text);
  $('#cine-back').innerHTML = backHTML();
  const info = $('#sala-info');
  if (info) {
    info.dataset.key = '';
    if (!list.length) info.innerHTML = infoHTML(null, text);
  }
  if (page.sel) select(page.sel, { center: true, smooth: false });
  keepInHash();
}

/** Las luces se apagan antes de empezar la película (sin animaciones, se va directo). */
function dimAndPlay(/** @type {MouseEvent} */ e, /** @type {HTMLAnchorElement} */ a) {
  if (calmMotion() || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  const sala = $('#sala');
  if (sala) sala.classList.add('is-dimming');
  setTimeout(() => emit('navigate', { hash: a.getAttribute('href') }), 420);
}

/* ── lo que se toca ── */

function bindCommon() {
  const form = $('#cine-form');
  form.addEventListener('submit', (/** @type {Event} */ e) => {
    e.preventDefault();
    $('#cine-q').blur();
  });
  $('#cine-q').addEventListener(
    'input',
    debounce(() => (isSala() ? paintSala() : paintGrid()), 120),
  );
  $('#cine-kinds').addEventListener('click', (/** @type {MouseEvent} */ e) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-kind]'));
    if (!b) return;
    for (const x of app.querySelectorAll('.cine-kind')) {
      const on = x === b;
      x.classList.toggle('is-on', on);
      x.setAttribute('aria-pressed', String(on));
    }
    b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (page) page.saga = ''; // otro tipo (o Sagas otra vez): se sale de la saga
    if (isSala()) paintSala();
    else paintGrid();
  });
  // volver a todas las sagas, con la que se dejó elegida
  app.querySelector('.cine-head')?.addEventListener('click', (/** @type {MouseEvent} */ e) => {
    if (!page || !(/** @type {HTMLElement} */ (e.target).closest('[data-cine="sagas"]'))) return;
    const saga = page.saga;
    emit('navigate', { hash: `#/serie/${page.si}?${new URLSearchParams({ t: 'sagas', m: 'saga:' + saga })}` });
  });
  for (const b of app.querySelectorAll('[data-cine="grid"], [data-cine="sala"]'))
    b.addEventListener('click', () => {
      if (!page) return;
      LS.set(KEY_VIEW, /** @type {HTMLElement} */ (b).dataset.cine);
      const { kind, text } = current();
      if (isSala()) renderSala(kind, text);
      else renderGrid(kind, text);
      hydrateThumbs(app);
      keepInHash();
    });
}

function bindSala() {
  const row = /** @type {HTMLElement} */ ($('#sala-row'));
  const search = app.querySelector('[data-cine="search"]');
  search?.addEventListener('click', () => {
    const form = $('#cine-form');
    const open = form.hidden;
    form.hidden = !open;
    search.setAttribute('aria-expanded', String(open));
    if (open) $('#cine-q').focus();
    else if ($('#cine-q').value) {
      $('#cine-q').value = '';
      paintSala();
    }
  });
  $('#sala-info').addEventListener('click', (/** @type {MouseEvent} */ e) => {
    const a = /** @type {HTMLAnchorElement | null} */ (
      /** @type {HTMLElement} */ (e.target).closest('[data-cine="play"]')
    );
    if (a) dimAndPlay(e, a);
  });
  // tocar un póster lo elige (y lo centra); tocar el ya elegido abre su ficha
  row.addEventListener('click', (/** @type {MouseEvent} */ e) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.sala-poster'));
    if (!b || !page) return;
    const key = /** @type {string} */ (b.dataset.key);
    const x = page.list.find((y) => y.it.key === key);
    // la ya elegida: una saga se abre (sus películas), una película abre su ficha
    if (key === page.sel) emit('navigate', { hash: x && x.group ? sagaHref(x.saga) : movieHref(page.si, key) });
    else select(key, { center: true });
  });
  if (finePointer()) {
    /* computadora: mover el ratón elige (con una pausa corta, para no cambiar el fondo al cruzar la fila), y el
     * carrusel la sigue: si la elegida queda en el borde, se desliza para mostrar las de al lado. Elige al mover el
     * ratón y no al pasar por encima: si no, al deslizarse la fila quedaba otra bajo el ratón quieto y seguía sola. */
    let hover = 0;
    row.addEventListener('mousemove', (/** @type {MouseEvent} */ e) => {
      const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.sala-poster'));
      clearTimeout(hover);
      if (b && b.dataset.key !== page?.sel)
        hover = window.setTimeout(() => select(/** @type {string} */ (b.dataset.key), { follow: true }), 160);
    });
    row.addEventListener('mouseleave', () => clearTimeout(hover));
    // la rueda del ratón (hacia arriba o abajo) desliza el carrusel de lado
    row.addEventListener(
      'wheel',
      (/** @type {WheelEvent} */ e) => {
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        e.preventDefault();
        row.scrollBy({ left: e.deltaY * 1.5 });
      },
      { passive: false },
    );
    // flechas a los lados, como en las filas del inicio
    const arrows = () => {
      const end = row.scrollWidth - row.clientWidth - 2;
      app.querySelector('.sala-arrow.is-prev')?.toggleAttribute('hidden', row.scrollLeft <= 2);
      app.querySelector('.sala-arrow.is-next')?.toggleAttribute('hidden', row.scrollLeft >= end);
    };
    row.addEventListener('scroll', () => requestAnimationFrame(arrows), { passive: true });
    for (const a of app.querySelectorAll('.sala-arrow'))
      a.addEventListener('click', () =>
        row.scrollBy({ left: (a.classList.contains('is-prev') ? -1 : 1) * row.clientWidth * 0.75, behavior: 'smooth' }),
      );
    requestAnimationFrame(arrows);
  } else {
    // teléfono: la del centro del carrusel es la elegida
    let raf = 0;
    row.addEventListener(
      'scroll',
      () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const mid = row.getBoundingClientRect().left + row.clientWidth / 2;
          let best = null;
          let dist = Infinity;
          for (const b of row.querySelectorAll('.sala-poster')) {
            const r = b.getBoundingClientRect();
            const d = Math.abs(r.left + r.width / 2 - mid);
            if (d < dist) {
              dist = d;
              best = /** @type {HTMLElement} */ (b);
            }
          }
          if (best && best.dataset.key !== page?.sel) select(/** @type {string} */ (best.dataset.key));
        });
      },
      { passive: true },
    );
  }
  // la elegida, al centro desde el principio
  requestAnimationFrame(() => {
    const on = row.querySelector('.sala-poster.is-on');
    if (on)
      row.scrollLeft +=
        on.getBoundingClientRect().left + on.clientWidth / 2 - (row.getBoundingClientRect().left + row.clientWidth / 2);
    const info = $('#sala-info');
    if (info && page) info.dataset.key = page.sel;
  });
}

/* flechas del teclado en la sala: cambian de película; Enter la pone */
document.addEventListener('keydown', (e) => {
  if (!page || !$('#sala') || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = /** @type {HTMLElement | null} */ (e.target);
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  const i = page.list.findIndex((x) => x.it.key === page?.sel);
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const next = page.list[i + (e.key === 'ArrowRight' ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    select(next.it.key, { center: true });
  } else if (e.key === 'Enter' && (!t || t === document.body || t.classList.contains('sala-poster'))) {
    const a = /** @type {HTMLAnchorElement | null} */ (app.querySelector('[data-cine="play"]'));
    if (!a) return;
    e.preventDefault();
    if (calmMotion()) emit('navigate', { hash: a.getAttribute('href') });
    else {
      $('#sala')?.classList.add('is-dimming');
      setTimeout(() => emit('navigate', { hash: a.getAttribute('href') }), 420);
    }
  }
});

/** Las etiquetas de la ficha de una película de Cine: llevan a sus tipos dentro de Cine, nunca al catálogo de anime. */
export function cineFactsHTML(/** @type {number} */ si, /** @type {any} */ m) {
  if (!m) return '';
  // la saga, solo si tienes 2 películas o más de ella
  const s = state.library && state.library.series[si];
  const mates = m.saga && s ? collectionItems(s).filter((it) => (itemMeta(s, it.key) || {}).saga === m.saga).length : 0;
  if (mates < 2) m = { ...m, saga: '' };
  const to = (/** @type {string} */ label, /** @type {Record<string, string>} */ params) =>
    `<a class="fact" href="#/serie/${si}?${new URLSearchParams(params)}">${esc(label)}</a>`;
  const y = new Date().getFullYear();
  return [
    m.year
      ? cineKind('estrenos').has(m, y)
        ? to(String(m.year), { t: 'estrenos' })
        : `<span>${esc(m.year)}</span>`
      : '',
    m.stop ? to('Stop motion', { t: 'stop-motion' }) : '',
    m.saga ? to(sagaName(m.saga), { t: 'sagas', g: m.saga }) : '',
    ...(m.genres || [])
      .slice(0, 3)
      .map((/** @type {string} */ g) => (g === 'Animación' ? to(g, { t: 'animacion' }) : `<span>${esc(g)}</span>`)),
  ].join('');
}
