/*
 * views/catalog.js — los catálogos de Series y Películas con buscador y filtros (género, año, tipo, idioma, orden),
 * y la búsqueda rápida de la portada (la lupa).
 */

import { state } from '../models/store.js';
import { isCollection, collectionItems, itemMeta, movieTitle, isAside } from '../models/collections.js';
import { movieHref, route } from '../lib/route.js';
import { langsOf } from '../models/library.js';
import { metaFor } from '../models/fichas.js';
import { esc, $, debounce, plural } from '../lib/util.js';
import { app, header, resetPosterCache, posterAny, entryTile, rowHTML } from './components.js';
import { ICON } from './icons.js';
import { hydrateThumbs } from './thumbs.js';
import { emit } from '../lib/events.js';
import { prog } from '../models/progress.js';

/** ¿Ya se vio todo? (todos sus capítulos, o la película) @param {{ w?: boolean }[]} eps */
const allSeen = (eps) => eps.length > 0 && eps.every((e) => (prog(e) || {}).w);

export const norm = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Series y, de las colecciones, cada película por separado (cada una con sus etiquetas de AniList). */
export function catalogEntries() {
  const lib = state.library;
  if (!lib || lib.v !== 2) return [];
  const out = [];
  lib.series.forEach((s, si) => {
    if (isCollection(s)) {
      for (const it of collectionItems(s)) {
        const m = itemMeta(s, it.key);
        const title = it.title || (m && m.title) || it.eps[0].name.replace(/\.[^.]+$/, '');
        out.push({
          si,
          title: movieTitle(s, it),
          m,
          img: m && (m.banner || m.cover),
          year: m && m.year,
          score: (m && m.score) || 0,
          genres: (m && m.genres) || [],
          format: 'Película',
          added: Math.max(0, ...it.eps.map((e) => e.ts || 0)),
          href: movieHref(si, it.key),
          movie: it.key,
          cine: isAside(s), // Cine y Studio: solo al buscar
          langs: langsOf(it.eps),
          done: allSeen(it.eps),
          words: norm([title, m && m.title, m && m.romaji, m && m.native, s.name].join(' ')),
        });
      }
    } else {
      const m = metaFor(s);
      out.push({
        si,
        title: s.name,
        m,
        img: m && (m.banner || m.cover),
        year: m && m.year,
        score: (m && m.score) || 0,
        genres: (m && m.genres) || [],
        format: (m && m.format) || 'Serie',
        added: s.added || 0,
        count: s.all.length,
        langs: langsOf(s.all),
        done: allSeen(s.all),
        words: norm([s.name, m && m.title, m && m.romaji, m && m.native, ...s.seasons.map((se) => se.title)].join(' ')),
      });
    }
  });
  return out;
}
export function filterEntries(list, { q = '', g = '', y = '', f = '', l = '', s = '' }) {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  return list.filter(
    (e) =>
      terms.every((t) => e.words.includes(t)) &&
      (!g || e.genres.includes(g)) &&
      (!y || String(e.year) === String(y)) &&
      (!f || e.format === f) &&
      (!l || (e.langs || []).includes(l)) &&
      (!s || (e.score || 0) >= Number(s)), // la nota de AniList (0 a 100); lo que no tiene nota no pasa
  );
}
/** Ordena el catálogo; lo que ya viste completo va al final (en el mismo orden), para que no se mezcle con lo
 * que falta por ver. */
export function sortEntries(list, o) {
  const az = (a, b) => a.title.localeCompare(b.title, 'es', { numeric: true });
  const by =
    o === 'recent'
      ? (a, b) => (b.added || 0) - (a.added || 0) || az(a, b)
      : o === 'year'
        ? (a, b) => (b.year || 0) - (a.year || 0) || az(a, b)
        : o === 'score'
          ? (a, b) => (b.score || 0) - (a.score || 0) || az(a, b)
          : az; // por defecto, A–Z
  return list.sort((a, b) => Number(!!a.done) - Number(!!b.done) || by(a, b));
}

/* Dos catálogos, Series y Películas (?t=series | ?t=peliculas). Al buscar o filtrar por una etiqueta,
 * se busca en todo: series y películas juntas. */
