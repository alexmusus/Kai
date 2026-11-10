/*
 * views/settings.js — Ajustes: novedades, perfil, tu resumen, tema, descargas y carpeta, Cine (clave de TMDB), sincronización,
 * espacio, lo que vieron todos los perfiles y la versión de Kai.
 */

import { state, visibleProfiles, profileFile, TONES, DARK_TONES, saveSettings } from '../models/store.js';
import { profilePrefs, HOLD_RATES, SEEK_STEPS } from '../models/profiles.js';
import { newsList, newEpisodes, hasUnreadNews, markNewsRead } from '../models/news.js';
import { esc, $, fmtSize, LS, plural } from '../lib/util.js';
import { filesNamed, readJson, megaMessage } from '../models/mega.js';
import { mergeProgress, prog } from '../models/progress.js';
import { profileStats, fmtWatched } from '../models/stats.js';
import { isCollection, episodeLabel, isCine } from '../models/collections.js';
import { app, header } from './components.js';
import { ICON } from './icons.js';
import { quotaText } from './quota.js';
import { isUpdateReady, swVersion } from '../models/updates.js';
import { tmdbKey } from '../models/fichas.js';
import { tmdbCheckKey } from '../models/meta-api.js';
import { setTmdbKey } from '../models/fichas-sync.js';
import { canFolder, currentDir, getDir, dirPermission, refreshSaved } from '../models/downloads.js';

/** Tu resumen: cuánto viste con este perfil, las series que terminaste y lo más visto del mes. */
export function statsHTML() {
  const lib = state.library;
  if (!lib || !state.profile) return '';
  const st = profileStats(lib.series, prog);
  if (!st.eps && !st.seconds) return '';
  const fig = (/** @type {string} */ n, /** @type {string} */ label) =>
    `<div class="stat"><b>${n}</b><span>${label}</span></div>`;
  const month = st.monthTop.length
    ? `<p class="dim stats-month">Este mes, ${fmtWatched(st.monthSeconds)}: ${st.monthTop
        .map((m) => `<strong>${esc(m.name)}</strong> (${plural(m.eps, 'capítulo', 'capítulos')})`)
        .join(', ')}.</p>`
    : '';
  const done = st.done.length
    ? `<details class="stats-done"><summary>${plural(st.done.length, 'serie terminada', 'series terminadas')}</summary><p class="dim">${st.done
        .slice()
        .sort((a, b) => a.localeCompare(b, 'es'))
        .map(esc)
        .join(' · ')}</p></details>`
    : '';
  return `<p class="settings-label">Tu resumen · ${esc(state.profile.name)}</p>
    <div class="stats">${fig(fmtWatched(st.seconds, true), 'vistos')}${fig(String(st.eps), st.eps === 1 ? 'capítulo' : 'capítulos')}${fig(String(st.done.length), st.done.length === 1 ? 'serie terminada' : 'series terminadas')}</div>
    ${month}${done}`;
}

/** Lo del reproductor que elige cada perfil: la velocidad al mantener presionado y cuánto saltan los ±. */
export function playerPrefsHTML() {
  const { hold, step } = profilePrefs();
  const seg = (
    /** @type {string} */ act,
    /** @type {number} */ v,
    /** @type {boolean} */ on,
    /** @type {string} */ label,
  ) =>
    `<button class="seg ${on ? 'is-on' : ''}" data-act="${act}" data-v="${v}" aria-pressed="${on}">${label}</button>`;
  const name = state.profile ? esc(state.profile.name) : '';
  return `<p class="settings-label">Reproductor${name ? ` · ${name}` : ''}</p>
      <p class="settings-label">Al mantener presionado</p>
      <div class="segmented" role="group" aria-label="Velocidad al mantener presionado">${HOLD_RATES.map((v) => seg('set-hold', v, v === hold, `${String(v).replace('.', ',')}×`)).join('')}</div>
      <p class="settings-label">Saltos</p>
      <div class="segmented" role="group" aria-label="Cuánto saltan los botones de adelantar y retroceder">${SEEK_STEPS.map((v) => seg('set-step', v, v === step, `${v} s`)).join('')}</div>
      <p class="dim settings-hint">Mantener presionado el video (o la barra espaciadora en la computadora) cambia la velocidad mientras dura; los saltos son el doble toque, las flechas y los botones. Cada perfil tiene los suyos.</p>`;
}

