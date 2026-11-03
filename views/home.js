/*
 * views/home.js — la portada estilo TV: saludo y hora, la serie destacada, Continuar viendo, Más tarde, las filas de
 * Series y Películas, y la tarjeta para seguir aquí lo que quedó a medias en otro dispositivo.
 */

import { resumeOffer } from '../models/progress.js';
import { app } from './components.js';
import { movieHref } from '../lib/route.js';
import { state } from '../models/store.js';
import { esc, $, fmtLeft, plural, fmtTime } from '../lib/util.js';
import {
  catHTML,
  collageHTML,
  titleSize,
  factsHTML,
  setTint,
  tileHTML,
  seriesPosterHTML,
  moviePosterHTML,
} from './components.js';
import { ICON } from './icons.js';
import { displayMeta, synopsisOf, seriesColor } from '../models/fichas.js';
import { heroPlan, shelfItems } from '../models/plans.js';
import { newEpisodes } from '../models/news.js';
import { viewState } from './view-state.js';
import { hydrateThumbs } from './thumbs.js';
import { continueList, laterList } from '../models/progress.js';
import { isCollection, itemFor, movieTitle, movieImage, episodeLabel, isCine } from '../models/collections.js';

export function greeting() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  return state.profile ? `${g}, ${state.profile.name}` : g;
}
// crear un Intl.DateTimeFormat es caro (carga los datos del idioma): se crean una vez y se reusan
const HOUR_FMT = new Intl.DateTimeFormat('es', { hour: 'numeric', minute: '2-digit', hour12: true });
const DATE_FMT = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
export function clockParts() {
  const d = new Date();
  const time = HOUR_FMT.formatToParts(d);
  const hm = time
    .filter((p) => p.type !== 'dayPeriod')
    .map((p) => p.value)
    .join('')
    .trim();
  const ap = (time.find((p) => p.type === 'dayPeriod') || {}).value || '';
  const date = DATE_FMT.format(d);
  return { hm, ap, date };
}
export function clockHTML() {
  const { hm, ap, date } = clockParts();
  // en la PC, Kai va echado encima de la fecha
  return `<span class="tv-hm">${esc(hm)}</span><span class="tv-ap">${esc(ap)}</span><span class="tv-sep" aria-hidden="true"></span><span class="tv-date"><span class="tv-date-t">${esc(date)}</span>${catHTML('top')}</span>`;
}

setInterval(() => {
  // solo cambia el texto (así Kai no se vuelve a cargar cada vez)
  const el = $('#tv-clock');
  if (el) {
    const p = clockParts();
    for (const [sel, v] of [
      ['.tv-hm', p.hm],
      ['.tv-ap', p.ap],
      ['.tv-date-t', p.date],
    ]) {
      const x = el.querySelector(sel);
      if (x && x.textContent !== v) x.textContent = v;
    }
  }
  const g = $('#tv-greet');
  if (g) g.textContent = greeting();
}, 20000);

export function tvTop() {
  return `<header class="tv-top">
    <div class="tv-when">
      <p class="tv-greet" id="tv-greet">${esc(greeting())}</p>
      <p class="tv-clock" id="tv-clock">${clockHTML()}</p>
    </div>
    <div class="tv-top-tools">
      <button class="tv-icon" data-act="home-search" aria-label="Buscar" aria-expanded="false">${ICON.search}</button>
    </div>
  </header>
  <div class="home-search" id="home-search" hidden>
    <span class="search-icon">${ICON.search}</span>
    <input id="home-q" type="search" placeholder="Buscar un anime o película" autocomplete="off" enterkeyhint="search" aria-label="Buscar">
    <button class="tv-icon is-small" data-act="home-search-close" aria-label="Cerrar la búsqueda">${ICON.close}</button>
  </div>`;
}