export const CAT_TITLES = { series: 'Series', peliculas: 'Películas' };
export const isFiltering = (st) => !!(st.q || st.g || st.y || st.f || st.l || st.s);
export function catalogBase(t, st) {
  const all = catalogEntries().filter((e) => !e.cine || st.q); // Cine no se mezcla: solo aparece al buscar
  if (!CAT_TITLES[t] || isFiltering(st)) return all;
  return all.filter((e) => (t === 'peliculas') === !!e.movie);
}
export function renderCatalog() {
  const q = route().q;
  const t = CAT_TITLES[q.get('t')] ? q.get('t') : '';
  const all = catalogEntries();
  const count = (key) => {
    const m = new Map();
    for (const e of all) for (const v of [].concat(e[key] || [])) if (v) m.set(String(v), (m.get(String(v)) || 0) + 1);
    return m;
  };
  const genres = [...count('genres').entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
    .map(([v, n]) => [v, `${v} (${n})`]);
  const years = [...count('year').keys()].sort((a, b) => b - a).map((v) => [v, v]);
  const formats = [...count('format').keys()].sort().map((v) => [v, v]);
  const select = (name, label, opts, all = true) => {
    const cur = q.get(name) || '';
    const known = !cur || opts.some(([v]) => v === cur);
    return `<label class="cat-select"><span>${label}</span><select name="${name}">
      ${all ? `<option value="">Todos</option>` : ''}${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      ${known ? '' : `<option value="${esc(cur)}" selected>${esc(cur)}</option>`}</select></label>`;
  };
  app.innerHTML =
    header(CAT_TITLES[t] || 'Catálogo') +
    `<main class="catalog" data-t="${t}">
    <form class="cat-search" id="cat-form" role="search">
      <span class="search-icon">${ICON.search}</span>
      <input id="cat-q" name="q" type="search" placeholder="Buscar series y películas" value="${esc(q.get('q') || '')}" autocomplete="off" enterkeyhint="search" aria-label="Buscar">
    </form>
    <div class="cat-filters" id="cat-filters">
      ${select('g', 'Género', genres)}${select('y', 'Año', years)}${select('f', 'Tipo', formats)}
      ${
        all.some((e) => e.langs && e.langs.length)
          ? select('l', 'Idioma', [
              ['sub', 'Subtitulado'],
              ['dob', 'Doblado'],
            ])
          : ''
      }
      ${
        all.some((e) => e.score)
          ? select('s', 'Nota', [
              ['90', '9 o más'],
              ['80', '8 o más'],
              ['70', '7 o más'],
              ['60', '6 o más'],
            ])
          : ''
      }
      ${select(
        'o',
        'Orden',
        [
          ['az', 'A–Z'],
          ['recent', 'Recientes'],
          ['year', 'Año'],
          ['score', 'Mejor nota'],
        ],
        false,
      )}
      <button class="link-btn cat-clear" type="button" data-act="cat-clear" hidden>Quitar filtros</button>
    </div>
    <p class="dim cat-count" id="cat-count" aria-live="polite"></p>
    <div id="cat-results"></div>
  </main>`;
  const form = $('#cat-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    $('#cat-q').blur();
  });
  $('#cat-q').addEventListener('input', debounce(paintCatalog, 120));
  $('#cat-filters').addEventListener('change', paintCatalog);
  paintCatalog();
  if (q.get('buscar') === '1') $('#cat-q').focus();
}
export function catalogState() {
  const val = (n) => {
    const el = app.querySelector(`#cat-filters [name="${n}"]`);
    return el ? el.value : '';
  };
  return {
    q: ($('#cat-q') || {}).value || '',
    g: val('g'),
    y: val('y'),
    f: val('f'),
    l: val('l'),
    s: val('s'),
    o: val('o') || 'az',
  };
}
export function paintCatalog() {
  const box = $('#cat-results');
  if (!box) return;
  const st = catalogState();
  const t = (app.querySelector('.catalog') || {}).dataset?.t || '';
  const list = sortEntries(filterEntries(catalogBase(t, st), st), st.o);
  // series y películas, como pósters
  const posters = true;
  // si al teclear sigue saliendo lo mismo, no se vuelven a dibujar todos los mosaicos
  const sig =
    (posters ? 'p' : 't') +
    list.map((e) => e.href || e.si).join('|') +
    '#' +
    list.map((e) => e.img || '').join('').length;
  if (box.dataset.sig !== sig) {
    resetPosterCache();
    box.innerHTML = posters
      ? `<ul class="shelf" role="list">${list.map(posterAny).join('')}</ul>`
      : `<div class="tiles is-grid" role="list">${list.map(entryTile).join('')}</div>`;
    box.dataset.sig = sig;
    if (posters) hydrateThumbs(box);
  }
  $('#cat-count').textContent = list.length
    ? plural(list.length, 'título', 'títulos')
    : state.library
      ? 'Nada coincide con la búsqueda o los filtros.'
      : 'Cargando la biblioteca…';
  app.querySelector('[data-act="cat-clear"]').hidden = !(st.g || st.y || st.f || st.l || st.s || st.q);
  // la dirección refleja la búsqueda (para volver atrás o compartirla), sin redibujar la página
  const params = new URLSearchParams();
  if (t) params.set('t', t);
  for (const k of ['q', 'g', 'y', 'f', 'l', 's']) if (st[k]) params.set(k, st[k]);
  if (st.o !== 'az') params.set('o', st.o);
  const h = '#/catalogo' + (params.toString() ? '?' + params : '');
  if (location.hash !== h) history.replaceState(history.state, '', h);
}

/* búsqueda rápida desde el inicio */
export function openHomeSearch() {
  const bar = $('#home-search');
  if (!bar) return;
  bar.hidden = false;
  app.querySelector('[data-act="home-search"]').setAttribute('aria-expanded', 'true');
  const input = $('#home-q');
  input.focus();
  input.oninput = debounce(paintHomeSearch, 120);
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      emit('navigate', { hash: '#/catalogo?' + new URLSearchParams({ q: input.value }) });
    } else if (e.key === 'Escape') closeHomeSearch();
  };
}

export function closeHomeSearch() {
  const bar = $('#home-search');
  if (!bar) return;
  bar.hidden = true;
  $('#home-q').value = '';
  app.querySelector('[data-act="home-search"]').setAttribute('aria-expanded', 'false');
  paintHomeSearch();
}
export function paintHomeSearch() {
  const box = $('#home-results');
  const tv = app.querySelector('.tv.is-home');
  if (!box || !tv) return;
  const qv = ($('#home-q') || {}).value || '';
  const on = !!qv.trim();
  tv.classList.toggle('is-searching', on);
  box.hidden = !on;
  if (!on) {
    box.innerHTML = '';
    return;
  }
  const list = sortEntries(filterEntries(catalogEntries(), { q: qv }), 'az');
  box.innerHTML = `<div class="tv-row-head"><h3 class="tv-row-title">${list.length ? plural(list.length, 'resultado', 'resultados') : 'Sin resultados'}</h3>
      <a class="tv-more" href="#/catalogo?${new URLSearchParams({ q: qv })}">${ICON.grid}<span>Buscar en el catálogo</span></a></div>
    ${rowHTML(list.slice(0, 24).map(posterAny).join(''))}`;
  resetPosterCache();
}