export function newsHTML() {
  const lib = state.library && state.library.v === 2 ? state.library : null;
  const items = newsList();
  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    return m < 60
      ? `hace ${Math.max(1, m)} min`
      : m < 1440
        ? `hace ${Math.round(m / 60)} h`
        : `hace ${Math.round(m / 1440)} d`;
  };
  const rows = items.map((x) => {
    const si = lib ? lib.series.findIndex((s) => s.name === x.name) : -1;
    const what = `${x.n === 1 ? 'un capítulo nuevo' : `${x.n} capítulos nuevos`}`;
    const label = `<strong>${esc(x.name)}</strong>: ${what} <span class="dim">· ${ago(x.at)}</span>`;
    return `<li>${si >= 0 ? `<a href="#/serie/${si}">${label}</a>` : label}</li>`;
  });
  return `<p class="settings-label">Novedades</p>
    ${
      rows.length
        ? `<ul class="news-list">${rows.join('')}</ul><button class="btn btn-quiet" data-act="news-clear">Limpiar</button>`
        : '<p class="dim">Aquí aparece lo que se agregue a tu MEGA. Por ahora no hay nada nuevo.</p>'
    }
    ${!rows.length && lib && lib.series.some((s) => newEpisodes(s).length) ? '<button class="btn btn-quiet" data-act="news-clear">Quitar las burbujas de "nuevo"</button>' : ''}`;
}

/* ── Ajustes: lo que se copió entre perfiles, para elegir de quién es cada serie ── */
/**
 * @param {import('../models/profile-copies.js').CopyGroup[]} groups
 * @param {Record<number, string>} picks grupo → perfil dueño ('' = de los dos)
 */
export function copiesHTML(groups, picks) {
  if (!groups.length) return '<p class="dim">No hay nada copiado entre perfiles.</p>';
  const nameOf = (/** @type {string} */ id) => (visibleProfiles().find((p) => p.id === id) || { name: '?' }).name;
  const rows = groups.map((g, i) => {
    const what = [g.eps ? plural(g.eps, 'capítulo', 'capítulos') : '', g.later ? 'Más tarde' : '']
      .filter(Boolean)
      .join(' · ');
    const pick = picks[i] ?? '';
    const opt = (/** @type {string} */ v, /** @type {string} */ label) =>
      `<button class="seg ${pick === v ? 'is-on' : ''}" data-act="copy-pick" data-g="${i}" data-v="${esc(v)}" aria-pressed="${pick === v}">${esc(label)}</button>`;
    return `<li class="copy-row"><p><strong>${esc(g.name)}</strong> <span class="dim">${esc(what)}</span></p>
      <div class="segmented" role="group" aria-label="De quién es ${esc(g.name)}">${g.pids.map((p) => opt(p, 'De ' + nameOf(p))).join('')}${opt('', g.pids.length > 2 ? 'De todos' : 'De los dos')}</div></li>`;
  });
  return `<p class="dim">Esto quedó igual en más de un perfil por un error de Kai al cambiar de perfil. Elige de quién es cada serie: se quita de los demás.</p>
    <ul class="copy-list">${rows.join('')}</ul>
    <button class="btn btn-lamp" data-act="copies-apply" ${Object.values(picks).some(Boolean) ? '' : 'disabled'}>Separar</button>`;
}

