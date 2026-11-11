/*
 * views/home.js — la portada estilo TV: saludo y hora, la serie destacada, Continuar viendo, Más tarde, las filas de
 * Series y Películas, y la tarjeta para seguir aquí lo que quedó a medias en otro dispositivo.
 */

import { resumeOffer } from '../models/progress.js';
import { app, rowHTML } from './components.js';
import { movieHref } from '../lib/route.js';
import { state, visibleProfiles } from '../models/store.js';
import { avatarHTML } from './account.js';
import { esc, $, fmtLeft, plural, fmtTime } from '../lib/util.js';
import {
  catHTML,
  titleSize,
  heroArtHTML,
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
import { continueList, laterList, prog } from '../models/progress.js';
import { weekStats, fmtWatched } from '../models/stats.js';
import { proQuota } from '../models/quota.js';
import {
  isCollection,
  itemFor,
  movieTitle,
  movieImage,
  episodeLabel,
  isCine,
  isStudio,
  isAside,
} from '../models/collections.js';

export function greeting() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  return state.profile ? `${g}, ${state.profile.name}` : g;
}
// el saludo cambia con la hora del día: se revisa de vez en cuando (solo cambia el texto)
setInterval(() => {
  const g = $('#tv-greet');
  if (g && g.textContent !== greeting()) g.textContent = greeting();
}, 60000);

/** Bloques, teléfono: tu avatar arriba, junto a la lupa (abre el menú del perfil). En la computadora y en Vidrio va
 * en la barra flotante, como siempre. */
function topAvatarHTML() {
  if (!isBlocks() || !state.profile) return '';
  const p = visibleProfiles().find((x) => x.id === state.profile.id) || state.profile;
  return `<button class="top-avatar" data-act="dock" aria-haspopup="menu" aria-label="Menú de ${esc(p.name)}">${avatarHTML(p)}<span class="top-sync" aria-hidden="true"></span></button>`;
}

export function tvTop() {
  // cabecera compacta: el nombre de la app (con Kai, el gatito, echado encima en la PC), el saludo y la búsqueda
  return `<header class="tv-top">
    <div class="tv-brand"><span class="tv-word">Kai${catHTML('top')}</span><p class="tv-greet" id="tv-greet">${esc(greeting())}</p></div>
    <div class="tv-top-tools">
      <button class="tv-icon" data-act="home-search" aria-label="Buscar" aria-expanded="false">${ICON.search}</button>
      ${topAvatarHTML()}
    </div>
  </header>
  <div class="home-search" id="home-search" hidden>
    <span class="search-icon">${ICON.search}</span>
    <input id="home-q" type="search" placeholder="Buscar un anime o película" autocomplete="off" enterkeyhint="search" aria-label="Buscar">
    <button class="tv-icon is-small" data-act="home-search-close" aria-label="Cerrar la búsqueda">${ICON.close}</button>
  </div>`;
}

/** ¿Está puesto el estilo Bloques? (solo con el Laboratorio; Vidrio no lleva nada de esto) */
export const isBlocks = () => !!state.settings.lab && state.settings.style === 'bloques';

/** Bloques: el avance de una serie como una fila de segmentos, uno por capítulo (hasta 40; con más no se lee). */
export function segMeterHTML(eps) {
  if (!isBlocks() || eps.length < 2 || eps.length > 40) return '';
  return `<div class="seg-meter" aria-hidden="true">${eps
    .map((e) => {
      const p = prog(e);
      return `<i${p && p.w ? ' class="is-on"' : p && p.t > 5 ? ' class="is-now"' : ''}></i>`;
    })
    .join('')}</div>`;
}

