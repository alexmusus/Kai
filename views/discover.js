/*
 * views/discover.js — las páginas de Descubrir y la hoja con la ficha de cada recomendación.
 */

import { showSheet, closeSheet } from './sheet.js';
import { state } from '../models/store.js';
import { route } from '../lib/route.js';
import { LS, esc, hue, $, plural } from '../lib/util.js';
import { app, header } from './components.js';
import { ICON } from './icons.js';
import { discoverFresh, DISCOVER, ownedIds, loadDiscover } from '../models/discover.js';

/* ── Descubrir: "Porque viste…" y "En emisión" ──
 * Con AniList: recomendaciones de las series que tienes en MEGA (las que ya viste pesan más) y lo que está
 * saliendo ahora con buena nota. Lo que ya tienes sale a color y lleva a su página; lo que no, en blanco y negro. */
export const ANIMEAV1_SEARCH = (t) => 'https://animeav1.com/catalogo?search=' + encodeURIComponent(t);
export function airingIn(at) {
  const h = Math.round((at - Date.now()) / 3600000);
  if (h <= 0) return 'sale hoy';
  if (h < 24) return `en ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'mañana' : `en ${d} días`;
}
export function discoverPosterHTML(x, owned, kind) {
  const href = owned.get(x.id);
  const sub =
    kind === 'emision'
      ? [x.next ? `Ep. ${x.next.ep} ${airingIn(x.next.at)}` : '', x.score ? `★ ${x.score}` : '']
          .filter(Boolean)
          .join(' · ')
      : x.because && x.because.length
        ? `Porque viste ${x.because.join(' y ')}`
        : x.score
          ? `★ ${x.score}`
          : '';
  const inner = `<span class="shelf-poster">
      ${x.cover ? `<img src="${esc(x.cover)}" alt="" loading="lazy" decoding="async">` : `<span class="is-fallback"><span class="cover-glyph">${esc([...(x.title || '·').trim()][0])}</span></span>`}
      ${href ? '<span class="tile-badge">En Kai</span>' : ''}
    </span>
    <span class="shelf-title">${esc(x.title)}</span>
    ${sub ? `<span class="shelf-sub">${esc(sub)}</span>` : ''}`;
  return href
    ? `<li><a class="shelf-item" href="${href}" style="--h:${hue(x.title)}">${inner}</a></li>`
    : `<li><button class="shelf-item is-gray" data-act="discover-open" data-id="${x.id}" style="--h:${hue(x.title)}">${inner}</button></li>`;
}
export async function renderDiscover(kind) {
  if (!DISCOVER[kind]) kind = 'porque';
  const other = kind === 'porque' ? 'emision' : 'porque';
  app.innerHTML =
    header(DISCOVER[kind].title) +
    `<main class="shelf-main discover" data-kind="${kind}">
    <p class="dim shelf-count" id="disc-note">${kind === 'porque' ? 'Recomendaciones de AniList según lo que tienes en MEGA.' : 'Lo que está saliendo ahora y tiene buena nota en AniList.'}</p>
    <div id="disc-list"><p class="dim">Buscando en AniList…</p></div>
    <p class="discover-foot"><a class="tv-more" href="#/descubrir/${other}">${ICON.grid}<span>${DISCOVER[other].title}</span></a></p>
  </main>`;
  const paint = (d) => {
    const box = $('#disc-list');
    if (!box || route().view !== 'descubrir') return;
    const owned = ownedIds();
    if (!d.items.length) {
      box.innerHTML = `<p class="dim">${kind === 'porque' ? 'Todavía no hay recomendaciones: agrega series a MEGA y espera a que Kai encuentre sus fichas.' : 'AniList no devolvió nada ahora.'}</p>`;
      return;
    }
    box.innerHTML = `<ul class="shelf" role="list">${d.items.map((x) => discoverPosterHTML(x, owned, kind)).join('')}</ul>`;
  };
  const cached = (LS.get('discover', {}) || {})[kind];
  if (discoverFresh(cached)) paint(cached);
  try {
    paint(await loadDiscover(kind));
  } catch (err) {
    const box = $('#disc-list');
    if (box && !discoverFresh(cached))
      box.innerHTML = `<p class="dim">No se pudo consultar AniList (${esc(err.message || 'sin conexión')}). Intenta en un momento.</p>`;
  }
}
export function openDiscoverSheet(id) {
  const all = LS.get('discover', {}) || {};
  const x = Object.values(all)
    .flatMap((d) => (d && d.items) || [])
    .find((y) => y.id === id);
  if (!x) return;
  const syn = (state.syn[x.id] && state.syn[x.id].es) || x.synopsis || '';
  const short = syn.length > 420 ? syn.slice(0, 400).replace(/\s+\S*$/, '') + '…' : syn;
  const facts = [
    x.year,
    x.format,
    x.episodes ? plural(x.episodes, 'capítulo', 'capítulos') : '',
    x.score ? `★ ${x.score}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const html = `<div class="sheet-back" data-act="close"></div>
    <div class="sheet-panel discover-sheet" role="dialog" aria-modal="true" aria-label="${esc(x.title)}">
      <div class="discover-head">
        ${x.cover ? `<img class="discover-cover" src="${esc(x.cover)}" alt="">` : ''}
        <div><p class="sheet-title">${esc(x.title)}</p>
          <p class="sheet-sub">${esc(facts)}</p>
          ${x.genres.length ? `<p class="sheet-sub">${esc(x.genres.slice(0, 4).join(', '))}</p>` : ''}
          ${x.next ? `<p class="sheet-sub">Capítulo ${x.next.ep} ${airingIn(x.next.at)}</p>` : ''}</div>
      </div>
      ${short ? `<p class="discover-syn">${esc(short)}</p>` : ''}
      <a class="sheet-btn" href="${ANIMEAV1_SEARCH(x.romaji || x.title)}" target="_blank" rel="noopener">Buscar en animeav1</a>
      <a class="sheet-btn" href="https://anilist.co/anime/${x.id}" target="_blank" rel="noopener">Ver en AniList</a>
      <button class="sheet-btn is-quiet" data-act="close">Cerrar</button>
    </div>`;
  showSheet(html, (e) => {
    if (e.target.closest('[data-act="close"]') || e.target.closest('a.sheet-btn')) closeSheet();
  });
}