/* ── Ajustes: lo que ya vieron todos los perfiles (solo informa; no borra nada) ── */
export async function paintSeenByAll(btn) {
  const box = $('#seen-all-list');
  if (!box) return;
  const profiles = visibleProfiles().filter((p) => !p.mergedInto);
  if (profiles.length < 2) {
    box.innerHTML = '<p class="dim">Solo hay un perfil: aquí aparecerá lo que hayan visto todos cuando haya más.</p>';
    return;
  }
  if (!state.storage || !state.library || state.library.v !== 2) {
    box.innerHTML = '<p class="dim">Necesitas conexión con MEGA para revisar.</p>';
    return;
  }
  btn.disabled = true;
  box.innerHTML = '<p class="dim">Revisando el progreso de cada perfil…</p>';
  try {
    const home = state.storage.root;
    const all = [];
    for (const p of profiles) {
      if (state.profile && p.id === state.profile.id) {
        all.push(state.progress);
        continue;
      }
      let items = {};
      for (const n of filesNamed(home, profileFile(p.id))) {
        const data = await readJson(n); // si no se puede leer, falla todo: nunca se supone "no visto"
        if (data && data.items) items = mergeProgress(items, data.items);
      }
      all.push(items);
    }
    const rows = [];
    let bytes = 0;
    for (const sr of state.library.series) {
      const done = sr.all.filter((ep) => all.every((pr) => (pr[ep.path] || {}).w));
      if (!done.length) continue;
      const size = done.reduce((t, ep) => t + (ep.size || 0), 0);
      bytes += size;
      const what = isCollection(sr)
        ? done.map(episodeLabel).join(', ')
        : done.length === sr.all.length
          ? 'todos los capítulos'
          : done.map((ep) => (ep.ep != null ? ep.ep : episodeLabel(ep))).join(', ');
      rows.push(`<li><strong>${esc(sr.name)}</strong>: ${esc(what)} <span class="dim">(${fmtSize(size)})</span></li>`);
    }
    box.innerHTML = rows.length
      ? `<ul class="seen-all">${rows.join('')}</ul><p class="dim">En total ${fmtSize(bytes)} que ya vieron ${profiles.map((p) => p.name).join(', ')}.</p>`
      : `<p class="dim">Todavía no hay capítulos que hayan terminado todos (${esc(profiles.map((p) => p.name).join(', '))}).</p>`;
  } catch (err) {
    box.innerHTML = `<p class="dim">${esc(megaMessage(err.cause || err))}</p>`;
  } finally {
    btn.disabled = false;
  }
}

