/*
 * views/series.js — la página de una serie: menú de temporadas, la temporada con sus capítulos (con Sub | Doblado,
 * Anterior/Siguiente y "Seleccionar"), y las películas: el estante de una colección y la página de cada una.
 * Si la dirección no existe, avisa "navigate" para volver a un lugar que sí.
 */

import { emit } from '../lib/events.js';
import { langPref, langsOf, epById } from '../models/library.js';
import { state, index } from '../models/store.js';
import {
  isCollection,
  isStudio,
  studioTitle,
  studioSorted,
  setStudioShuffle,
  collectionItems,
  itemMeta,
  movieTitle,
} from '../models/collections.js';
import { viewState } from './view-state.js';
import { seasonPlan, heroPlan, shelfItems, moviePlan } from '../models/plans.js';
import {
  seasonMeta,
  displayMeta,
  synopsisOf,
  seriesColor,
  seasonLabel,
  seasonFullName,
  hasSpanish,
  firstSeasonMeta,
  isFranchise,
} from '../models/fichas.js';
import { newEpisodes, markSeriesSeen, announceNew } from '../models/news.js';
import { nextUnseen, prog, isLater } from '../models/progress.js';
import {
  setTint,
  app,
  header,
  heroArtHTML,
  titleSize,
  factsRowsHTML,
  langChip,
  factRows,
  moviePosterHTML,
  rowHTML,
} from './components.js';
import { esc, plural, hue, $, fmtSize } from '../lib/util.js';
import { langText } from '../models/naming.js';
import { canTranslate } from '../models/meta-api.js';
import { ICON } from './icons.js';
import { episodeRow } from './episodes.js';
import { pickable } from '../models/downloads.js';

/** Botones Sub | Doblado de una serie que tiene capítulos en los dos idiomas. */
export function langSwitchHTML(s, langs) {
  if (!langs || langs.length < 2) return '';
  const cur = langPref(s);
  return `<div class="lang-switch" role="group" aria-label="Idioma">${langs.map((l) => `<button class="${l === cur ? 'is-on' : ''}" data-act="lang" data-lang="${l}" aria-pressed="${l === cur}">${l === 'sub' ? 'Sub' : 'Doblado'}</button>`).join('')}</div>`;
}

/** La portada de una serie, temporada o película: la tarjeta oscura con la imagen, igual que en el inicio. */
function heroCardHTML({ m, thumbId = '', kicker = '', title, alt = '', facts = '', lang = '', actions }) {
  return `<section class="series-hero hero-card">${heroArtHTML(m, thumbId)}<div class="tvh-text">${kicker}<h2 class="tv-title${titleSize(title)}">${esc(title)}</h2>${alt}${facts}${lang ? `<div class="hero-lang">${lang}</div>` : ''}<div class="tv-actions">${actions}</div></div></section>`;
}
/**
 * La ficha en números, al lado de la sinopsis: la nota (con su medidor de 10 segmentos) y tu avance. En la
 * computadora llena la mitad derecha, que antes quedaba vacía en las películas y en las series de pocas temporadas.
 * @param {{ m: any, seen?: number, total?: number, movie?: { seen: boolean, left: string, dur?: number } }} o
 */