export function heroInnerHTML(s, si) {
  const m = displayMeta(s);
  const plan = heroPlan(s);
  const fresh = newEpisodes(s).length;
  const syn = synopsisOf(m);
  const coverEp = s.all.find((e) => e.fa);
  const poster =
    m && m.collage && m.collage.length
      ? `<a class="hero-poster is-collage" href="#/serie/${si}" aria-hidden="true" tabindex="-1">${collageHTML(m.collage)}</a>`
      : m && m.cover
        ? `<a class="hero-poster" href="#/serie/${si}" aria-hidden="true" tabindex="-1"><img src="${esc(m.cover)}" alt="" decoding="async"></a>`
        : coverEp
          ? `<a class="hero-poster is-thumb" href="#/serie/${si}" aria-hidden="true" tabindex="-1"><span data-thumb="${esc(coverEp.id)}"></span></a>`
          : '';
  return `${poster}<div class="tvh-text"><h2 class="tv-title${titleSize(s.name)}"><span class="tvt">${esc(s.name)}${catHTML('title')}</span></h2>
    ${m && m.title && m.title.toLowerCase() !== s.name.toLowerCase() ? `<p class="tv-alt">${esc(m.title)}</p>` : ''}
    <p class="tv-facts">${factsHTML(s, m, fresh ? `<span class="tv-new">${fresh === 1 ? '1 nuevo' : `${fresh} nuevos`}</span>` : '')}</p>
    ${syn ? `<p class="tv-synopsis">${esc(syn.replace(/\s*\n+\s*/g, ' '))}</p>` : ''}
    <div class="tv-actions">
      ${plan.next ? `<a class="tv-btn is-primary" href="#/play/${encodeURIComponent(plan.next.id)}">${ICON.play}<span>${esc(plan.label)}</span></a>` : ''}
      <a class="tv-btn" href="#/serie/${si}">${ICON.menu}<span>Episodios</span></a>
    </div></div>`;
}

export function setHero(si) {
  viewState.heroUser = true;
  if (!state.library || viewState.heroSi === si) return;
  const s = state.library.series[si];
  if (!s) return;
  viewState.heroSi = si;
  const box = $('#tv-hero');
  if (!box) return;
  setTint(seriesColor(s));
  box.classList.add('is-switching');
  setTimeout(() => {
    box.innerHTML = heroInnerHTML(s, si);
    hydrateThumbs(box);
    box.classList.remove('is-switching');
  }, 120);
}

export function renderHome() {
  const lib = state.library && state.library.v === 2 ? state.library : null;
  const err = state.error;
  let body = '';
  if (err && err.message === 'NOROOT') {
    body = `<section class="empty tv-empty">
      <p>No encontré la carpeta <strong>${esc(state.settings.root)}</strong> en tu MEGA.</p>
      <p class="dim">Elige la carpeta donde guardas tus series. Cada carpeta adentro será una serie.</p>
      <a class="tv-btn is-primary" href="#/explorar">Elegir carpeta</a>
    </section>`;
  } else if (!lib) {
    body = `<section class="empty tv-empty"><p class="dim">${navigator.onLine ? 'Conectando con MEGA…' : 'Sin conexión. Lo que descargaste está en Descargados.'}</p>
      ${navigator.onLine ? '' : '<a class="tv-btn" href="#/descargas">Ver descargados</a>'}</section>`;
  } else if (!lib.series.length) {
    body = `<section class="empty tv-empty"><p>La carpeta <strong>${esc(lib.root)}</strong> está vacía.</p>
      <p class="dim">Crea una carpeta por serie y pon los capítulos adentro, o una subcarpeta por temporada.</p></section>`;
  }
  if (body) {
    app.innerHTML = `<div class="tv">${tvTop()}<main class="tv-main">${body}</main></div>`;
    return;
  }
  const cont = continueList();
  const later = laterList();
  const siOf = (s) => lib.series.indexOf(s);
  // la portada muestra una serie (la carpeta de películas no tiene una ficha propia que mostrar)
  if (
    !viewState.heroUser ||
    viewState.heroSi == null ||
    !lib.series[viewState.heroSi] ||
    isCollection(lib.series[viewState.heroSi])
  ) {
    const c = cont.find((x) => !isCollection(x.series));
    const first = lib.series.findIndex((x) => !isCollection(x));
    viewState.heroSi = c ? siOf(c.series) : Math.max(0, first);
  }
  const hs = lib.series[viewState.heroSi];
  setTint(seriesColor(hs));
  app.innerHTML = `<div class="tv is-home">
    ${tvTop()}
    <main class="tv-main">
      ${resumeCardHTML()}
      <section class="tv-hero" id="tv-hero">${heroInnerHTML(hs, viewState.heroSi)}</section>
      <section class="tv-row" id="home-results" hidden></section>
      ${
        cont.length
          ? `<section class="tv-row"><h3 class="tv-row-title">Continuar viendo</h3><div class="tiles is-grid" role="list">
        ${cont
          .slice(0, HOME_CONTINUE)
          .map((c) =>
            tileHTML(c.series, siOf(c.series), {
              // primero la página de la serie (o de la película), con "Continuar" listo
              href: isCollection(c.series)
                ? movieHref(siOf(c.series), itemFor(c.series, c.ep).key)
                : '#/serie/' + siOf(c.series),
              label: isCollection(c.series) ? movieTitle(c.series, itemFor(c.series, c.ep)) : '',
              img: isCollection(c.series) ? movieImage(c.series, itemFor(c.series, c.ep)) : '',
              sub: `${episodeLabel(c.ep)}${c.p && c.p.t > 5 ? `, ${fmtLeft(c.p)}` : ''}`,
              pct: c.p && c.p.d ? Math.min(100, (c.p.t / c.p.d) * 100) : 0,
            }),
          )
          .join('')}
      </div></section>`
          : ''
      }
      ${
        later.length
          ? `<section class="tv-row"><h3 class="tv-row-title">Más tarde</h3><div class="tiles is-grid" role="list">
        ${later
          .slice(0, 12)
          .map(({ s, si, it }) =>
            tileHTML(s, si, {
              href: it ? movieHref(si, it.key) : '#/serie/' + si,
              label: it ? movieTitle(s, it) : s.name,
              img: it ? movieImage(s, it) : '',
              sub: it ? 'Película' : plural(s.all.length, 'capítulo', 'capítulos'),
            }),
          )
          .join('')}
      </div></section>`
          : ''
      }
      <section class="tv-row">
        <div class="tv-row-head"><h3 class="tv-row-title">Series</h3>
          <a class="tv-more" href="#/catalogo?t=series">${ICON.grid}<span>Ver catálogo${lib.series.filter((x) => !isCollection(x)).length > HOME_RECENT ? ` (${lib.series.filter((x) => !isCollection(x)).length})` : ''}</span></a></div>
        <ul class="shelf is-row" role="list">${homeSeries(lib)
          .map(({ s, si }) => seriesPosterHTML(s, si))
          .join('')}</ul>
</section>
      ${homeMoviesHTML(lib)}
      <nav class="discover-links" aria-label="Descubrir">
        ${lib.series.some(isCine) ? `<a class="tv-more" href="#/serie/${lib.series.findIndex(isCine)}">${ICON.grid}<span>${esc(lib.series.find(isCine).name)}</span></a>` : ''}
        <a class="tv-more" href="#/descubrir/porque">${ICON.grid}<span>Porque viste…</span></a>
        <a class="tv-more" href="#/descubrir/emision">${ICON.grid}<span>En emisión</span></a>
      </nav>
    </main>
  </div>`;
}
/** Fila "Películas" del inicio: las 10 primeras en orden alfabético y el enlace al estante completo. */
export function homeMoviesHTML(lib) {
  const si = lib.series.findIndex((x) => isCollection(x) && !isCine(x));
  if (si < 0) return '';
  const s = lib.series[si];
  const items = shelfItems(s);
  if (!items.length) return '';
  const fresh = new Set(newEpisodes(s).map((e) => e.id));
  return `<section class="tv-row">
    <div class="tv-row-head"><h3 class="tv-row-title">Películas</h3>
      <a class="tv-more" href="#/catalogo?t=peliculas">${ICON.grid}<span>Ver catálogo${items.length > HOME_MOVIES ? ` (${items.length})` : ''}</span></a></div>
    <ul class="shelf is-row" role="list">${items
      .slice(0, HOME_MOVIES)
      .map((x) => moviePosterHTML(s, si, x, fresh))
      .join('')}</ul>
  </section>`;
}