export function renderSettings() {
  const s = state.settings;
  const unread = hasUnreadNews();
  markNewsRead();
  app.innerHTML =
    header('Ajustes') +
    `<main class="settings">
    <section class="settings-group is-first ${unread ? 'has-news' : ''}" id="news">${newsHTML()}</section>
    <section class="settings-group">
      <p class="settings-label">Apariencia</p>
      <div class="segmented" role="group" aria-label="Tema">${[
        ['auto', 'Automático'],
        ['light', 'Claro'],
        ['dark', 'Oscuro'],
      ]
        .map(
          ([v, l]) =>
            `<button class="seg ${s.theme === v ? 'is-on' : ''}" data-act="set-theme" data-v="${v}" aria-pressed="${s.theme === v}">${l}</button>`,
        )
        .join('')}</div>
      <p class="settings-label">Tono del modo claro</p>
      <div class="segmented" role="group" aria-label="Tono del modo claro">${Object.entries(TONES)
        .map(
          ([v, o]) =>
            `<button class="seg ${(s.tone || 'blanco') === v ? 'is-on' : ''}" data-act="set-tone" data-v="${v}" aria-pressed="${(s.tone || 'blanco') === v}">${o.label}</button>`,
        )
        .join('')}</div>
      <p class="settings-label">Tono del modo oscuro</p>
      <div class="segmented" role="group" aria-label="Tono del modo oscuro">${Object.entries(DARK_TONES)
        .map(
          ([v, o]) =>
            `<button class="seg ${(s.darkTone || 'negro') === v ? 'is-on' : ''}" data-act="set-dark-tone" data-v="${v}" aria-pressed="${(s.darkTone || 'negro') === v}">${o.label}</button>`,
        )
        .join('')}</div>
      <p class="dim settings-hint">El tono claro se usa con el tema Claro y el oscuro con el tema Oscuro; en Automático, cada uno según la hora del sistema.</p>
      <p class="settings-label">Animaciones</p>
      <div class="segmented" role="group" aria-label="Animaciones">${[
        ['auto', 'Automático'],
        ['full', 'Completas'],
        ['reduced', 'Reducidas'],
      ]
        .map(
          ([v, l]) =>
            `<button class="seg ${(s.motion || 'auto') === v ? 'is-on' : ''}" data-act="set-motion" data-v="${v}" aria-pressed="${(s.motion || 'auto') === v}">${l}</button>`,
        )
        .join('')}</div>
      <p class="settings-label">Modo liviano</p>
      <div class="segmented" role="group" aria-label="Modo liviano">${[
        ['auto', 'Automático'],
        ['on', 'Sí'],
        ['off', 'No'],
      ]
        .map(
          ([v, l]) =>
            `<button class="seg ${(s.lite || 'auto') === v ? 'is-on' : ''}" data-act="set-lite" data-v="${v}" aria-pressed="${(s.lite || 'auto') === v}">${l}</button>`,
        )
        .join('')}</div>
      <p class="dim settings-hint">Si Kai se traba al abrir o cerrar el video, elige Reducidas. El modo liviano quita los desenfoques. Se guarda en este dispositivo.</p>
    </section>
    ${(() => {
      const h = statsHTML();
      return h ? `<section class="settings-group" id="profile-stats">${h}</section>` : '';
    })()}
    <section class="settings-group" id="player-prefs">${playerPrefsHTML()}</section>
    <section class="settings-group" id="cine-key">${cineKeyHTML()}</section>
    <section class="settings-group">
      <p class="settings-label">Carpeta de series</p>
      <p class="settings-value">${esc(s.root)}</p>
      <a class="btn" href="#/explorar${state.library && state.library.rootId ? '/' + encodeURIComponent(state.library.rootId) : ''}">Cambiar carpeta</a>
    </section>
    <form id="settings" class="form settings-group">
      <label class="switch"><input type="checkbox" name="autoplay" ${s.autoplay ? 'checked' : ''}><span>Reproducir el siguiente capítulo solo</span></label>
      <label class="switch"><input type="checkbox" name="autoSkip" ${s.autoSkip ? 'checked' : ''}><span>Saltar intros solo cuando Kai sepa dónde están</span></label>
      <label class="switch"><input type="checkbox" name="cat" ${s.cat !== false ? 'checked' : ''}><span>Kai, el gatito, en el inicio</span></label>
      <label class="switch"><input type="checkbox" name="prefetchNext" ${s.prefetchNext !== false ? 'checked' : ''}><span>Preparar el siguiente capítulo para que empiece sin espera (usa unos 3 MB de MEGA)</span></label>
    </form>
    <section class="settings-group" id="dl-where">${downloadsWhereHTML()}</section>
    ${
      visibleProfiles().filter((p) => !p.mergedInto).length > 1
        ? `<section class="settings-group" id="copies">
      <p class="settings-label">Perfiles mezclados</p>
      <p class="dim">Si lo visto o Más tarde de un perfil apareció también en otro, aquí puedes separarlo.</p>
      <div id="copies-list"></div>
      <button class="btn" data-act="copies-check">${ICON.refresh}<span>Revisar</span></button>
    </section>`
        : ''
    }
    <section class="settings-group" id="seen-all">
      <p class="settings-label">Visto por todos</p>
      <p class="dim">Capítulos que ya terminaron todos los perfiles. Es solo un aviso, por si quieres liberar espacio en MEGA; Kai no borra nada.</p>
      <div id="seen-all-list"></div>
      <button class="btn" data-act="seen-all">${ICON.refresh}<span>Revisar</span></button>
    </section>
    <section class="settings-group">
      <p class="dim" id="space">Calculando espacio…</p>
      <p class="dim">${esc(quotaText(true))}</p>
      <div class="btn-row">
        <button class="btn" data-act="sync-now">Sincronizar ahora</button>
        <a class="btn" href="#/descargas">Ver descargados</a>
      </div>
    </section>
    <section class="settings-group">
      <p class="settings-label">Versión</p>
      <p class="settings-value" id="app-version">…</p>
      <button class="btn" data-act="check-update" id="check-update">${ICON.refresh}<span>${isUpdateReady() ? 'Actualizar ahora' : 'Buscar actualización'}</span></button>
    </section>
    <section class="settings-group">
      <p class="dim">Sesión de MEGA: ${esc((LS.get('session', {}).options || {}).email || '')}</p>
      <p class="dim">Datos de Kai en este navegador: ${(() => {
        const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
        const sizes = [];
        try {
          for (const k of Object.keys(localStorage))
            if (k.startsWith('kai.')) sizes.push([k.slice(4), (localStorage.getItem(k) || '').length]);
        } catch {
          /* nada */
        }
        const lib = LS.get('library', null);
        const libInfo =
          lib && lib.series ? ` · biblioteca guardada: ${lib.series.length} carpetas` : ' · sin biblioteca guardada';
        return (
          kb(sizes.reduce((a, b) => a + b[1], 0)) +
          ' (' +
          sizes
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([k, n]) => `${esc(k)} ${kb(n)}`)
            .join(', ') +
          ')' +
          libInfo
        );
      })()}${LS.full ? ' · <strong>sin espacio: algo no se pudo guardar</strong>' : LS.freed ? ' · se liberó espacio' : ''}</p>
      <button class="btn btn-quiet" data-act="logout">Cerrar sesión en este dispositivo</button>
    </section>
  </main>`;
  $('#settings').addEventListener('change', (e) => {
    const f = e.currentTarget;
    s.autoplay = f.autoplay.checked;
    s.autoSkip = f.autoSkip.checked;
    s.prefetchNext = f.prefetchNext.checked;
    s.cat = f.cat.checked;
    saveSettings();
  });
  paintSpace();
  paintDownloadsWhere();
  bindCineKey();
  swVersion().then((v) => {
    const el = $('#app-version');
    if (el) el.textContent = v || 'Sin instalar';
  });
}