/** Bloques: al lado de la portada, lo visto esta semana (y la transferencia de MEGA si la cuenta la informa). */
export function homeSideHTML(lib) {
  const w = weekStats(lib.series, prog);
  const max = Math.max(1, ...w.days);
  const bars = w.days
    .map(
      (d, i) =>
        `<i${d ? ' class="is-on"' : ''} style="height:${d ? Math.max(24, Math.round((d / max) * 100)) : 16}%" title="${w.labels[i]}"></i>`,
    )
    .join('');
  const pro = proQuota();
  const pct = pro && pro.total ? Math.min(100, Math.max(1, Math.round((pro.used / pro.total) * 100))) : 0;
  const gb = (/** @type {number} */ n) =>
    n >= 1e9 ? `${Math.round(n / 1e9).toLocaleString('es')} GB` : `${Math.round(n / 1e6)} MB`;
  return `<aside class="home-side" aria-label="Tu semana">
    <div class="side-card side-week"><span class="side-k">esta semana</span>
      <b class="side-n">${w.seconds ? fmtWatched(w.seconds, true) : '0 min'}</b>
      <span class="side-k is-plain">${w.eps === 1 ? '1 capítulo visto' : `${w.eps} capítulos vistos`}</span></div>
    <div class="side-card side-days"><span class="side-k">día por día</span>
      <div class="side-bars" role="img" aria-label="Lo visto cada día de la semana">${bars}</div>
      <span class="side-labels" aria-hidden="true">${w.labels.map((l) => `<i>${l}</i>`).join('')}</span></div>
    ${
      pro
        ? `<div class="side-card side-mega"><span class="side-ring" style="--p:${pct}" role="img" aria-label="Transferencia de MEGA usada: ${pct} por ciento"></span>
      <span class="side-mega-text"><span class="side-k">transferencia de mega</span><b class="side-n is-mid">${gb(pro.used)}</b><span class="side-k is-plain">de ${gb(pro.total)}</span></span></div>`
        : ''
    }
  </aside>`;
}