function fichaHTML({ m, seen = 0, total = 0, movie }) {
  const cards = [];
  const score = m && m.score ? Number(m.score) : 0;
  if (score) {
    const on = Math.round(score / 10);
    cards.push(`<div class="ficha-card"><span class="ficha-k">Nota en ${m.src === 'TMDB' ? 'TMDB' : 'AniList'}</span>
      <b class="ficha-n">${(score / 10).toFixed(1).replace('.', ',')}<small> de 10</small></b>
      <span class="ficha-seg" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i${i < on ? ' class="is-on"' : ''}></i>`).join('')}</span></div>`);
  }
  if (movie) {
    const mins = movie.dur ? `${Math.round(movie.dur / 60)} min` : '';
    cards.push(`<div class="ficha-card"><span class="ficha-k">Tu avance</span>
      <b class="ficha-n is-text">${movie.seen ? 'Vista' : movie.left ? esc(movie.left) : 'Sin ver'}</b>
      ${mins ? `<span class="ficha-k">Dura ${mins}</span>` : ''}</div>`);
  } else if (total) {
    cards.push(`<div class="ficha-card"><span class="ficha-k">Tu avance</span>
      <b class="ficha-n">${seen}<small> de ${total}</small></b>
      <span class="ficha-bar" aria-hidden="true"><i style="width:${Math.round((seen / total) * 100)}%"></i></span></div>`);
  }
  return cards.length ? `<aside class="ficha" aria-label="Ficha">${cards.join('')}</aside>` : '';
}

/** La sinopsis y el botón para traducirla, debajo de la tarjeta; al lado, la ficha en números. */
function aboutHTML(syn, translate, ficha = '') {
  return syn || translate || ficha
    ? `<section class="series-about${ficha ? ' has-ficha' : ''}">${syn ? `<p class="tv-synopsis is-long" id="synopsis">${esc(syn)}</p>` : ''}${translate}${ficha}</section>`
    : '';
}
/** El nombre alternativo de la ficha, si es distinto del que se muestra. */
const altHTML = (m, shown) =>
  m && m.title && m.title.toLowerCase() !== shown.toLowerCase()
    ? `<p class="tv-alt">${esc(m.title)}${m.native ? ` <span lang="ja">${esc(m.native)}</span>` : ''}</p>`
    : '';
/** Un botón cuadrado de la portada, con su nombre para lectores de pantalla y al pasar el mouse. */
const squareBtn = (attrs, label, icon, on = false) =>
  `<button class="tv-btn is-square${on ? ' is-on' : ''}" ${attrs} aria-label="${esc(label)}" title="${esc(label)}">${icon}</button>`;

export function renderSeries(arg) {
  const lib = state.library;
  const [siPart, kiPart] = String(arg).split('/');
  const si = Number(siPart);
  const s = lib && lib.series && lib.series[si];
  if (!s) {
    emit('navigate', { hash: '#/' });
    return;
  }
  if (isStudio(s)) {
    renderStudio(s, si);
    return;
  }
  if (isCollection(s)) {
    renderShelf(s, si);
    return;
  }
  viewState.heroSi = si;
  viewState.heroUser = true;
  const flat = false;
  const multi = s.seasons.length > 1;
  // con varias temporadas, primero el menú de temporadas; los capítulos, al entrar a una
  if (multi && kiPart == null) {
    renderSeasonMenu(s, si);
    return;
  }
  const ki = multi ? Number(kiPart) : 0;
  if (multi && !(ki >= 0 && ki < s.seasons.length)) {
    emit('navigate', { hash: '#/serie/' + si, replace: true });
    return;
  }
  const season = s.seasons[ki];
  // con varias temporadas, el botón grande es de la temporada que estás mirando
  const plan = multi ? seasonPlan(s, season) : heroPlan(s);
  const next = plan.next;
  // cada temporada con su ficha (póster, banner, sinopsis); si no tiene, la de la serie
  const ownMeta = flat ? null : seasonMeta(s, season);
  const m = ownMeta || displayMeta(s);
  const fresh = new Set(newEpisodes(s).map((e) => e.id));
  const upcoming = next
    ? [next, ...nextUnseen(next, flat || s.seasons.length < 2 ? s.all : season.episodes, 2)].filter(
        (x) => !state.saved.has(x.id),
      )
    : [];
  const syn = synopsisOf(m);
  const coverEp = season.episodes.find((e) => e.fa) || s.all.find((e) => e.fa);
  const scope = !flat && s.seasons.length > 1 ? season.episodes : s.all; // con pestañas, los números son de la temporada
  const seen = scope.filter((e) => (prog(e) || {}).w).length;
  const collage = m && m.collage && m.collage.length ? m.collage : null;
  setTint(seriesColor(s));
  const shown = multi ? seasonFullName(s, season) : s.name;
  const dlLabel = `Descargar ${upcoming.length === 1 ? 'el siguiente' : `los ${upcoming.length} siguientes`}`;
  app.innerHTML =
    header('', { overlay: true }) +
    `<div class="tv is-series">
    <main class="tv-main series-main">
      ${heroCardHTML({
        m: collage ? { ...m, cover: collage[0] } : m,
        thumbId: coverEp ? coverEp.id : '',
        kicker: multi
          ? `<p class="tv-kicker"><a href="#/serie/${si}">${esc(s.name)}</a><span>${esc(seasonLabel(s, season))}</span></p>`
          : '',
        title: shown,
        alt: altHTML(m, shown),
        facts: factsRowsHTML(s, m, {
          count: flat ? null : scope.length,
          seen,
          total: scope.length,
          lang: langText(langsOf(season.episodes)),
        }),
        lang: langSwitchHTML(s, season.langs),
        actions: `${next ? `<a class="tv-btn is-primary" href="#/play/${encodeURIComponent(next.id)}">${ICON.play}<span>${esc(plan.label)}</span></a>` : `<span class="tv-done">${esc(plan.label)}</span>`}
          ${upcoming.length ? squareBtn(`data-act="series-dl" data-si="${si}"${multi ? ` data-from="${esc(next.id)}"` : ''}`, dlLabel, ICON.down) : ''}
          ${flat ? '' : squareBtn(`data-act="later" data-si="${si}" aria-pressed="${isLater(s)}"`, 'Más tarde', isLater(s) ? ICON.laterOn : ICON.later, isLater(s))}`,
      })}
      ${aboutHTML(syn, m && !hasSpanish(m) && m.synopsis && canTranslate() ? `<button class="link-btn" data-act="translate"${ownMeta ? ` data-key="${esc(season.name)}"` : ''}>Traducir sinopsis al español</button>` : '', fichaHTML({ m, seen, total: scope.length }))}
      <section class="ep-section">
        ${
          multi
            ? `<nav class="season-tabs" aria-label="Temporadas"><a class="season-tab is-all" href="#/serie/${si}" data-replace>${ICON.grid}<span>Todas</span></a>${s.seasons
                .map(
                  (se, k) =>
                    `<a class="season-tab ${k === ki ? 'is-on' : ''}" href="#/serie/${si}/${k}" data-replace${k === ki ? ' aria-current="page"' : ''}>${esc(seasonLabel(s, se))}</a>`,
                )
                .join('')}</nav>`
            : ''
        }
        <div class="ep-head">
          <h3 class="ep-heading">${flat ? 'Películas' : 'Episodios'}</h3>
          <button class="pick-toggle" data-act="pick-mode" id="pick-toggle" aria-pressed="false">${ICON.check}<span>Seleccionar</span></button>
        </div>
        ${season.title && season.title !== s.name && !multi ? `<p class="season-title">${esc(season.title)}</p>` : ''}
        <ol class="episodes is-grid" id="season-eps">${season.episodes.map((ep) => episodeRow(ep, { fresh: fresh.has(ep.id), next: next && ep.id === next.id })).join('')}</ol>
      </section>
    </main>
    <div class="pick-bar" id="pick-bar" role="toolbar" aria-label="Capítulos seleccionados" hidden>
      <span class="pick-head"><span class="pick-count" id="pick-count" aria-live="polite"></span><button class="pick-all" id="pick-all" data-act="pick-all"></button></span>
      <button class="pick-btn" data-act="pick-seen" disabled>${ICON.check}<span>Visto</span></button>
      <button class="pick-btn" data-act="pick-unseen" disabled>${ICON.close}<span>No visto</span></button>
      <button class="pick-btn is-primary" data-act="pick-dl" disabled>${ICON.down}<span>Descargar</span></button>
    </div>
  </div>`;
  if (viewState.picking && (viewState.picking.si !== si || viewState.picking.ki !== ki))
    viewState.picking = { si, ki, ids: new Set() };
  paintPick();
  let focusId = null;
  try {
    focusId = sessionStorage.getItem('kai.focus');
    sessionStorage.removeItem('kai.focus');
  } catch {
    /* nada */
  }
  if (focusId)
    requestAnimationFrame(() => {
      // se busca aquí y no antes: el enrutador puede haber vuelto a poner la página que ya estaba
      const fli = app.querySelector(`.ep[data-id="${CSS.escape(focusId)}"]`);
      if (!fli) return;
      fli.scrollIntoView({ block: 'center' });
      fli.classList.add('is-flash');
    });
  // los "nuevos" se muestran esta vez y quedan vistos
  if (fresh.size) {
    markSeriesSeen(s);
    announceNew();
  }
}

/** Menú de una serie con varias temporadas: la ficha de la serie y una tarjeta por temporada. */
export function renderSeasonMenu(s, si) {
  const m = firstSeasonMeta(s);
  const plan = heroPlan(s);
  const next = plan.next;
  const nextKi = next ? index.byId.get(next.id).ki : -1;
  const fresh = new Set(newEpisodes(s).map((e) => e.id));
  const upcoming = next ? [next, ...nextUnseen(next, s.all, 2)].filter((x) => !state.saved.has(x.id)) : [];
  const syn = synopsisOf(m);
  const seen = s.all.filter((e) => (prog(e) || {}).w).length;
  const coverEp = s.all.find((e) => e.fa);
  // la ficha de una franquicia ("Fate") es la de una de sus temporadas: traducir va a esa
  const metaKey = isFranchise(s) ? (s.seasons.find((se) => seasonMeta(s, se) === m) || {}).name : '';
  const cards = s.seasons
    .map((se, ki) => {
      const t = seasonLabel(s, se);
      // la Temporada 1 de una serie usa la ficha de la serie como propia (con su año)
      const own = seasonMeta(s, se) || (t === 'Temporada 1' && !isFranchise(s) ? m : null);
      const sm = own || (isFranchise(s) ? null : m);
      const done = se.episodes.filter((e) => (prog(e) || {}).w).length;
      const all = done === se.episodes.length;
      const isNew = se.episodes.some((e) => fresh.has(e.id));
      const first = se.episodes.find((e) => e.fa) || se.episodes[0];
      const sub = [
        own && own.year ? own.year : '',
        all
          ? 'Vista'
          : done
            ? `${done} de ${plural(se.episodes.length, 'capítulo', 'capítulos')}`
            : plural(se.episodes.length, 'capítulo', 'capítulos'),
      ]
        .filter(Boolean)
        .join(' · ');
      return `<li><a class="shelf-item" href="#/serie/${si}/${ki}" style="--h:${hue(t)}">
      <span class="shelf-poster">
        ${sm && sm.cover ? `<img src="${esc(sm.cover)}" alt="" loading="lazy" decoding="async">` : first ? `<span class="is-fallback" data-thumb="${esc(first.id)}"><span class="cover-glyph">${esc([...t.trim()][0] || '·')}</span></span>` : ''}
        ${isNew ? '<span class="tile-badge">Nuevo</span>' : ki === nextKi && done ? '<span class="tile-badge">Viendo</span>' : ''}
        ${langChip(langsOf(se.episodes))}
        ${done && !all ? `<span class="tile-bar"><span style="width:${(done / se.episodes.length) * 100}%"></span></span>` : ''}
      </span>
      <span class="shelf-title" title="${esc(seasonFullName(s, se))}">${esc(t)}</span>
      <span class="shelf-sub${done && !all ? ' has-ring' : ''}"${done && !all ? ` style="--p:${Math.round((done / se.episodes.length) * 100)}"` : ''}>${esc(sub)}</span>
    </a></li>`;
    })
    .join('');
  setTint(seriesColor(s));
  const dlLabel = `Descargar ${upcoming.length === 1 ? 'el siguiente' : `los ${upcoming.length} siguientes`}`;
  app.innerHTML =
    header('', { overlay: true }) +
    `<div class="tv is-series">
    <main class="tv-main series-main">
      ${heroCardHTML({
        m,
        thumbId: coverEp ? coverEp.id : '',
        title: s.name,
        alt: isFranchise(s) ? '' : altHTML(m, s.name),
        facts: factRows(
          `<span>${plural(s.seasons.length, 'temporada', 'temporadas')}</span><span>${plural(s.all.length, 'capítulo', 'capítulos')}</span>${langsOf(s.all).length ? `<span>${esc(langText(langsOf(s.all)))}</span>` : ''}${seen ? `<span>${seen} vistos</span>` : ''}`,
          m,
          [
            m && m.year
              ? `<a class="fact" href="#/catalogo?${new URLSearchParams({ y: m.year })}">${esc(m.year)}</a>`
              : '',
            ...((m && m.genres) || [])
              .slice(0, 3)
              .map((g) => `<a class="fact" href="#/catalogo?${new URLSearchParams({ g })}">${esc(g)}</a>`),
          ].join(''),
        ),
        lang: langSwitchHTML(s, s.seasons.some((se) => se.langs) ? ['sub', 'dob'] : null),
        actions: `${next ? `<a class="tv-btn is-primary" href="#/play/${encodeURIComponent(next.id)}">${ICON.play}<span>${esc(plan.label)}</span></a>` : `<span class="tv-done">${esc(plan.label)}</span>`}
          ${upcoming.length ? squareBtn(`data-act="series-dl" data-si="${si}"`, dlLabel, ICON.down) : ''}
          ${squareBtn(`data-act="later" data-si="${si}" aria-pressed="${isLater(s)}"`, 'Más tarde', isLater(s) ? ICON.laterOn : ICON.later, isLater(s))}`,
      })}
      ${aboutHTML(syn, m && !hasSpanish(m) && m.synopsis && canTranslate() ? `<button class="link-btn" data-act="translate"${metaKey ? ` data-key="${esc(metaKey)}"` : ''}>Traducir sinopsis al español</button>` : '', fichaHTML({ m, seen: s.all.filter((e) => (prog(e) || {}).w).length, total: s.all.length }))}
      <section class="ep-section">
        <div class="ep-head"><h3 class="ep-heading">Temporadas</h3></div>
        <ul class="shelf season-grid" role="list">${cards}</ul>
      </section>
    </main>
  </div>`;
  if (fresh.size) {
    markSeriesSeen(s);
    announceNew();
  }
}

/** Studio: todos los videos, cada uno con su imagen (la que pusiste con el mismo nombre) y quién canta. */
export function renderStudio(s, si) {
  setTint(seriesColor(s));
  const eps = studioSorted(s.all);
  const tile = (/** @type {import('../models/types.js').Episode} */ e) => {
    const { artist, song, detail } = studioTitle(e.name);
    const p = prog(e) || {};
    const pct = p.d && p.t && !p.w ? Math.round((p.t / p.d) * 100) : 0;
    return `<a class="tile studio-tile" href="#/play/${encodeURIComponent(e.id)}" style="--h:${hue(song)}">
      <span class="tile-img is-fallback" ${e.art || e.fa ? `data-thumb="${esc(e.id)}"` : ''}><span class="cover-glyph">${esc([...(artist || song).trim()][0] || '·')}</span></span>
      <span class="tile-text"><span class="tile-title">${esc(song)}</span><span class="tile-sub">${esc([artist, detail].filter(Boolean).join(' · '))}</span></span>
      ${pct ? `<span class="tile-bar"><span style="width:${pct}%"></span></span>` : ''}
    </a>`;
  };
  app.innerHTML =
    header(esc(s.name)) +
    `<main class="shelf-main studio">
    <div class="studio-head">
      <p class="dim shelf-count">${plural(eps.length, 'canción', 'canciones')} en vivo</p>
      ${eps.length > 1 ? `<div class="studio-actions"><button class="btn btn-lamp" data-act="studio-play" data-si="${si}">${ICON.play}<span>Reproducir todo</span></button><button class="btn" data-act="studio-shuffle" data-si="${si}">${ICON.shuffle}<span>Aleatorio</span></button></div>` : ''}
    </div>
    <div class="tiles is-grid studio-grid" role="list">${eps.map(tile).join('')}</div>
  </main>`;
  // tocar una canción suelta: suena en el orden de la página (se deja el aleatorio)
  app.querySelector('.studio-grid')?.addEventListener('click', (e) => {
    if (/** @type {HTMLElement} */ (e.target).closest('.studio-tile')) setStudioShuffle(null);
  });
  if (newEpisodes(s).length) {
    markSeriesSeen(s);
    announceNew();
  }
}

export function renderShelf(s, si) {
  setTint(seriesColor(s));
  const fresh = new Set(newEpisodes(s).map((e) => e.id));
  const items = shelfItems(s);
  app.innerHTML =
    header(esc(s.name)) +
    `<main class="shelf-main">
    <p class="dim shelf-count">${plural(items.length, 'película', 'películas')}</p>
    <ul class="shelf" role="list">${items.map((x) => moviePosterHTML(s, si, x, fresh)).join('')}</ul>
  </main>`;
  if (fresh.size) {
    markSeriesSeen(s);
    announceNew();
  }
}

export function renderMovie(arg) {
  const lib = state.library;
  const cut = arg.indexOf('/');
  const si = Number(arg.slice(0, cut));
  const key = arg.slice(cut + 1);
  const s = lib && lib.series && lib.series[si];
  const it = s && isCollection(s) ? collectionItems(s).find((x) => x.key === key) : null;
  if (!it) {
    emit('navigate', { hash: s ? '#/serie/' + si : '#/' });
    return;
  }
  viewState.heroSi = si;
  const m = itemMeta(s, it.key);
  const t = movieTitle(s, it);
  const plan = moviePlan(it);
  const syn = synopsisOf(m);
  const pending = it.eps.filter((e) => !state.saved.has(e.id));
  const busy = it.eps.some((e) => state.dls[e.id] || state.queue.some((q) => q.ep.id === e.id));
  const dur = (prog(plan.ep) || {}).d;
  const chip = (label, params) => `<a class="fact" href="#/catalogo?${new URLSearchParams(params)}">${esc(label)}</a>`;
  const facts = factRows(
    [
      dur ? `<span>${Math.round(dur / 60)} min</span>` : '',
      it.eps.length > 1 ? `<span>${it.eps.length} partes</span>` : '',
      langsOf(it.eps).length ? `<span>${esc(langText(langsOf(it.eps)))}</span>` : '',
    ].join(''),
    m,
    [
      m && m.year ? chip(m.year, { y: m.year }) : '',
      chip('Película', { f: 'Película' }),
      ...((m && m.genres) || []).slice(0, 3).map((g) => chip(g, { g })),
    ].join(''),
  );
  const later = isLater(s, it.key);
  setTint((m && m.color) || seriesColor(s));
  app.innerHTML =
    header('', { overlay: true }) +
    `<div class="tv is-series is-movie">
    <main class="tv-main series-main">
      ${heroCardHTML({
        m,
        thumbId: it.eps[0].id,
        title: t,
        alt: altHTML(m, t),
        facts,
        lang: langSwitchHTML(s, langsOf(it.eps).length > 1 ? langsOf(it.eps) : null),
        actions: `<a class="tv-btn is-primary" href="#/play/${encodeURIComponent(plan.ep.id)}">${ICON.play}<span>${esc(plan.label)}</span></a>
          ${
            busy
              ? `<span class="tv-btn is-square is-quiet" aria-label="Descargando…" title="Descargando…">${ICON.queued}</span>`
              : pending.length
                ? squareBtn(`data-act="movie-dl" data-si="${si}" data-key="${esc(it.key)}"`, 'Descargar', ICON.down)
                : `<span class="tv-btn is-square is-quiet" aria-label="Descargada" title="Descargada">${ICON.saved}</span>`
          }
          ${squareBtn(`data-act="later-item" data-si="${si}" data-key="${esc(it.key)}" aria-pressed="${later}"`, 'Más tarde', later ? ICON.laterOn : ICON.later, later)}`,
      })}
      ${aboutHTML(syn, m && !hasSpanish(m) && m.synopsis && canTranslate() ? `<button class="link-btn" data-act="translate" data-key="${esc(it.key)}">Traducir sinopsis al español</button>` : '', fichaHTML({ m, movie: { seen: plan.seen, left: plan.left, dur } }))}
      ${
        it.eps.length > 1
          ? `<section class="ep-section">
        <div class="ep-head"><h3 class="ep-heading">Partes</h3></div>
        <ol class="episodes is-grid" id="season-eps">${it.eps.map((ep) => episodeRow(ep, { next: ep.id === plan.ep.id && !plan.seen })).join('')}</ol>
      </section>`
          : ''
      }
      ${moreMoviesHTML(s, si, it.key)}
    </main>
  </div>`;
}

/** Las demás películas de la colección, en una fila: la página de una película ya no termina en la sinopsis. */
function moreMoviesHTML(s, si, key) {
  const others = shelfItems(s).filter((x) => x.it.key !== key);
  if (!others.length) return '';
  const fresh = new Set(newEpisodes(s).map((e) => e.id));
  return `<section class="ep-section more-movies">
    <div class="ep-head"><h3 class="ep-heading">Más ${s.name === 'Cine' ? 'de Cine' : 'películas'}</h3></div>
    ${rowHTML(others.map((x) => moviePosterHTML(s, si, x, fresh)).join(''))}
  </section>`;
}

export function pickSeason() {
  const s = viewState.picking && state.library && state.library.series[viewState.picking.si];
  if (!s) return null;
  return isCollection(s) ? { episodes: s.all } : s.seasons[viewState.picking.ki] || null;
}

export function paintPick() {
  const on = !!viewState.picking;
  document.documentElement.classList.toggle('is-picking', on);
  const list = $('#season-eps');
  const bar = $('#pick-bar');
  const btn = $('#pick-toggle');
  if (!list || !bar) return;
  list.classList.toggle('is-picking', on);
  if (btn) {
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('is-on', on);
    btn.querySelector('span').textContent = on ? 'Cancelar' : 'Seleccionar';
  }
  bar.hidden = !on;
  list.querySelectorAll('.ep').forEach((li) => {
    const picked = on && viewState.picking.ids.has(li.dataset.id);
    li.classList.toggle('is-picked', picked);
    const a = li.querySelector('.ep-main');
    if (on) {
      a.setAttribute('role', 'checkbox');
      a.setAttribute('aria-checked', String(picked));
    } else {
      a.removeAttribute('role');
      a.removeAttribute('aria-checked');
    }
  });
  if (!on) return;
  const eps = [...viewState.picking.ids].map(epById).filter(Boolean);
  const toGet = eps.filter(pickable);
  const size = toGet.reduce((a, e) => a + (e.size || 0), 0);
  $('#pick-count').textContent = eps.length
    ? `${plural(eps.length, 'capítulo', 'capítulos')}${toGet.length ? `, ${fmtSize(size)} por descargar` : ''}`
    : matchMedia('(hover: hover) and (pointer: fine)').matches
      ? 'Elige capítulos (Shift + clic: varios seguidos)'
      : 'Toca los capítulos que quieras';
  // todos de una vez (o, si ya están todos, ninguno)
  const season = pickSeason();
  const all = !!season && season.episodes.length > 0 && season.episodes.every((e) => viewState.picking.ids.has(e.id));
  $('#pick-all').textContent = all ? 'Ninguno' : 'Todos';
  bar.querySelector('[data-act="pick-dl"]').disabled = !toGet.length;
  // cada botón se apaga si no cambiaría nada (todos ya vistos, o ninguno visto)
  const seen = eps.filter((e) => (prog(e) || {}).w).length;
  bar.querySelector('[data-act="pick-seen"]').disabled = !eps.length || seen === eps.length;
  bar.querySelector('[data-act="pick-unseen"]').disabled = !seen;
}