/** Ajustes → Cine: la clave de TMDB, guardada en tu MEGA (no en el código) para que todos tus dispositivos la usen. */
export function cineKeyHTML(note = '') {
  const key = tmdbKey();
  const lib = state.library;
  const cine = lib && lib.series && lib.series.find(isCine);
  return `<p class="settings-label">Cine</p>
    <p class="dim">Películas que no son anime, en la carpeta <strong>${esc(state.settings.root)}/Cine</strong>, una subcarpeta por película (por ejemplo «El gigante de hierro (1999)»). No salen en el inicio: se abren con el botón Cine al final. Sus pósters y sinopsis vienen de TMDB.</p>
    ${
      key
        ? `<p class="settings-value">Clave de TMDB guardada (…${esc(key.slice(-4))})${cine ? '' : ' · todavía no hay carpeta Cine'}</p>
      <div class="btn-row"><button class="btn btn-quiet" data-act="tmdb-del">Quitar la clave</button></div>`
        : `<form class="form tmdb-form" id="tmdb-form" autocomplete="off">
        <label>Clave de la API de TMDB<input id="tmdb-key" name="k" type="password" spellcheck="false" autocapitalize="off" placeholder="Pega aquí tu clave"></label>
        <button class="btn" type="submit">Guardar</button>
      </form>`
    }
    ${note ? `<p class="dim" role="status">${esc(note)}</p>` : ''}`;
}
export function paintCineKey(note) {
  const el = $('#cine-key');
  if (el) {
    el.innerHTML = cineKeyHTML(note);
    bindCineKey();
  }
}
export function bindCineKey() {
  const f = $('#tmdb-form');
  if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = f.k.value.trim();
    if (!v) return;
    f.querySelector('button').textContent = 'Revisando…';
    let ok;
    try {
      ok = await tmdbCheckKey(v);
    } catch {
      paintCineKey('Sin conexión con TMDB. Intenta de nuevo.');
      return;
    }
    if (!ok) {
      paintCineKey(
        'TMDB dice que esa clave no es válida. Copia la «Clave de la API» de themoviedb.org → Ajustes → API.',
      );
      return;
    }
    setTmdbKey(v);
    paintCineKey('Lista. Kai ya está buscando las fichas de tus películas de Cine.');
  });
}