/** Tarjeta "Estabas viendo … en el iPhone — Seguir aquí". */
export function resumeCardHTML() {
  const o = resumeOffer(viewState.isPlaying());
  if (!o) return '';
  const mins = Math.round((Date.now() - o.n.u) / 60000);
  const when = mins < 2 ? 'hace un momento' : mins < 60 ? `hace ${mins} min` : `hace ${Math.round(mins / 60)} h`;
  const title = isCollection(o.s) ? episodeLabel(o.ep) : `${o.s.name} · ${episodeLabel(o.ep)}`;
  return `<section class="resume-card" aria-label="Seguir en este dispositivo">
    <div class="resume-text"><p class="resume-kicker">En tu ${esc(o.n.dn || 'otro dispositivo')}, ${when}</p>
      <p class="resume-title">${esc(title)}</p></div>
    <button class="tv-btn is-primary" data-act="resume-here">${ICON.play}<span>Seguir aquí en ${fmtTime(o.n.t)}</span></button>
    <button class="icon-btn resume-x" data-act="resume-dismiss" aria-label="Descartar">${ICON.close}</button>
  </section>`;
}

export const HOME_RECENT = 10;
export const HOME_MOVIES = 10;
export const HOME_CONTINUE = 3;

/** Fila "Series" del inicio: en orden alfabético, como el catálogo (pedido de Alex, v37). */
export function homeSeries(lib) {
  return lib.series
    .map((s, si) => ({ s, si }))
    .filter(({ s }) => !isCollection(s))
    .sort((a, b) => a.s.name.localeCompare(b.s.name, 'es', { numeric: true }))
    .slice(0, HOME_RECENT);
}
