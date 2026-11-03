/*
 * views/series.js — la página de una serie: menú de temporadas, la temporada con sus capítulos (con Sub | Doblado,
 * Anterior/Siguiente y "Seleccionar"), y las películas: el estante de una colección y la página de cada una.
 * Si la dirección no existe, avisa "navigate" para volver a un lugar que sí.
 */

import { emit } from '../lib/events.js';
import { langPref, langsOf, epById } from '../models/library.js';
import { state, index } from '../models/store.js';
import { isCollection, collectionItems, itemMeta, movieTitle } from '../models/collections.js';
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
  collageHTML,
  titleSize,
  factsRowsHTML,
  langChip,
  factRows,
  moviePosterHTML,
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

export function renderSeries(arg) {
  const lib = state.library;
  const [siPart, kiPart] = String(arg).split('/');
  const si = Number(siPart);
  const s = lib && lib.series && lib.series[si];
  if (!s) {
    emit('navigate', { hash: '#/' });
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
  app.innerHTML =
    header('', { overlay: true }) +
    `<div class="tv is-series">
    <div class="series-wash" aria-hidden="true">${m && m.cover ? `<img src="${esc(m.cover)}" alt="">` : ''}</div>
    <main class="tv-main series-main">
      <section class="series-hero ${(m && m.banner) || collage ? 'has-banner' : ''}">
        ${
          collage
            ? `<div class="banner is-collage" aria-hidden="true">${Array.from(
                { length: Math.max(12, collage.length) },
                (_, i) => collage[i % collage.length],
              )
                .map((u) => `<img src="${esc(u)}" alt="" decoding="async">`)
                .join('')}</div>`
            : m && m.banner
              ? `<div class="banner"><img src="${esc(m.banner)}" alt="" decoding="async"></div>`
              : ''
        }
        <div class="series-top">
          ${collage ? `<span class="poster is-collage">${collageHTML(collage)}</span>` : m && m.cover ? `<img class="poster" src="${esc(m.cover)}" alt="" decoding="async">` : coverEp ? `<span class="poster is-thumb" data-thumb="${esc(coverEp.id)}"></span>` : ''}
          <div class="series-info">
            ${multi ? `<p class="tv-kicker"><a href="#/serie/${si}">${esc(s.name)}</a><span>${esc(seasonLabel(s, season))}</span></p>` : ''}
            <h2 class="tv-title${titleSize(multi ? seasonFullName(s, season) : s.name)}">${esc(multi ? seasonFullName(s, season) : s.name)}</h2>
            ${m && m.title && m.title.toLowerCase() !== (multi ? seasonFullName(s, season) : s.name).toLowerCase() ? `<p class="tv-alt">${esc(m.title)}${m.native ? ` <span lang="ja">${esc(m.native)}</span>` : ''}</p>` : ''}
            ${factsRowsHTML(s, m, { count: flat ? null : scope.length, seen, total: scope.length, lang: langText(langsOf(season.episodes)) })}
          </div>
        </div>
        ${syn ? `<p class="tv-synopsis is-long" id="synopsis">${esc(syn)}</p>` : ''}
        ${m && !hasSpanish(m) && m.synopsis && canTranslate() ? `<button class="link-btn" data-act="translate"${ownMeta ? ` data-key="${esc(season.name)}"` : ''}>Traducir sinopsis al español</button>` : ''}
        <div class="tv-actions">
          ${next ? `<a class="tv-btn is-primary" href="#/play/${encodeURIComponent(next.id)}">${ICON.play}<span>${esc(plan.label)}</span></a>` : `<span class="tv-done">${esc(plan.label)}</span>`}
          ${upcoming.length ? `<button class="tv-btn" data-act="series-dl" data-si="${si}"${multi ? ` data-from="${esc(next.id)}"` : ''}>${ICON.down}<span>Descargar ${upcoming.length === 1 ? 'el siguiente' : `los ${upcoming.length} siguientes`}</span></button>` : ''}
          ${flat ? '' : `<button class="tv-btn ${isLater(s) ? 'is-on' : ''}" data-act="later" data-si="${si}" aria-pressed="${isLater(s)}">${isLater(s) ? ICON.laterOn : ICON.later}<span>Más tarde</span></button>`}
        </div>
      </section>
      <section class="ep-section">
        <div class="ep-head">
          <h3 class="ep-heading">${flat ? 'Películas' : 'Episodios'}</h3>
          <button class="pick-toggle" data-act="pick-mode" id="pick-toggle" aria-pressed="false">${ICON.check}<span>Seleccionar</span></button>
          ${langSwitchHTML(s, season.langs)}
          ${
            multi
              ? `<nav class="season-step" aria-label="Otras temporadas">
            ${ki > 0 ? `<a class="step-btn" href="#/serie/${si}/${ki - 1}" data-replace title="${esc(seasonLabel(s, s.seasons[ki - 1]))}">${ICON.back}<span>Anterior</span></a>` : ''}
            <a class="step-btn" href="#/serie/${si}" data-replace>${ICON.grid}<span>Temporadas</span></a>
            ${ki < s.seasons.length - 1 ? `<a class="step-btn is-next" href="#/serie/${si}/${ki + 1}" data-replace title="${esc(seasonLabel(s, s.seasons[ki + 1]))}"><span>Siguiente</span>${ICON.back}</a>` : ''}
          </nav>`
              : ''
          }
        </div>
        ${season.title && season.title !== s.name && !multi ? `<p class="season-title">${esc(season.title)}</p>` : ''}
        <ol class="episodes is-grid" id="season-eps">${season.episodes.map((ep) => episodeRow(ep, { fresh: fresh.has(ep.id), next: next && ep.id === next.id })).join('')}</ol>
      </section>
    </main>
    <div class="pick-bar" id="pick-bar" role="toolbar" aria-label="Capítulos seleccionados" hidden>
      <span class="pick-count" id="pick-count" aria-live="polite"></span>
      <button class="pick-btn" data-act="pick-all">Todos</button>
      <button class="pick-btn" data-act="pick-unseen">Sin ver</button>
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
      <span class="shelf-sub">${esc(sub)}</span>
    </a></li>`;
    })
    .join('');
  setTint(seriesColor(s));
  app.innerHTML =
    header('', { overlay: true }) +
    `<div class="tv is-series">
    <div class="series-wash" aria-hidden="true">${m && m.cover ? `<img src="${esc(m.cover)}" alt="">` : ''}</div>
    <main class="tv-main series-main">
      <section class="series-hero ${m && m.banner ? 'has-banner' : ''}">
        ${m && m.banner ? `<div class="banner"><img src="${esc(m.banner)}" alt="" decoding="async"></div>` : ''}
        <div class="series-top">
          ${m && m.cover ? `<img class="poster" src="${esc(m.cover)}" alt="" decoding="async">` : coverEp ? `<span class="poster is-thumb" data-thumb="${esc(coverEp.id)}"></span>` : ''}
          <div class="series-info">
            <h2 class="tv-title${titleSize(s.name)}">${esc(s.name)}</h2>
            ${m && m.title && !isFranchise(s) && m.title.toLowerCase() !== s.name.toLowerCase() ? `<p class="tv-alt">${esc(m.title)}${m.native ? ` <span lang="ja">${esc(m.native)}</span>` : ''}</p>` : ''}
            ${factRows(
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
            )}
          </div>
        </div>
        ${syn ? `<p class="tv-synopsis is-long" id="synopsis">${esc(syn)}</p>` : ''}
        ${m && !hasSpanish(m) && m.synopsis && canTranslate() ? `<button class="link-btn" data-act="translate"${metaKey ? ` data-key="${esc(metaKey)}"` : ''}>Traducir sinopsis al español</button>` : ''}
        <div class="tv-actions">
          ${next ? `<a class="tv-btn is-primary" href="#/play/${encodeURIComponent(next.id)}">${ICON.play}<span>${esc(plan.label)}</span></a>` : `<span class="tv-done">${esc(plan.label)}</span>`}
          ${upcoming.length ? `<button class="tv-btn" data-act="series-dl" data-si="${si}">${ICON.down}<span>Descargar ${upcoming.length === 1 ? 'el siguiente' : `los ${upcoming.length} siguientes`}</span></button>` : ''}
          <button class="tv-btn ${isLater(s) ? 'is-on' : ''}" data-act="later" data-si="${si}" aria-pressed="${isLater(s)}">${isLater(s) ? ICON.laterOn : ICON.later}<span>Más tarde</span></button>
        </div>
      </section>
      <section class="ep-section">
        <div class="ep-head"><h3 class="ep-heading">Temporadas</h3>${langSwitchHTML(s, s.seasons.some((se) => se.langs) ? ['sub', 'dob'] : null)}</div>
        <ul class="shelf season-grid" role="list">${cards}</ul>
      </section>
    </main>
  </div>`;
  if (fresh.size) {
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
    <div class="series-wash" aria-hidden="true">${m && m.cover ? `<img src="${esc(m.cover)}" alt="">` : ''}</div>
    <main class="tv-main series-main">
      <section class="series-hero ${m && m.banner ? 'has-banner' : ''}">
        ${m && m.banner ? `<div class="banner"><img src="${esc(m.banner)}" alt="" decoding="async"></div>` : ''}
        <div class="series-top">
          ${m && m.cover ? `<img class="poster" src="${esc(m.cover)}" alt="" decoding="async">` : `<span class="poster is-thumb" data-thumb="${esc(it.eps[0].id)}"></span>`}
          <div class="series-info">
            <h2 class="tv-title">${esc(t)}</h2>
            ${m && m.title && m.title.toLowerCase() !== t.toLowerCase() ? `<p class="tv-alt">${esc(m.title)}${m.native ? ` <span lang="ja">${esc(m.native)}</span>` : ''}</p>` : ''}
            ${facts}
          </div>
        </div>
        ${syn ? `<p class="tv-synopsis is-long" id="synopsis">${esc(syn)}</p>` : ''}
        ${m && !hasSpanish(m) && m.synopsis && canTranslate() ? `<button class="link-btn" data-act="translate" data-key="${esc(it.key)}">Traducir sinopsis al español</button>` : ''}
        <div class="tv-actions">
          <a class="tv-btn is-primary" href="#/play/${encodeURIComponent(plan.ep.id)}">${ICON.play}<span>${esc(plan.label)}</span></a>
          ${
            busy
              ? `<span class="tv-btn is-quiet">${ICON.queued}<span>Descargando…</span></span>`
              : pending.length
                ? `<button class="tv-btn" data-act="movie-dl" data-si="${si}" data-key="${esc(it.key)}">${ICON.down}<span>Descargar</span></button>`
                : `<span class="tv-btn is-quiet">${ICON.saved}<span>Descargada</span></span>`
          }
          <button class="tv-btn ${later ? 'is-on' : ''}" data-act="later-item" data-si="${si}" data-key="${esc(it.key)}" aria-pressed="${later}">${later ? ICON.laterOn : ICON.later}<span>Más tarde</span></button>
          ${langSwitchHTML(s, langsOf(it.eps).length > 1 ? langsOf(it.eps) : null)}
        </div>
      </section>
      ${
        it.eps.length > 1
          ? `<section class="ep-section">
        <div class="ep-head"><h3 class="ep-heading">Partes</h3></div>
        <ol class="episodes is-grid" id="season-eps">${it.eps.map((ep) => episodeRow(ep, { next: ep.id === plan.ep.id && !plan.seen })).join('')}</ol>
      </section>`
          : ''
      }
    </main>
  </div>`;
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
    const ep = epById(li.dataset.id);
    const picked = on && viewState.picking.ids.has(li.dataset.id);
    li.classList.toggle('is-picked', picked);
    li.classList.toggle('is-unpickable', on && !!ep && !pickable(ep));
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
  const size = eps.reduce((a, e) => a + (e.size || 0), 0);
  $('#pick-count').textContent = eps.length
    ? `${plural(eps.length, 'capítulo', 'capítulos')}, ${fmtSize(size)}`
    : 'Toca los capítulos que quieras';
  bar.querySelector('[data-act="pick-dl"]').disabled = !eps.length;
  const season = pickSeason();
  const all = season ? season.episodes.filter(pickable) : [];
  bar.querySelector('[data-act="pick-all"]').textContent =
    all.length && all.every((e) => viewState.picking.ids.has(e.id)) ? 'Ninguno' : 'Todos';
}