export function downloadsWhereHTML(perm = '') {
  if (!canFolder) {
    return `<p class="settings-label">Descargas</p>
      <p class="settings-value">Dentro de la app</p>
      <p class="dim">Este navegador no deja que una página guarde en una carpeta (Chrome y Edge en computadora sí lo permiten). Si quieres el archivo aparte, toca ⋯ en un capítulo descargado y elige «Guardar copia en el dispositivo».</p>`;
  }
  const d = currentDir();
  if (!d) {
    return `<p class="settings-label">Descargas</p>
      <p class="settings-value">Dentro de la app</p>
      <p class="dim">Puedes elegir una carpeta de este dispositivo: los capítulos quedarán ahí como MP4 normales, ordenados por serie y temporada.</p>
      <button class="btn" data-act="dir-pick">${ICON.folder}<span>Elegir carpeta</span></button>`;
  }
  return `<p class="settings-label">Descargas</p>
    <p class="settings-value">${ICON.folder} ${esc(d.name)}</p>
    <p class="dim">Cada capítulo queda como MP4 en <span class="mono">${esc(d.name)}/Serie/Temporada/</span>.${perm === 'prompt' ? ' Kai necesita que le vuelvas a dar permiso para usarla.' : ''}</p>
    <div class="btn-row">
      ${perm === 'prompt' ? '<button class="btn btn-lamp" data-act="dir-grant">Permitir acceso</button>' : ''}
      <button class="btn" data-act="dir-pick">Cambiar carpeta</button>
      <button class="btn" data-act="dir-off">Guardar dentro de la app</button>
    </div>`;
}
export async function paintDownloadsWhere() {
  const d = await getDir();
  const perm = d ? await dirPermission(d) : '';
  const el = $('#dl-where');
  if (el) el.innerHTML = downloadsWhereHTML(perm);
}

export async function paintSpace() {
  const el = $('#space');
  if (!el) return;
  const metas = await refreshSaved();
  const sum = (list) => list.reduce((a, m) => a + (m.size || 0), 0);
  const inApp = metas.filter((m) => m.done && m.where !== 'folder');
  const inFolder = metas.filter((m) => m.done && m.where === 'folder');
  const parts = [];
  if (inApp.length)
    parts.push(`${plural(inApp.length, 'capítulo', 'capítulos')} dentro de la app (${fmtSize(sum(inApp))})`);
  if (inFolder.length)
    parts.push(`${plural(inFolder.length, 'capítulo', 'capítulos')} en tu carpeta (${fmtSize(sum(inFolder))})`);
  let extra = '';
  try {
    const est = await navigator.storage.estimate();
    if (est.quota) extra = ` Espacio disponible para la app: ${fmtSize(Math.max(0, est.quota - est.usage))}.`;
  } catch {
    /* nada */
  }
  try {
    let kept = await navigator.storage.persisted();
    if (!kept) kept = await navigator.storage.persist();
    extra += kept
      ? ' El sistema guarda las descargas de forma permanente.'
      : ' El sistema podría borrar las descargas si se queda sin espacio.';
  } catch {
    /* no soportado */
  }
  if ($('#space'))
    $('#space').textContent = `${parts.length ? parts.join(' y ') + '.' : 'Ningún capítulo descargado.'}${extra}`;
}