export function heroInnerHTML(s, si) {
  const m = displayMeta(s);
  const plan = heroPlan(s);
  const fresh = newEpisodes(s).length;
  const syn = synopsisOf(m);
  const coverEp = s.all.find((e) => e.fa);
  return `${heroArtHTML(m, coverEp && coverEp.id)}<div class="tvh-text"><h2 class="tv-title${titleSize(s.name)}"><span class="tvt">${esc(s.name)}</span></h2>
    ${m && m.title && m.title.toLowerCase() !== s.name.toLowerCase() ? `<p class="tv-alt">${esc(m.title)}</p>` : ''}
    <p class="tv-facts">${factsHTML(s, m, fresh ? `<span class="tv-new">${fresh === 1 ? '1 nuevo' : `${fresh} nuevos`}</span>` : '')}</p>
    ${segMeterHTML(s.all)}
    ${syn ? `<p class="tv-synopsis">${esc(syn.replace(/\s*\n+\s*/g, ' '))}</p>` : ''}
    <div class="tv-actions">
      ${plan.next ? `<a class="tv-btn is-primary" href="#/play/${encodeURIComponent(plan.next.id)}">${ICON.play}<span>${esc(plan.label)}</span></a>` : ''}
      <a class="tv-btn is-square" href="#/serie/${si}" aria-label="Episodios" title="Episodios">${ICON.menu}</a>
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
  const cont = continueList().filter((c) => !isStudio(c.series)); // Studio es para escuchar otra vez, no para seguir
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
      ${
        isBlocks()
          ? `<div class="home-top"><section class="tv-hero" id="tv-hero">${heroInnerHTML(hs, viewState.heroSi)}</section>${homeSideHTML(lib)}</div>`
          : `<section class="tv-hero" id="tv-hero">${heroInnerHTML(hs, viewState.heroSi)}</section>`
      }
      ${resumeCardHTML()}
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
        ${rowHTML(
          homeSeries(lib)
            .map(({ s, si }) => seriesPosterHTML(s, si))
            .join(''),
        )}
</section>
      ${homeMoviesHTML(lib)}
      ${homeFootHTML(lib)}
    </main>
  </div>`;
}
/** El final del inicio: "Descubrir" (Cine, Porque viste…, En emisión) y Kai, el gatito, sentado encima. */
function homeFootHTML(lib) {
  const cine = lib.series.findIndex(isCine);
  const studio = lib.series.findIndex(isStudio);
  const link = (href, icon, title, sub, tone) =>
    `<a class="home-link" href="${href}" data-tone="${tone}"><span class="home-link-ic">${icon}</span><span class="home-link-text"><b>${esc(title)}</b><span>${esc(sub)}</span></span>${ICON.chev}</a>`;
  return `<section class="tv-row home-foot" aria-labelledby="home-disc">
    <h3 class="tv-row-title" id="home-disc">Descubrir</h3>
    <div class="home-shelf">
      ${catHTML('foot')}
      <nav class="home-links" aria-label="Descubrir">
        ${cine >= 0 ? link(`#/serie/${cine}`, ICON.film, lib.series[cine].name, 'Películas que no son anime', 'cine') : ''}
        ${studio >= 0 ? link(`#/serie/${studio}`, ICON.mic, lib.series[studio].name, 'Música en vivo', 'studio') : ''}
        ${link('#/descubrir/porque', ICON.spark, 'Porque viste…', 'Recomendaciones según lo que tienes', 'porque')}
        ${link('#/descubrir/emision', ICON.live, 'En emisión', 'Lo que está saliendo ahora', 'emision')}
      </nav>
    </div>
  </section>`;
}

/** Fila "Películas" del inicio: las 10 primeras en orden alfabético y el enlace al estante completo. */
export function homeMoviesHTML(lib) {
  const si = lib.series.findIndex((x) => isCollection(x) && !isAside(x));
  if (si < 0) return '';
  const s = lib.series[si];
  const items = shelfItems(s);
  if (!items.length) return '';
  const fresh = new Set(newEpisodes(s).map((e) => e.id));
  return `<section class="tv-row">
    <div class="tv-row-head"><h3 class="tv-row-title">Películas</h3>
      <a class="tv-more" href="#/catalogo?t=peliculas">${ICON.grid}<span>Ver catálogo${items.length > HOME_MOVIES ? ` (${items.length})` : ''}</span></a></div>
    ${rowHTML(
      items
        .slice(0, HOME_MOVIES)
        .map((x) => moviePosterHTML(s, si, x, fresh))
        .join(''),
    )}
  </section>`;
}

/** Tarjeta "Estabas viendo … en el iPhone — Seguir aquí". */
export function resumeCardHTML() {
  const o = resumeOffer(viewState.isPlaying());
  if (!o) return '';
  const mins = Math.round((Date.now() - o.n.u) / 60000);
  const when = mins < 2 ? 'hace un momento' : mins < 60 ? `hace ${mins} min` : `hace ${Math.round(mins / 60)} h`;
  const title = isCollection(o.s) ? episodeLabel(o.ep) : `${o.s.name} · ${episodeLabel(o.ep)}`;
  const dn = o.n.dn || 'otro dispositivo';
  // una burbuja flotante, como una notificación: tocarla la abre con el detalle y "Seguir aquí"
  // toda la burbuja se toca (no solo el texto): abre o cierra el detalle; los botones de adentro hacen lo suyo
  return `<aside class="resume-card" data-act="resume-toggle" aria-label="Seguir en este dispositivo">
    <button class="resume-pill" data-act="resume-toggle" aria-expanded="false">${ICON.play}<span>Seguir de tu ${esc(dn)} · ${fmtTime(o.n.t)}</span></button>
    <div class="resume-more"><div class="resume-in">
      <p class="resume-kicker">En tu ${esc(dn)}, ${when}</p>
      <p class="resume-title">${esc(title)}</p>
      <div class="resume-actions">
        <button class="tv-btn is-primary" data-act="resume-here">${ICON.play}<span>Seguir aquí en ${fmtTime(o.n.t)}</span></button>
        <button class="tv-btn is-square resume-x" data-act="resume-dismiss" aria-label="Descartar">${ICON.close}</button>
      </div>
    </div></div>
  </aside>`;
}

export const HOME_RECENT = 10;
export const HOME_MOVIES = 10;
export const HOME_CONTINUE = 3;

/** Fila "Series" del inicio: en orden alfabético, como el catálogo. */
export function homeSeries(lib) {
  return lib.series
    .map((s, si) => ({ s, si }))
    .filter(({ s }) => !isCollection(s))
    .sort((a, b) => a.s.name.localeCompare(b.s.name, 'es', { numeric: true }))
    .slice(0, HOME_RECENT);
}
