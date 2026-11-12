/*
 * views/cine.js — la página de Cine: películas que no son anime, aparte de todo lo de anime. Tiene su propio
 * buscador (solo busca en Cine) y chips por tipo (Estrenos, Animación, Stop motion, Sagas…); una película puede
 * estar en varios. Lo elegido queda en la dirección (#/serie/3?t=sagas&q=madagascar) para volver atrás igual.
 */

import { route } from '../lib/route.js';
import { CINE_KINDS, cineKind, ofCineKind, movieTitle, sagaName } from '../models/collections.js';
import { shelfItems } from '../models/plans.js';
import { newEpisodes, markSeriesSeen, announceNew } from '../models/news.js';
import { seriesColor } from '../models/fichas.js';
import { app, header, setTint, moviePosterHTML } from './components.js';
import { hydrateThumbs } from './thumbs.js';
import { ICON } from './icons.js';
import { esc, $, debounce, plural } from '../lib/util.js';

const norm = (/** @type {unknown} */ t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Lo que se dibuja en la página: la serie Cine, sus películas y cuáles son nuevas. */
let page = /** @type {{ s: any, si: number, items: any[], fresh: Set<string> } | null} */ (null);

/** @param {any} s @param {number} si */
export function renderCine(s, si) {
  setTint(seriesColor(s));
  const fresh = new Set(newEpisodes(s).map((e) => e.id));
  const items = shelfItems(s).map((x) => ({
    ...x,
    words: norm(
      [movieTitle(s, x.it), x.it.key, x.m && x.m.title, x.m && x.m.romaji, x.m && x.m.saga, x.m && x.m.year].join(' '),
    ),
  }));
  page = { s, si, items, fresh };
  const q = route().q;
  const kind = cineKind(q.get('t'));
  const text = q.get('q') || '';
  const year = new Date().getFullYear();
  // los fijos siempre; los demás, cuando alguna película es de ese tipo (Sagas y Stop motion llegan con la ficha)
  const chips = CINE_KINDS.map((k) => ({ k, n: ofCineKind(items, k, year).length })).filter(
    ({ k, n }) => k.fixed || n || k === kind,
  );
  const { list, count } = shown(kind, text);
  app.innerHTML =
    header(esc(s.name)) +
    `<main class="shelf-main cine-main">
    <form class="cat-search cine-search" id="cine-form" role="search">
      <span class="search-icon">${ICON.search}</span>
      <input id="cine-q" type="search" placeholder="Buscar en Cine" value="${esc(text)}" autocomplete="off" enterkeyhint="search" aria-label="Buscar en Cine">
    </form>
    <nav class="cine-kinds" id="cine-kinds" aria-label="Tipos de película">${chips
      .map(
        ({ k, n }) =>
          `<button type="button" class="cine-kind${k === kind ? ' is-on' : ''}" data-kind="${k.id}" aria-pressed="${k === kind}">${esc(k.label)}<span class="cine-kind-n">${n}</span></button>`,
      )
      .join('')}</nav>
    <p class="dim shelf-count" id="cine-count" aria-live="polite">${esc(count)}</p>
    <ul class="shelf" role="list" id="cine-list">${list}</ul>
  </main>`;
  $('#cine-form').addEventListener('submit', (/** @type {Event} */ e) => {
    e.preventDefault();
    $('#cine-q').blur();
  });
  $('#cine-q').addEventListener('input', debounce(paintCine, 120));
  $('#cine-kinds').addEventListener('click', (/** @type {MouseEvent} */ e) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-kind]'));
    if (!b) return;
    for (const x of app.querySelectorAll('.cine-kind')) {
      const on = x === b;
      x.classList.toggle('is-on', on);
      x.setAttribute('aria-pressed', String(on));
    }
    b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    paintCine();
  });
  if (fresh.size) {
    markSeriesSeen(s);
    announceNew();
  }
}

/** Las películas de ese tipo que coinciden con lo escrito, ya como pósters, y el texto de cuántas son. */
function shown(/** @type {import('../models/collections.js').CineKind} */ kind, /** @type {string} */ text) {
  if (!page) return { list: '', count: '' };
  const { s, si, items, fresh } = page;
  const terms = norm(text).split(/\s+/).filter(Boolean);
  let list = ofCineKind(items, kind).filter((x) => terms.every((t) => x.words.includes(t)));
  // las sagas juntas y en orden; los estrenos, lo más nuevo primero; lo demás queda A–Z
  if (kind.id === 'sagas')
    list = [...list].sort(
      (a, b) => sagaName(a.m.saga).localeCompare(sagaName(b.m.saga), 'es') || (a.m.year || 0) - (b.m.year || 0),
    );
  else if (kind.id === 'estrenos') list = [...list].sort((a, b) => (b.m.year || 0) - (a.m.year || 0));
  const count = list.length
    ? plural(list.length, 'película', 'películas')
    : terms.length
      ? 'Nada coincide con la búsqueda.'
      : 'Todavía no hay películas de este tipo.';
  return { list: list.map((x) => moviePosterHTML(s, si, x, fresh)).join(''), count };
}

/** Vuelve a pintar la lista con lo elegido (sin redibujar la página) y lo deja en la dirección. */
export function paintCine() {
  const box = $('#cine-list');
  if (!box || !page) return;
  const on = /** @type {HTMLElement | null} */ (app.querySelector('.cine-kind.is-on'));
  const kind = cineKind(on ? on.dataset.kind : '');
  const text = ($('#cine-q') || {}).value || '';
  const { list, count } = shown(kind, text);
  if (box.dataset.sig !== list) {
    box.innerHTML = list;
    box.dataset.sig = list;
    hydrateThumbs(box);
  }
  $('#cine-count').textContent = count;
  const params = new URLSearchParams();
  if (kind.id) params.set('t', kind.id);
  if (text.trim()) params.set('q', text);
  const h = `#/serie/${page.si}` + (params.toString() ? '?' + params : '');
  if (location.hash !== h) history.replaceState(history.state, '', h);
}

/** Las etiquetas de la ficha de una película de Cine: llevan a sus tipos dentro de Cine, nunca al catálogo de anime. */
export function cineFactsHTML(/** @type {number} */ si, /** @type {any} */ m) {
  if (!m) return '';
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
    m.saga ? to(sagaName(m.saga), { t: 'sagas', q: sagaName(m.saga) }) : '',
    ...(m.genres || [])
      .slice(0, 3)
      .map((/** @type {string} */ g) => (g === 'Animación' ? to(g, { t: 'animacion' }) : `<span>${esc(g)}</span>`)),
  ].join('');
}
