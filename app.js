import { isSubtitleName, mp4Info, mp4Chapters, mp4Formats, pickIntro, OUTRO_RE as OUTRO } from './models/subs.js';
import { movieHref } from './lib/route.js';
import { tmdbCheckKey, translateToSpanish, recommendationsFor, airingTop, toDiscover } from './models/meta-api.js';
import { $, LS, esc, sleep, debounce, fmtTime, fmtSize, hue, plural } from './lib/util.js';
import { ICON } from './views/icons.js';
import { sortEpisodes } from './models/naming.js';
import { DARK_TONES, TONES, profileFile, state, index, setIndex, knownEps, saveSettings, pkey, saveShared, visibleProfiles } from './models/store.js';
import { C, filesNamed, readJson, visibleChildren, megaMessage, login, connect, downloadUrl } from './models/mega.js';
import { langsOf, loadProfileState, nodePath, makeEpisode, isPlayable, buildLibrary, buildIndex, learnAudioLang, setLangPref, setLibrary, librarySignature } from './models/library.js';

import * as downloads from './models/downloads.js';
import { setInUseCheck, removeAllDownloads, refreshSaved, resumePendingDownloads, removeDownload, localBlob, holdWake, canFolder, currentDir, getDir, dirPermission, dirAccess, flushFolder, useFolder, forgetFolder } from './models/downloads.js';
import { episodeLabel } from './models/collections.js';
import { nextUnseen, resumeOffer } from './models/progress.js';
import { viewState } from './views/view-state.js';
import { startPicking, endPicking, pickAction } from './controllers/picking.js';
import { on } from './lib/events.js';
import { syncShared, syncProgress } from './models/sync.js';
import { countBytes, noteQuota, quotaUntil, refreshAccountInfo } from './models/quota.js';
import { quotaText, paintQuota } from './views/quota.js';
import { isCine, isCollection, collectionItems, itemMetaKey, itemFor, movieTitle, itemMeta } from './models/collections.js';
import { prog, setProgress, markNow, isLater, mergeProgress } from './models/progress.js';
import { setLaterFlag } from './models/progress.js';
import { profilesFromBackup, normName } from './models/profiles.js';
import { seasonLabel, saveMeta, seasonMeta, metaFor, tmdbKey } from './models/fichas.js';
import { ensureMeta, saveSyn, translateMissing, syncSynopses, syncFichas, resetFichas } from './models/fichas-sync.js';
import { idb } from './models/idb.js';
import { saveKnown, initKnown, newEpisodes, markSeriesSeen, newsList, hasUnreadNews, announceNew } from './models/news.js';
import { epById } from './models/library.js';
import { thumbFor } from './models/thumbs.js';
import { saveChapterCache, rangeReader, cacheChapters, formatProblem, formatSummary, rememberCodec } from './models/media.js';
import { hydrateThumbs } from './views/thumbs.js';
import { nextFor } from './models/plans.js';
import { seriesColor } from './models/fichas.js';
import { header, setTint, posterAny, entryTile, app, resetPosterCache } from './views/components.js';
import { setHero, renderHome } from './views/home.js';
import { dlButton, episodeRow } from './views/episodes.js';
import { renderSeries, renderMovie } from './views/series.js';
import { route } from './lib/route.js';
import { resolveContext, titleFor } from './models/context.js';

on('quota', paintQuota);
on('navigate', ({ hash, replace }) => {
  if (replace) { navReplacing = true; location.replace(hash); } else go(hash);
});
on('notice', (text) => toast(text));
on('download-changed', (id) => { paintEpisode(id); paintDrawerCount(); });
on('download-done', (ep) => { cacheChapters(ep).catch(() => {}); });
on('downloads-removed', () => { if (route().view === 'descargas') renderDownloads(); });
on('folder-moved', () => paintSpace());
setInUseCheck((id) => !!(playing && playing.ep.id === id));
viewState.isPlaying = () => !!playing;
on('news', () => paintNewsDot());
on('tree-changed', () => refreshLibrary());
on('meta-changed', (views) => { if (views.includes(route().view)) softRender(); });
on('sync-needed', () => sync());

/* ───────────────────────── utilidades ───────────────────────── */

/* ───────────────────────── estado ───────────────────────── */

setIndex(buildIndex(state.library));
loadProfileState();

/* ───────────────────────── nombres → capítulos ───────────────────────── */

/* ───────────────────────── IndexedDB ───────────────────────── */

/* ───────────────────────── MEGA ───────────────────────── */

function refreshLibrary(rerender = true) {
  if (!state.storage) return;
  const before = librarySignature(state.library);
  const hadError = !!state.error;
  try {
    const lib = buildLibrary(state.storage);
    if (librarySignature(lib) !== before || !state.library || state.library.v !== 2) setLibrary(lib);
    state.error = null;
    initKnown();
    announceNew();
    ensureMeta();
  } catch (err) {
    state.error = err;
  }
  const changed = librarySignature(state.library) !== before || hadError !== !!state.error;
  if (rerender && changed) softRender();
}

/* ───────────────────────── miniaturas ───────────────────────── */

/* ───────────────────────── capítulos fuera de la biblioteca ───────────────────────── */

/* ───────────────────────── progreso ───────────────────────── */

/** Lo que quedó viendo este perfil en otro dispositivo hace poco, si conviene ofrecer seguir aquí. */

function setLater(s, itemKey, on) {
  setLaterFlag(s, itemKey, on);
  toast(on ? 'Agregado a Más tarde.' : 'Quitado de Más tarde.');
  softRender();
  sync();
}

let syncing = null;
function sync() {
  if (syncing) return syncing;
  syncing = doSync().finally(() => { syncing = null; });
  return syncing;
}

async function doSync() {
  if (!state.storage || !navigator.onLine) return;
  const home = state.storage.root;
  state.syncState = 'syncing';
  paintSync();
  try {
    // 1) lo compartido entre perfiles
    const sharedChanged = await syncShared(home);
    // 1b) sinopsis traducidas y fichas (un fallo aquí no frena el progreso)
    try { await syncSynopses(home); } catch (err) { console.warn('sinopsis', err); }
    try { await syncFichas(home); } catch (err) { console.warn('fichas', err); }
    // 2) progreso del perfil activo
    const changedHere = await syncProgress(home);
    state.syncState = 'idle';
    if (changedHere || sharedChanged) softRender();
  } catch (err) {
    state.syncState = 'error';
    if (!state.sharedLoaded) {
      state.sharedError = true;
      state.sharedErrorMsg = megaMessage((err && err.cause) || err); // el motivo real: cuota, sesión, red…
      // sin poder leer el archivo de perfiles (p. ej. sin cuota), se muestran los del respaldo para poder entrar;
      // no se escribe nada en MEGA hasta poder leer el archivo de verdad
      for (const p of profilesFromBackup()) if (!state.shared.profiles.some((x) => x.id === p.id)) state.shared.profiles.push(p);
      if (!state.profile || route().view === 'perfiles') render();
    }
    console.warn('sync', err);
  }
  paintSync();
}

/** El estado de sincronización vive en el botón flotante: ruedita azul mientras sincroniza, puntito verde si está al día. */
const SYNC_LABEL = { offline: 'sin conexión', syncing: 'sincronizando', pending: 'por sincronizar', ok: 'al día' };
function paintSync() {
  const d = $('#dock');
  if (!d) return;
  const offline = !navigator.onLine;
  const pending = state.dirty || state.syncState === 'error';
  const st = offline ? 'offline' : state.syncState === 'syncing' ? 'syncing' : pending ? 'pending' : 'ok';
  d.dataset.sync = st;
  const btn = d.querySelector('.dock-btn');
  if (btn && btn.dataset.name) btn.setAttribute('aria-label', `Menú (${btn.dataset.name}), ${SYNC_LABEL[st]}${hasUnreadNews() ? ', hay novedades' : ''}`);
}

/* ───────────────────────── descargas ───────────────────────── */

/** Pone un capítulo en la cola de descargas (con el nombre de su serie para agruparlo en Descargados). */
function queueDownload(ep, title) {
  downloads.queueDownload(ep, title || titleFor(ep));
}
function downloadAndWait(ep, title) {
  return downloads.downloadAndWait(ep, title || titleFor(ep));
}

/** Elegir la carpeta de descargas (Chrome y Edge): el selector del navegador y el permiso. */
async function pickFolder() {
  let d;
  try { d = await window.showDirectoryPicker({ id: 'kai-descargas', mode: 'readwrite', startIn: 'videos' }); } catch { return; } // canceló
  if (!(await dirAccess(d, true))) { toast('Kai necesita permiso para guardar en esa carpeta.'); return; }
  await useFolder(d);
  toast(`Las descargas se guardarán en «${d.name}».`);
  if (route().view === 'ajustes') renderSettings();
  flushFolder();
}
function dropFolder() {
  if (!confirm('Las descargas nuevas se guardarán dentro de la app. Lo que ya está en la carpeta se queda ahí y Kai lo sigue usando.')) return;
  forgetFolder();
  if (route().view === 'ajustes') renderSettings();
}

/** Copia aparte del capítulo (Safari, iPhone, Firefox): el navegador la guarda en Descargas o en Archivos. */
async function exportCopy(ep) {
  const blob = await localBlob(ep, true).catch(() => null);
  if (!blob) { toast('Primero descarga el capítulo.'); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = ep.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

/* ───────────────────────── rutas y vistas ───────────────────────── */

/* Historial propio de Kai: "volver" salta las entradas que son la misma página (otra pestaña o
 * temporada de la misma serie) hasta llegar a una distinta, en vez de retroceder de a un paso. */
const navStack = [location.hash || '#/'];
let navBackSteps = 0; // pasos que Kai mismo pidió retroceder
let navReplacing = false;
const navPage = (h) => String(h || '#/').split('?')[0];
/* Al volver atrás (deslizar desde el borde en iPhone, o el botón), la página vuelve a donde estaba, no arriba:
 * si no, Safari muestra la foto de la página donde estabas y luego salta al inicio, y las portadas parpadean. */
const scrollMemo = new Map();
let navWasBack = false;
addEventListener('scroll', () => { scrollMemo.set(location.hash || '#/', window.scrollY); }, { passive: true });
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
function onHashChange() {
  const h = location.hash || '#/';
  navWasBack = !!navBackSteps || (navStack.length > 1 && navStack[navStack.length - 2] === h);
  if (navBackSteps) { navStack.length = Math.max(1, navStack.length - navBackSteps); navBackSteps = 0; navStack[navStack.length - 1] = h; }
  else if (navReplacing) { navStack[navStack.length - 1] = h; navReplacing = false; }
  else if (navStack.length > 1 && navStack[navStack.length - 2] === h) navStack.pop(); // botón atrás del navegador
  else if (navStack[navStack.length - 1] !== h) navStack.push(h);
}
function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }
function goHome() {
  if (navPage(location.hash) === '#/' || !location.hash) { render(); return; }
  // si el inicio está en el historial, se vuelve a él; si no, se va directo
  const i = navStack.map(navPage).lastIndexOf('#/');
  if (i >= 0 && i < navStack.length - 1) { navBackSteps = navStack.length - 1 - i; history.go(-navBackSteps); }
  else go('#/');
}
function goBack(fallback = '#/') {
  const cur = navPage(navStack[navStack.length - 1]);
  let i = navStack.length - 2;
  while (i >= 0 && navPage(navStack[i]) === cur) i--;
  if (i >= 0) { navBackSteps = navStack.length - 1 - i; history.go(-navBackSteps); }
  else { navReplacing = true; location.replace(fallback); }
}

let lastRouteKey = '';

/** Vuelve a dibujar la vista actual sin tocar el reproductor. */
function softRender() {
  if (route().view === 'play') { paintWatchInfo(); return; }
  render();
}

function render() {
  closeDrawer();
  if (!LS.get('session', null)) { stopPlayback(); renderLogin(); return; }
  const { view, arg } = route();
  if (!state.profile || !visibleProfiles().some((p) => p.id === state.profile.id) && state.sharedLoaded) {
    if (state.profile && state.sharedLoaded) { state.profile = null; LS.del('profile'); }
    if (!state.profile) { stopPlayback(); renderProfiles(); paintDock(); lastRouteKey = 'perfiles'; return; }
  }
  if (view === 'perfiles') { stopPlayback(); renderProfiles(); paintDock(); lastRouteKey = 'perfiles'; return; }
  if (viewState.picking && (view !== 'serie' || String(viewState.picking.si) !== arg.split('/')[0])) endPicking(false);
  if (view === 'play') {
    const c = resolveContext(arg);
    const si = c && c.si;
    setTint(si != null && state.library.series[si] ? seriesColor(state.library.series[si]) : null);
    renderWatch(arg);
  } else {
    if (playing && video.currentSrc) enterMini(); else stopPlayback();
    setTint(null);
    if (view === 'serie') renderSeries(arg);
    else if (view === 'pelicula') renderMovie(arg);
    else if (view === 'explorar') renderExplorer(arg);
    else if (view === 'catalogo') renderCatalog();
    else if (view === 'descargas') renderDownloads();
    else if (view === 'ajustes') renderSettings();
    else if (view === 'descubrir') renderDiscover(arg);
    else renderHome();
  }
  paintSync();
  paintDock();
  hydrateThumbs(app);
  const key = view + '/' + arg;
  if (key !== lastRouteKey && view !== 'play') window.scrollTo(0, navWasBack ? scrollMemo.get(location.hash || '#/') || 0 : 0);
  navWasBack = false;
  if (key !== lastRouteKey && view === 'play' && lastRouteKey.split('/')[0] !== 'play') window.scrollTo(0, 0);
  lastRouteKey = key;
}

/* ── botón flotante (reemplaza el menú lateral) ── */

const dock = $('#dock');

function paintDock() {
  const v = route().view;
  const show = !!(LS.get('session', null) && state.profile && v !== 'perfiles');
  dock.hidden = !show;
  if (!show) { closeDock(); return; }
  const p = visibleProfiles().find((x) => x.id === state.profile.id) || state.profile;
  const btn = dock.querySelector('.dock-btn');
  btn.innerHTML = `${avatarHTML(p, 'dock-avatar')}<span class="dock-top" aria-hidden="true">${ICON.top}</span><span class="dock-ring" aria-hidden="true"></span><span class="dock-state" aria-hidden="true"></span>`;
  btn.dataset.name = p.name;
  paintSync();
  paintNewsDot();
  if (!dock.querySelector('.dock-panel').hidden) fillDock();
}

function fillDock() {
  const { view } = route();
  const p = visibleProfiles().find((x) => x.id === state.profile.id) || state.profile;
  const item = (href, icon, label, on, extra = '') => `<a class="dock-item ${on ? 'is-on' : ''}" href="${href}" role="menuitem">${icon}<span>${label}</span>${extra}</a>`;
  const dark = resolvedTheme() === 'dark';
  dock.querySelector('.dock-panel').innerHTML = `
    <a class="dock-profile" href="#/perfiles" role="menuitem">${avatarHTML(p)}<span><span class="dock-pname">${esc(p.name)}</span><span class="dock-psub">Cambiar perfil</span></span></a>
    ${item('#/', ICON.home, 'Inicio', view === 'home' || view === 'serie')}
    ${item('#/explorar', ICON.folder, 'Explorar MEGA', view === 'explorar')}
    ${item('#/descargas', ICON.saved, 'Descargados', view === 'descargas', `<span class="dock-count" id="dock-count">${state.saved.size || ''}</span>`)}
    ${item('#/ajustes', ICON.gear, 'Ajustes', view === 'ajustes', hasUnreadNews() ? '<span class="dock-news">Novedades</span>' : '')}
    <div class="dock-row">
      <button class="dock-chip" data-act="refresh" role="menuitem">${ICON.refresh}<span>Actualizar</span></button>
      <button class="dock-chip" data-act="theme" role="menuitem">${dark ? ICON.sun : ICON.moon}<span>${dark ? 'Claro' : 'Oscuro'}</span></button>
    </div>
    <p class="dock-quota" id="drawer-quota">${quotaText()}</p>`;
}

function openDock() {
  fillDock();
  const panel = dock.querySelector('.dock-panel');
  panel.hidden = false;
  dock.classList.add('is-open');
  dock.querySelector('.dock-btn').setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => panel.classList.add('is-in'));
  const first = panel.querySelector('.dock-item.is-on') || panel.querySelector('.dock-item');
  if (first) first.focus({ preventScroll: true });
}
function closeDock() {
  const panel = dock.querySelector('.dock-panel');
  if (!panel || panel.hidden) return;
  panel.classList.remove('is-in');
  dock.classList.remove('is-open');
  dock.querySelector('.dock-btn').setAttribute('aria-expanded', 'false');
  setTimeout(() => { if (!panel.classList.contains('is-in')) panel.hidden = true; }, 180);
}
/* Ir arriba: en pantallas táctiles, el botón flotante se vuelve una flecha cuando bajaste más de dos pantallas
 * y empiezas a subir. Vuelve a ser el de siempre al llegar arriba, al seguir bajando o tras unos segundos quieto.
 * (UP_ON_IOS: en iPhone/iPad ya se sube tocando la hora; se deja encendido mientras Alex lo prueba.) */
const UP_ON_IOS = true;
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const UP_ENABLED = matchMedia('(pointer: coarse)').matches && (UP_ON_IOS || !IS_IOS);
let upLastY = 0, upIdle = 0, upFrame = 0, upHoldUntil = 0; // upHoldUntil: mientras sube solo, no volver a mostrar la flecha
function setDockUp(on) {
  if (dock.classList.contains('is-up') === on) return;
  dock.classList.toggle('is-up', on);
  const btn = dock.querySelector('.dock-btn');
  if (btn) btn.setAttribute('aria-label', on ? 'Ir arriba' : 'Menú');
}
function checkDockUp() {
  upFrame = 0;
  const y = window.scrollY;
  const dy = y - upLastY;
  if (Math.abs(dy) < 6) return; // movimientos mínimos no cuentan
  upLastY = y;
  clearTimeout(upIdle);
  const ok = !dock.hidden && !dock.classList.contains('is-open') && route().view !== 'play';
  if (!ok || y < 80 || dy > 0 || Date.now() < upHoldUntil) { setDockUp(false); return; }
  if (y > window.innerHeight * 2) {
    setDockUp(true);
    upIdle = setTimeout(() => setDockUp(false), 3000);
  }
}
if (UP_ENABLED) {
  addEventListener('scroll', () => { if (!upFrame) upFrame = requestAnimationFrame(checkDockUp); }, { passive: true });
}

// nombres antiguos que aún usan otras partes
const closeDrawer = closeDock;
function paintDrawerCount() {
  const el = $('#dock-count');
  if (el) el.textContent = state.saved.size || '';
}
// Con el menú abierto, tocar fuera solo lo cierra: ese toque no abre un capítulo, ni reproduce, ni sigue un enlace.
let dockSwallow = 0; // hasta cuándo se ignora el clic de ese toque
document.addEventListener('pointerdown', (e) => {
  if (!dock.classList.contains('is-open')) { dockSwallow = 0; return; } // un toque nuevo con el menú cerrado nunca se ignora
  if (dock.contains(e.target)) return;
  closeDock();
  e.stopPropagation(); // que no llegue a los gestos del reproductor
  dockSwallow = Date.now() + 800;
}, true);
document.addEventListener('click', (e) => {
  if (Date.now() > dockSwallow || dock.contains(e.target)) return;
  dockSwallow = 0;
  e.preventDefault();
  e.stopPropagation();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dock.classList.contains('is-open')) { closeDock(); dock.querySelector('.dock-btn').focus(); }
});

/* ── entrar ── */

let loginNote = ''; // aviso que se mantiene en la pantalla de entrar aunque se vuelva a dibujar
function renderLogin(message = loginNote, needCode = false, email = '') {
  app.innerHTML = `<main class="login">
    <div class="login-mark" aria-hidden="true"><img class="login-icon" src="icon-192.png" alt=""></div>
    <h1 class="login-title">Kai</h1>
    <p class="login-lead">Tus series de MEGA, donde te quedaste, en cualquier pantalla.</p>
    <form id="login" class="form" autocomplete="on">
      <label>Correo de MEGA<input name="email" type="email" required autocomplete="username" value="${esc(email)}"></label>
      <label>Contraseña<input name="password" type="password" required autocomplete="current-password"></label>
      ${needCode ? '<label>Código de verificación<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></label>' : ''}
      ${message ? `<p class="form-error" role="alert">${esc(message)}</p>` : ''}
      <button class="btn btn-lamp" type="submit">Entrar</button>
      <p class="form-note">Tu contraseña va directo a MEGA y no se guarda. En este dispositivo solo queda la sesión.</p>
    </form>
  </main>`;
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    try {
      await login(f.get('email').toString().trim(), f.get('password').toString(), f.get('code') && f.get('code').toString());
      loginNote = '';
      refreshLibrary(false);
      location.hash = '#/';
      render();
      sync();
    } catch (err) {
      const m = megaMessage(err);
      if (m === 'MFA') renderLogin('', true, f.get('email').toString());
      else renderLogin(m, needCode, f.get('email').toString());
    }
  });
}

/* ── perfiles ── */

const AVATAR_HUES = [210, 340, 150, 30, 270, 190, 0, 90];

function avatarHTML(p, cls = '') {
  const h = p.hue ?? hue(p.name);
  return `<span class="avatar ${cls}" style="--h:${h}" aria-hidden="true">${esc([...p.name.trim()][0] || '?').toUpperCase()}</span>`;
}

function renderProfiles(editing = false, adding = false) {
  const list = visibleProfiles();
  // solo se ofrece crear perfil cuando Kai pudo confirmar en MEGA cuáles existen
  const blocked = !state.sharedLoaded;
  const failed = blocked && (state.sharedError || !navigator.onLine);
  const waiting = blocked && !failed;
  const first = !list.length;
  app.innerHTML = `<main class="profiles">
    <div class="profiles-inner">
      <h1 class="profiles-title">${first && !blocked ? 'Crea tu perfil' : '¿Quién está viendo?'}</h1>
      ${first && !blocked ? '<p class="profiles-lead">Cada perfil guarda su propio progreso y aparece en todos tus dispositivos.</p>' : ''}
      ${waiting && first ? '<p class="profiles-lead">Buscando perfiles en tu MEGA…</p>' : ''}
      ${failed ? `<p class="profiles-lead">${navigator.onLine ? 'No pude leer tus perfiles en MEGA.' : 'Conéctate a internet para cargar tus perfiles.'}</p>
        ${navigator.onLine && state.sharedErrorMsg && state.sharedErrorMsg !== 'MFA' ? `<p class="profiles-why">${esc(state.sharedErrorMsg)}${/límite de transferencia/i.test(state.sharedErrorMsg) ? ' MEGA cuenta ese límite por conexión: con datos móviles u otra red suele funcionar de inmediato.' : ''}</p>` : ''}
        ${navigator.onLine && list.length ? '<p class="profiles-why">Puedes entrar con tu perfil igual: tu progreso se junta con el de MEGA en cuanto se pueda leer.</p>' : ''}
        ${navigator.onLine ? '<button class="btn btn-lamp" data-act="profiles-retry">Reintentar</button>' : ''}` : ''}
      <ul class="profile-grid">
        ${list.map((p) => `<li><button class="profile-tile ${editing ? 'is-editing' : ''}" data-act="${editing ? 'profile-delete' : 'profile-pick'}" data-id="${esc(p.id)}">
          ${avatarHTML(p, 'avatar-xl')}<span class="profile-name">${esc(p.name)}</span>${editing ? '<span class="profile-remove">Quitar</span>' : ''}
        </button></li>`).join('')}
        ${!editing && !blocked ? `<li>${adding || first ? `<form class="profile-new" id="profile-new">
            <input name="name" maxlength="20" placeholder="Nombre" required autocomplete="off" aria-label="Nombre del perfil">
            <button class="btn btn-lamp" type="submit">Crear</button>
          </form>` : `<button class="profile-tile is-add" data-act="profile-add"><span class="avatar avatar-xl avatar-add" aria-hidden="true">+</span><span class="profile-name">Agregar</span></button>`}</li>` : ''}
      </ul>
      ${list.length && !blocked ? `<button class="btn" data-act="${editing ? 'profiles-done' : 'profiles-edit'}">${editing ? 'Listo' : 'Editar perfiles'}</button>` : ''}
    </div>
  </main>`;
  const form = $('#profile-new');
  if (form) {
    form.name.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      if (!name) return;
      const btn = form.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Revisando…';
      await createProfile(name);
    });
  }
}

async function createProfile(name) {
  // antes de crear, vuelve a mirar MEGA por si otro dispositivo ya creó perfiles
  if (navigator.onLine) {
    try {
      await connect();
      if (syncing) await syncing.catch(() => {});
      await sync();
    } catch { /* se revisa abajo */ }
    if (!state.sharedLoaded || state.sharedError) { renderProfiles(); return; }
  }
  const same = visibleProfiles().find((x) => normName(x.name) === normName(name));
  if (same) {
    toast(`Ya tenías el perfil ${same.name}; entraste con ese.`);
    selectProfile(same.id);
    return;
  }
  const isFirst = !state.shared.profiles.length;
  const used = new Set(state.shared.profiles.map((p) => p.hue));
  const p = { id: Math.random().toString(36).slice(2, 10), name, hue: AVATAR_HUES.find((h) => !used.has(h)) ?? hue(name), created: Date.now(), u: Date.now() };
  state.shared.profiles.push(p);
  if (isFirst && !state.shared.legacyBy) state.shared.legacyBy = p.id;
  saveShared();
  // el progreso de antes de los perfiles pasa al primero
  if (isFirst) {
    const old = LS.get('progress', null);
    if (old) { LS.set(`p.${p.id}.progress`, old); LS.set(`p.${p.id}.dirty`, true); LS.del('progress'); LS.del('dirty'); }
  }
  selectProfile(p.id);
}

function selectProfile(id) {
  const p = visibleProfiles().find((x) => x.id === id);
  if (!p) return;
  if (state.profile && state.profile.id !== id) { savePosition(true); stopPlayback(); }
  state.profile = { id: p.id, name: p.name };
  LS.set('profile', state.profile);
  loadProfileState();
  initKnown();
  announceNew();
  location.hash = '#/';
  render();
  sync();
}

/* ── capítulos nuevos ── */

function paintNewsDot() {
  const btn = dock && dock.querySelector('.dock-btn');
  if (btn) btn.classList.toggle('has-news', hasUnreadNews());
}
function newsHTML() {
  const lib = state.library && state.library.v === 2 ? state.library : null;
  const items = newsList();
  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    return m < 60 ? `hace ${Math.max(1, m)} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
  };
  const rows = items.map((x) => {
    const si = lib ? lib.series.findIndex((s) => s.name === x.name) : -1;
    const what = `${x.n === 1 ? 'un capítulo nuevo' : `${x.n} capítulos nuevos`}`;
    const label = `<strong>${esc(x.name)}</strong>: ${what} <span class="dim">· ${ago(x.at)}</span>`;
    return `<li>${si >= 0 ? `<a href="#/serie/${si}">${label}</a>` : label}</li>`;
  });
  return `<p class="settings-label">Novedades</p>
    ${rows.length ? `<ul class="news-list">${rows.join('')}</ul><button class="btn btn-quiet" data-act="news-clear">Limpiar</button>`
      : '<p class="dim">Aquí aparece lo que se agregue a tu MEGA. Por ahora no hay nada nuevo.</p>'}
    ${!rows.length && lib && lib.series.some((s) => newEpisodes(s).length) ? '<button class="btn btn-quiet" data-act="news-clear">Quitar las burbujas de "nuevo"</button>' : ''}`;
}

/* ── sinopsis e imágenes ── */

/* ── portada estilo TV ── */

/* ── Ajustes: lo que ya vieron todos los perfiles (solo informa; no borra nada) ── */
async function paintSeenByAll(btn) {
  const box = $('#seen-all-list');
  if (!box) return;
  const profiles = visibleProfiles().filter((p) => !p.mergedInto);
  if (profiles.length < 2) { box.innerHTML = '<p class="dim">Solo hay un perfil: aquí aparecerá lo que hayan visto todos cuando haya más.</p>'; return; }
  if (!state.storage || !state.library || state.library.v !== 2) { box.innerHTML = '<p class="dim">Necesitas conexión con MEGA para revisar.</p>'; return; }
  btn.disabled = true;
  box.innerHTML = '<p class="dim">Revisando el progreso de cada perfil…</p>';
  try {
    const home = state.storage.root;
    const all = [];
    for (const p of profiles) {
      if (state.profile && p.id === state.profile.id) { all.push(state.progress); continue; }
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
      const what = isCollection(sr) ? done.map(episodeLabel).join(', ') : done.length === sr.all.length ? 'todos los capítulos' : done.map((ep) => ep.ep != null ? ep.ep : episodeLabel(ep)).join(', ');
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

/* ── catálogo: todo lo que hay, con buscador y filtros ── */

const norm = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Series y, de las colecciones, cada película por separado (cada una con sus etiquetas de AniList). */
function catalogEntries() {
  const lib = state.library;
  if (!lib || lib.v !== 2) return [];
  const out = [];
  lib.series.forEach((s, si) => {
    if (isCollection(s)) {
      for (const it of collectionItems(s)) {
        const m = itemMeta(s, it.key);
        const title = it.title || (m && m.title) || it.eps[0].name.replace(/\.[^.]+$/, '');
        out.push({
          si, title: movieTitle(s, it), m, img: m && (m.banner || m.cover), year: m && m.year, genres: (m && m.genres) || [], format: 'Película',
          added: Math.max(0, ...it.eps.map((e) => e.ts || 0)), href: movieHref(si, it.key), movie: it.key, cine: isCine(s), langs: langsOf(it.eps),
          words: norm([title, m && m.title, m && m.romaji, m && m.native, s.name].join(' ')),
        });
      }
    } else {
      const m = metaFor(s);
      out.push({
        si, title: s.name, m, img: m && (m.banner || m.cover), year: m && m.year, genres: (m && m.genres) || [],
        format: (m && m.format) || 'Serie', added: s.added || 0, count: s.all.length, langs: langsOf(s.all),
        words: norm([s.name, m && m.title, m && m.romaji, m && m.native, ...s.seasons.map((se) => se.title)].join(' ')),
      });
    }
  });
  return out;
}
function filterEntries(list, { q = '', g = '', y = '', f = '', l = '' }) {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  return list.filter((e) => terms.every((t) => e.words.includes(t))
    && (!g || e.genres.includes(g)) && (!y || String(e.year) === String(y)) && (!f || e.format === f) && (!l || (e.langs || []).includes(l)));
}
function sortEntries(list, o) {
  const az = (a, b) => a.title.localeCompare(b.title, 'es', { numeric: true });
  if (o === 'recent') return list.sort((a, b) => (b.added || 0) - (a.added || 0) || az(a, b));
  if (o === 'year') return list.sort((a, b) => (b.year || 0) - (a.year || 0) || az(a, b));
  return list.sort(az); // por defecto, A–Z (v37)
}

/* Dos catálogos, Series y Películas (?t=series | ?t=peliculas). Al buscar o filtrar por una etiqueta,
 * se busca en todo: series y películas juntas. */
const CAT_TITLES = { series: 'Series', peliculas: 'Películas' };
const isFiltering = (st) => !!(st.q || st.g || st.y || st.f || st.l);
function catalogBase(t, st) {
  const all = catalogEntries().filter((e) => !e.cine || st.q); // Cine no se mezcla: solo aparece al buscar
  if (!CAT_TITLES[t] || isFiltering(st)) return all;
  return all.filter((e) => (t === 'peliculas') === !!e.movie);
}
function renderCatalog() {
  const q = route().q;
  const t = CAT_TITLES[q.get('t')] ? q.get('t') : '';
  const all = catalogEntries();
  const count = (key) => {
    const m = new Map();
    for (const e of all) for (const v of [].concat(e[key] || [])) if (v) m.set(String(v), (m.get(String(v)) || 0) + 1);
    return m;
  };
  const genres = [...count('genres').entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es')).map(([v, n]) => [v, `${v} (${n})`]);
  const years = [...count('year').keys()].sort((a, b) => b - a).map((v) => [v, v]);
  const formats = [...count('format').keys()].sort().map((v) => [v, v]);
  const select = (name, label, opts, all = true) => {
    const cur = q.get(name) || '';
    const known = !cur || opts.some(([v]) => v === cur);
    return `<label class="cat-select"><span>${label}</span><select name="${name}">
      ${all ? `<option value="">Todos</option>` : ''}${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      ${known ? '' : `<option value="${esc(cur)}" selected>${esc(cur)}</option>`}</select></label>`;
  };
  app.innerHTML = header(CAT_TITLES[t] || 'Catálogo') + `<main class="catalog" data-t="${t}">
    <form class="cat-search" id="cat-form" role="search">
      <span class="search-icon">${ICON.search}</span>
      <input id="cat-q" name="q" type="search" placeholder="Buscar series y películas" value="${esc(q.get('q') || '')}" autocomplete="off" enterkeyhint="search" aria-label="Buscar">
    </form>
    <div class="cat-filters" id="cat-filters">
      ${select('g', 'Género', genres)}${select('y', 'Año', years)}${select('f', 'Tipo', formats)}
      ${all.some((e) => e.langs && e.langs.length) ? select('l', 'Idioma', [['sub', 'Subtitulado'], ['dob', 'Doblado']]) : ''}
      ${select('o', 'Orden', [['az', 'A–Z'], ['recent', 'Recientes'], ['year', 'Año']], false)}
      <button class="link-btn cat-clear" type="button" data-act="cat-clear" hidden>Quitar filtros</button>
    </div>
    <p class="dim cat-count" id="cat-count" aria-live="polite"></p>
    <div id="cat-results"></div>
  </main>`;
  const form = $('#cat-form');
  form.addEventListener('submit', (e) => { e.preventDefault(); $('#cat-q').blur(); });
  $('#cat-q').addEventListener('input', debounce(paintCatalog, 120));
  $('#cat-filters').addEventListener('change', paintCatalog);
  paintCatalog();
  if (q.get('buscar') === '1') $('#cat-q').focus();
}
function catalogState() {
  const val = (n) => { const el = app.querySelector(`#cat-filters [name="${n}"]`); return el ? el.value : ''; };
  return { q: ($('#cat-q') || {}).value || '', g: val('g'), y: val('y'), f: val('f'), l: val('l'), o: val('o') || 'az' };
}
function paintCatalog() {
  const box = $('#cat-results');
  if (!box) return;
  const st = catalogState();
  const t = (app.querySelector('.catalog') || {}).dataset?.t || '';
  const list = sortEntries(filterEntries(catalogBase(t, st), st), st.o);
  // series y películas, como pósters
  const posters = true;
  // si al teclear sigue saliendo lo mismo, no se vuelven a dibujar todos los mosaicos
  const sig = (posters ? 'p' : 't') + list.map((e) => e.href || e.si).join('|') + '#' + list.map((e) => e.img || '').join('').length;
  if (box.dataset.sig !== sig) {
    resetPosterCache();
    box.innerHTML = posters ? `<ul class="shelf" role="list">${list.map(posterAny).join('')}</ul>` : `<div class="tiles is-grid" role="list">${list.map(entryTile).join('')}</div>`;
    box.dataset.sig = sig;
    if (posters) hydrateThumbs(box);
  }
  $('#cat-count').textContent = list.length ? plural(list.length, 'título', 'títulos') : (state.library ? 'Nada coincide con la búsqueda o los filtros.' : 'Cargando la biblioteca…');
  app.querySelector('[data-act="cat-clear"]').hidden = !(st.g || st.y || st.f || st.l || st.q);
  // la dirección refleja la búsqueda (para volver atrás o compartirla), sin redibujar la página
  const params = new URLSearchParams();
  if (t) params.set('t', t);
  for (const k of ['q', 'g', 'y', 'f', 'l']) if (st[k]) params.set(k, st[k]);
  if (st.o !== 'az') params.set('o', st.o);
  const h = '#/catalogo' + (params.toString() ? '?' + params : '');
  if (location.hash !== h) history.replaceState(null, '', h);
}

/* búsqueda rápida desde el inicio */
function openHomeSearch() {
  const bar = $('#home-search');
  if (!bar) return;
  bar.hidden = false;
  app.querySelector('[data-act="home-search"]').setAttribute('aria-expanded', 'true');
  const input = $('#home-q');
  input.focus();
  input.oninput = debounce(paintHomeSearch, 120);
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); go('#/catalogo?' + new URLSearchParams({ q: input.value })); }
    else if (e.key === 'Escape') closeHomeSearch();
  };
}
// tocar o hacer clic en cualquier otra parte cierra el buscador (sus resultados y la lupa no cuentan)
document.addEventListener('pointerdown', (e) => {
  const bar = $('#home-search');
  if (!bar || bar.hidden) return;
  if (e.target.closest('#home-search, #home-results, [data-act="home-search"]')) return;
  closeHomeSearch();
});
function closeHomeSearch() {
  const bar = $('#home-search');
  if (!bar) return;
  bar.hidden = true;
  $('#home-q').value = '';
  app.querySelector('[data-act="home-search"]').setAttribute('aria-expanded', 'false');
  paintHomeSearch();
}
function paintHomeSearch() {
  const box = $('#home-results');
  const tv = app.querySelector('.tv.is-home');
  if (!box || !tv) return;
  const qv = ($('#home-q') || {}).value || '';
  const on = !!qv.trim();
  tv.classList.toggle('is-searching', on);
  box.hidden = !on;
  if (!on) { box.innerHTML = ''; return; }
  const list = sortEntries(filterEntries(catalogEntries(), { q: qv }), 'az');
  box.innerHTML = `<div class="tv-row-head"><h3 class="tv-row-title">${list.length ? plural(list.length, 'resultado', 'resultados') : 'Sin resultados'}</h3>
      <a class="tv-more" href="#/catalogo?${new URLSearchParams({ q: qv })}">${ICON.grid}<span>Buscar en el catálogo</span></a></div>
    <ul class="shelf is-row" role="list">${list.slice(0, 24).map(posterAny).join('')}</ul>`;
  resetPosterCache();
}

/* ── serie ── */

/* ── películas: el estante (la carpeta) y la página de cada una ── */

/* ── selección de varios capítulos de una temporada para descargarlos juntos ── */

/* Las imágenes aparecen con un fundido solo la primera vez que se cargan. Al redibujar una página (o volver a
 * ella) las que ya estaban cargadas se muestran de una vez: si no, todas parpadeaban en cada cambio. */
const seenImgs = new Set();
function settleImages(root) {
  for (const img of root.querySelectorAll ? root.querySelectorAll('img') : []) {
    if (seenImgs.has(img.src) || (img.complete && img.naturalWidth)) {
      // ya cargada: sin fundido y dibujada en el mismo instante (sin el cuadro vacío de la carga diferida)
      img.classList.add('no-fade'); img.decoding = 'sync'; img.loading = 'eager'; seenImgs.add(img.src);
    }
    else img.addEventListener('load', () => seenImgs.add(img.src), { once: true });
  }
}
new MutationObserver((list) => {
  for (const m of list) for (const n of m.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.tagName === 'IMG') settleImages(n.parentNode || n); else settleImages(n);
  }
}).observe(document.body, { childList: true, subtree: true });

function paintEpisode(id) {
  const ep = epById(id);
  if (!ep) return;
  document.querySelectorAll(`.ep[data-id="${CSS.escape(id)}"] [data-act="dl"]`).forEach((btn) => { btn.outerHTML = dlButton(ep); });
  const wd = document.querySelector(`[data-act="w-dl"][data-id="${CSS.escape(id)}"]`);
  if (wd) wd.outerHTML = watchDlButton(ep);
}

/* ── explorar MEGA ── */

function renderExplorer(arg) {
  const st = state.storage;
  if (!st) {
    app.innerHTML = header('Explorar') + `<main><section class="empty">
      <p class="dim">${navigator.onLine ? 'Conectando con MEGA…' : 'Explorar necesita conexión. Lo que descargaste está en Descargados.'}</p>
      ${navigator.onLine ? '' : '<a class="btn" href="#/descargas">Ver descargados</a>'}</section></main>`;
    return;
  }
  let node = (arg && st.files[arg]) || st.root;
  if (!node.directory) node = node.parent || st.root;
  const crumbs = [];
  for (let n = node; n; n = n.parent) crumbs.unshift(n);
  const kids = visibleChildren(node).filter((c) => !c.name.startsWith('.'));
  const folders = kids.filter((c) => c.directory).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  const here = nodePath(node);
  const videos = sortEpisodes(kids.filter(isPlayable).map((f) => index.byId.get(f.nodeId)?.ep || makeEpisode(f, here, kids)));
  videos.forEach((v) => { if (!index.byId.has(v.id)) knownEps.set(v.id, v); });
  const others = kids.filter((c) => !c.directory && !isPlayable(c)).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  const isRoot = node === st.root;
  const isLibrary = state.library && state.library.rootId === node.nodeId;

  app.innerHTML = header('Explorar') + `<main class="explorer">
    <nav class="crumbs" aria-label="Ubicación">${crumbs.map((n, i) => i === crumbs.length - 1
      ? `<span aria-current="page">${esc(n === st.root ? 'Mi MEGA' : n.name)}</span>`
      : `<a href="#/explorar/${encodeURIComponent(n.nodeId)}">${esc(n === st.root ? 'Mi MEGA' : n.name)}</a>`).join('<span class="crumb-sep" aria-hidden="true">/</span>')}</nav>
    ${!isRoot ? `<div class="explorer-actions">${isLibrary
      ? '<p class="dim">Esta es tu carpeta de series.</p>'
      : `<button class="btn" data-act="set-root" data-id="${esc(node.nodeId)}">Usar como carpeta de series</button>`}</div>` : ''}
    ${!kids.length ? '<p class="empty dim">Carpeta vacía.</p>' : ''}
    ${folders.length ? `<ul class="files">${folders.map((f) => {
      const n = visibleChildren(f).filter((c) => !c.name.startsWith('.')).length;
      return `<li><a class="file-row" href="#/explorar/${encodeURIComponent(f.nodeId)}">
        <span class="file-icon">${ICON.folder}</span>
        <span class="file-text"><span class="file-name">${esc(f.name)}</span><span class="file-meta">${plural(n, 'elemento', 'elementos')}</span></span>
      </a></li>`;
    }).join('')}</ul>` : ''}
    ${videos.length ? `<ol class="episodes">${videos.map((ep) => episodeRow(ep)).join('')}</ol>` : ''}
    ${others.length ? `<ul class="files is-dim">${others.map((f) => `<li class="file-row">
        <span class="file-icon">${ICON.file}</span>
        <span class="file-text"><span class="file-name">${esc(f.name)}</span><span class="file-meta">${isSubtitleName(f.name) ? 'Subtítulos, ' : ''}${fmtSize(f.size || 0)}</span></span>
      </li>`).join('')}</ul>` : ''}
  </main>`;
}

/* ── descargados ── */

async function renderDownloads() {
  if (!app.querySelector('main.downloads')) app.innerHTML = header('Descargados') + '<main class="downloads"></main>';
  const metas = [...(await refreshSaved()).values()].filter((m) => m.ep || index.byId.get(m.id));
  if (route().view !== 'descargas') return;
  for (const m of metas) if (!m.ep) m.ep = index.byId.get(m.id).ep;
  metas.forEach((m) => { if (!index.byId.has(m.id)) knownEps.set(m.id, m.ep); });
  const groups = new Map();
  for (const m of metas) {
    const t = m.title || titleFor(m.ep) || 'Otros';
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(m.ep);
  }
  const total = metas.filter((m) => m.done).reduce((a, m) => a + (m.size || 0), 0);
  const folderN = metas.filter((m) => m.done && m.where === 'folder').length;
  const dir = await getDir();
  const perm = dir ? await dirPermission(dir) : '';
  let free = '';
  try {
    const est = await navigator.storage.estimate();
    if (est.quota) free = `, quedan ${fmtSize(Math.max(0, est.quota - est.usage))} disponibles`;
  } catch { /* nada */ }
  if (route().view !== 'descargas') return;
  app.innerHTML = header('Descargados') + `<main class="downloads">
    ${metas.length ? `<p class="dim downloads-sum">${plural(state.saved.size, 'capítulo', 'capítulos')} en este dispositivo, ${fmtSize(total)}${folderN ? ` (${folderN === state.saved.size ? 'todos' : folderN} en tu carpeta${dir ? ` «${esc(dir.name)}»` : ''})` : ''}${free}.</p>` : ''}
    ${dir && perm === 'prompt' ? '<p class="downloads-sum"><button class="btn btn-lamp" data-act="dir-grant">Permitir acceso a tu carpeta de descargas</button></p>' : ''}
    ${!metas.length ? `<section class="empty"><p>No hay capítulos descargados.</p>
      <p class="dim">Toca la flecha junto a un capítulo para verlo sin conexión.</p></section>` : ''}
    ${[...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([t, eps]) => `<section class="block">
      <h3 class="group-title">${esc(t)}</h3>
      <ol class="episodes">${sortEpisodes(eps).map((ep) => episodeRow(ep)).join('')}</ol>
    </section>`).join('')}
    ${metas.length ? '<button class="btn btn-quiet" data-act="clear-dl">Quitar todas las descargas</button>' : ''}
  </main>`;
  paintSync();
  hydrateThumbs(app);
}

/* ── ajustes ── */

function renderSettings() {
  const s = state.settings;
  const unread = hasUnreadNews();
  LS.set(pkey('newsUnread'), false);
  paintNewsDot();
  app.innerHTML = header('Ajustes') + `<main class="settings">
    <section class="settings-group is-first ${unread ? 'has-news' : ''}" id="news">${newsHTML()}</section>
    <section class="settings-group">
      <p class="settings-label">Apariencia</p>
      <div class="segmented" role="group" aria-label="Tema">${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => `<button class="seg ${s.theme === v ? 'is-on' : ''}" data-act="set-theme" data-v="${v}" aria-pressed="${s.theme === v}">${l}</button>`).join('')}</div>
      <p class="settings-label">Tono del modo claro</p>
      <div class="segmented" role="group" aria-label="Tono del modo claro">${Object.entries(TONES).map(([v, o]) => `<button class="seg ${(s.tone || 'blanco') === v ? 'is-on' : ''}" data-act="set-tone" data-v="${v}" aria-pressed="${(s.tone || 'blanco') === v}">${o.label}</button>`).join('')}</div>
      <p class="settings-label">Tono del modo oscuro</p>
      <div class="segmented" role="group" aria-label="Tono del modo oscuro">${Object.entries(DARK_TONES).map(([v, o]) => `<button class="seg ${(s.darkTone || 'negro') === v ? 'is-on' : ''}" data-act="set-dark-tone" data-v="${v}" aria-pressed="${(s.darkTone || 'negro') === v}">${o.label}</button>`).join('')}</div>
      <p class="dim settings-hint">El tono claro se usa con el tema Claro y el oscuro con el tema Oscuro; en Automático, cada uno según la hora del sistema.</p>
    </section>
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
      <button class="btn" data-act="check-update" id="check-update">${ICON.refresh}<span>${updateReady ? 'Actualizar ahora' : 'Buscar actualización'}</span></button>
    </section>
    <section class="settings-group">
      <p class="dim">Sesión de MEGA: ${esc((LS.get('session', {}).options || {}).email || '')}</p>
      <p class="dim">Datos de Kai en este navegador: ${(() => {
        const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
        const sizes = [];
        try { for (const k of Object.keys(localStorage)) if (k.startsWith('kai.')) sizes.push([k.slice(4), (localStorage.getItem(k) || '').length]); } catch { /* nada */ }
        const lib = LS.get('library', null);
        const libInfo = lib && lib.series ? ` · biblioteca guardada: ${lib.series.length} carpetas` : ' · sin biblioteca guardada';
        return kb(sizes.reduce((a, b) => a + b[1], 0)) + ' (' + sizes.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${esc(k)} ${kb(n)}`).join(', ') + ')' + libInfo;
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
  swVersion().then((v) => { const el = $('#app-version'); if (el) el.textContent = v ? v.replace('kai-v', 'Kai ') : 'Sin instalar'; });
}

/** Ajustes → Cine: la clave de TMDB, guardada en tu MEGA (no en el código) para que todos tus dispositivos la usen. */
function cineKeyHTML(note = '') {
  const key = tmdbKey();
  const lib = state.library;
  const cine = lib && lib.series && lib.series.find(isCine);
  return `<p class="settings-label">Cine</p>
    <p class="dim">Películas que no son anime, en la carpeta <strong>${esc(state.settings.root)}/Cine</strong>, una subcarpeta por película (por ejemplo «El gigante de hierro (1999)»). No salen en el inicio: se abren con el botón Cine al final. Sus pósters y sinopsis vienen de TMDB.</p>
    ${key ? `<p class="settings-value">Clave de TMDB guardada (…${esc(key.slice(-4))})${cine ? '' : ' · todavía no hay carpeta Cine'}</p>
      <div class="btn-row"><button class="btn btn-quiet" data-act="tmdb-del">Quitar la clave</button></div>`
    : `<form class="form tmdb-form" id="tmdb-form" autocomplete="off">
        <label>Clave de la API de TMDB<input id="tmdb-key" name="k" type="password" spellcheck="false" autocapitalize="off" placeholder="Pega aquí tu clave"></label>
        <button class="btn" type="submit">Guardar</button>
      </form>`}
    ${note ? `<p class="dim" role="status">${esc(note)}</p>` : ''}`;
}
function paintCineKey(note) { const el = $('#cine-key'); if (el) { el.innerHTML = cineKeyHTML(note); bindCineKey(); } }
function bindCineKey() {
  const f = $('#tmdb-form');
  if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = f.k.value.trim();
    if (!v) return;
    f.querySelector('button').textContent = 'Revisando…';
    let ok;
    try { ok = await tmdbCheckKey(v); } catch { paintCineKey('Sin conexión con TMDB. Intenta de nuevo.'); return; }
    if (!ok) { paintCineKey('TMDB dice que esa clave no es válida. Copia la «Clave de la API» de themoviedb.org → Ajustes → API.'); return; }
    setTmdbKey(v);
    paintCineKey('Lista. Kai ya está buscando las fichas de tus películas de Cine.');
  });
}
function setTmdbKey(v) {
  state.shared.keys = { ...(state.shared.keys || {}), tmdb: { v, u: Date.now() } };
  saveShared();
  sync();
  setTimeout(ensureMeta, 500);
}

function downloadsWhereHTML(perm = '') {
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
async function paintDownloadsWhere() {
  const d = await getDir();
  const perm = d ? await dirPermission(d) : '';
  const el = $('#dl-where');
  if (el) el.innerHTML = downloadsWhereHTML(perm);
}

async function paintSpace() {
  const el = $('#space');
  if (!el) return;
  const metas = await refreshSaved();
  const sum = (list) => list.reduce((a, m) => a + (m.size || 0), 0);
  const inApp = metas.filter((m) => m.done && m.where !== 'folder');
  const inFolder = metas.filter((m) => m.done && m.where === 'folder');
  const parts = [];
  if (inApp.length) parts.push(`${plural(inApp.length, 'capítulo', 'capítulos')} dentro de la app (${fmtSize(sum(inApp))})`);
  if (inFolder.length) parts.push(`${plural(inFolder.length, 'capítulo', 'capítulos')} en tu carpeta (${fmtSize(sum(inFolder))})`);
  let extra = '';
  try {
    const est = await navigator.storage.estimate();
    if (est.quota) extra = ` Espacio disponible para la app: ${fmtSize(Math.max(0, est.quota - est.usage))}.`;
  } catch { /* nada */ }
  try {
    let kept = await navigator.storage.persisted();
    if (!kept) kept = await navigator.storage.persist();
    extra += kept ? ' El sistema guarda las descargas de forma permanente.'
      : ' El sistema podría borrar las descargas si se queda sin espacio.';
  } catch { /* no soportado */ }
  if ($('#space')) $('#space').textContent = `${parts.length ? parts.join(' y ') + '.' : 'Ningún capítulo descargado.'}${extra}`;
}

/* ── hoja de opciones de un capítulo ── */

function openSheet(ep) {
  const sheet = $('#sheet');
  const p = prog(ep);
  const saved = state.saved.has(ep.id);
  const busy = !!state.dls[ep.id] || state.queue.some((q) => q.ep.id === ep.id);
  const ctx = resolveContext(ep.id);
  const upcoming = ctx ? nextUnseen(ep, ctx.list, 3).filter((x) => !state.saved.has(x.id)) : [];
  const ie = index.byId.get(ep.id);
  const series = ie ? state.library.series[ie.si] : null;
  const movie = series ? itemFor(series, ep) : null; // solo las películas de la colección
  sheet.innerHTML = `<div class="sheet-back" data-act="close"></div>
    <div class="sheet-panel" role="dialog" aria-modal="true" aria-label="${esc(episodeLabel(ep))}">
      <p class="sheet-title">${esc(episodeLabel(ep))}</p>
      <p class="sheet-sub">${esc(ep.name)}, ${fmtSize(ep.size)}</p>
      <button class="sheet-btn" data-act="toggle-seen">${p && p.w ? 'Marcar como no visto' : 'Marcar como visto'}</button>
      ${p && p.t > 5 && !p.w ? '<button class="sheet-btn" data-act="restart">Ver desde el principio</button>' : ''}
      ${saved || busy ? `<button class="sheet-btn" data-act="unsave">${busy ? 'Cancelar descarga' : 'Quitar del dispositivo'}</button>` : '<button class="sheet-btn" data-act="save">Descargar para ver sin conexión</button>'}
      ${upcoming.length ? `<button class="sheet-btn" data-act="save-next">Descargar ${upcoming.length === 1 ? 'el siguiente' : `los ${upcoming.length} siguientes`}</button>` : ''}
      ${saved && (state.dlMeta.get(ep.id) || {}).where !== 'folder' ? '<button class="sheet-btn" data-act="export">Guardar copia en el dispositivo</button>' : ''}
      ${movie ? `<button class="sheet-btn" data-act="later-movie">${isLater(series, movie.key) ? 'Quitar de Más tarde' : 'Ver más tarde'}</button>` : ''}
      <button class="sheet-btn is-quiet" data-act="close">Cerrar</button>
    </div>`;
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  sheet.querySelector('.sheet-btn').focus();
  sheet.onclick = async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    closeSheet();
    if (act === 'toggle-seen') {
      const now = prog(ep);
      setProgress(ep, now && now.w ? 0 : (now && now.d) || 0, (now && now.d) || 0, !(now && now.w));
      softRender(); sync();
    } else if (act === 'restart') {
      setProgress(ep, 0, (p && p.d) || 0, false);
      go('#/play/' + encodeURIComponent(ep.id));
    } else if (act === 'save') queueDownload(ep);
    else if (act === 'save-next') { upcoming.forEach((x) => queueDownload(x, ctx.title)); toast(`${plural(upcoming.length, 'capítulo', 'capítulos')} en cola de descarga.`); }
    else if (act === 'unsave') removeDownload(ep.id);
    else if (act === 'export') exportCopy(ep);
    else if (act === 'later-movie') setLater(series, movie.key, !isLater(series, movie.key));
  };
}
/* ── Descubrir: "Porque viste…" y "En emisión" ──
 * Con AniList: recomendaciones de las series que tienes en MEGA (las que ya viste pesan más) y lo que está
 * saliendo ahora con buena nota. Lo que ya tienes sale a color y lleva a su página; lo que no, en blanco y negro. */
const ANIMEAV1_SEARCH = (t) => 'https://animeav1.com/catalogo?search=' + encodeURIComponent(t);
// sube cuando cambia qué se muestra en Descubrir, para no enseñar una lista guardada con lo de antes
const DISCOVER_V = 2;
const discoverFresh = (d) => !!(d && d.v === DISCOVER_V && d.items && d.items.length);
const DISCOVER = {
  porque: { title: 'Porque viste…', ttl: 24 * 3600000 },
  emision: { title: 'En emisión', ttl: 6 * 3600000 },
};
/** Lo que tienes en MEGA, por id de AniList → a dónde lleva en Kai. */
function ownedIds() {
  const out = new Map();
  const lib = state.library;
  if (!lib || lib.v !== 2) return out;
  lib.series.forEach((s, si) => {
    if (isCine(s)) return;
    if (isCollection(s)) { for (const it of collectionItems(s)) { const m = itemMeta(s, it.key); if (m && m.id) out.set(m.id, movieHref(si, it.key)); } }
    else {
      const m = metaFor(s); if (m && m.id) out.set(m.id, '#/serie/' + si);
      for (const se of s.seasons) { const sm = seasonMeta(s, se); if (sm && sm.id) out.set(sm.id, '#/serie/' + si); }
    }
  });
  return out;
}
let discoverJob = null;
async function loadDiscover(kind, force = false) {
  const all = LS.get('discover', {}) || {};
  const cur = all[kind];
  if (!force && discoverFresh(cur) && Date.now() - cur.at < DISCOVER[kind].ttl) return cur;
  if (discoverJob) return discoverJob;
  discoverJob = (async () => {
    let items = [];
    if (kind === 'emision') {
      items = (await airingTop()).map(toDiscover);
    } else {
      // tus series de MEGA (sin repetir la misma ficha); las que ya empezaste a ver cuentan doble
      const lib = state.library;
      const src = new Map();
      if (lib && lib.v === 2) for (const s of lib.series) {
        if (isCollection(s)) continue;
        const m = metaFor(s);
        if (!m || !m.id) continue;
        const watched = s.all.some((e) => { const p = prog(e); return p && (p.w || p.t > 60); });
        src.set(m.id, { name: s.name, w: watched ? 2 : 1 });
      }
      const recs = await recommendationsFor([...src.keys()].slice(0, 40));
      const score = new Map();
      for (const [id, list] of Object.entries(recs)) {
        const from = src.get(Number(id));
        list.forEach(({ rating, media }, rank) => {
          if (src.has(media.id)) return; // no recomendar una serie que es la misma fuente
          const r = score.get(media.id) || { m: media, pts: 0, from: [] };
          r.pts += from.w * (1 + Math.log10(1 + Math.max(0, rating))) * (1 - rank * 0.05);
          r.from.push({ name: from.name, pts: from.w * (1 + Math.log10(1 + Math.max(0, rating))) });
          score.set(media.id, r);
        });
      }
      items = [...score.values()].sort((a, b) => b.pts - a.pts).slice(0, 30).map((r) => ({
        ...toDiscover(r.m), because: r.from.sort((a, b) => b.pts - a.pts).slice(0, 2).map((x) => x.name),
      }));
    }
    const out = { v: DISCOVER_V, at: Date.now(), items };
    const store = LS.get('discover', {}) || {};
    store[kind] = out;
    LS.set('discover', store);
    setTimeout(translateMissing, 1000);
    return out;
  })().finally(() => { discoverJob = null; });
  return discoverJob;
}
function airingIn(at) {
  const h = Math.round((at - Date.now()) / 3600000);
  if (h <= 0) return 'sale hoy';
  if (h < 24) return `en ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'mañana' : `en ${d} días`;
}
function discoverPosterHTML(x, owned, kind) {
  const href = owned.get(x.id);
  const sub = kind === 'emision'
    ? [x.next ? `Ep. ${x.next.ep} ${airingIn(x.next.at)}` : '', x.score ? `★ ${x.score}` : ''].filter(Boolean).join(' · ')
    : (x.because && x.because.length ? `Porque viste ${x.because.join(' y ')}` : (x.score ? `★ ${x.score}` : ''));
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
async function renderDiscover(kind) {
  if (!DISCOVER[kind]) kind = 'porque';
  const other = kind === 'porque' ? 'emision' : 'porque';
  app.innerHTML = header(DISCOVER[kind].title) + `<main class="shelf-main discover" data-kind="${kind}">
    <p class="dim shelf-count" id="disc-note">${kind === 'porque' ? 'Recomendaciones de AniList según lo que tienes en MEGA.' : 'Lo que está saliendo ahora y tiene buena nota en AniList.'}</p>
    <div id="disc-list"><p class="dim">Buscando en AniList…</p></div>
    <p class="discover-foot"><a class="tv-more" href="#/descubrir/${other}">${ICON.grid}<span>${DISCOVER[other].title}</span></a></p>
  </main>`;
  const paint = (d) => {
    const box = $('#disc-list');
    if (!box || route().view !== 'descubrir') return;
    const owned = ownedIds();
    if (!d.items.length) { box.innerHTML = `<p class="dim">${kind === 'porque' ? 'Todavía no hay recomendaciones: agrega series a MEGA y espera a que Kai encuentre sus fichas.' : 'AniList no devolvió nada ahora.'}</p>`; return; }
    box.innerHTML = `<ul class="shelf" role="list">${d.items.map((x) => discoverPosterHTML(x, owned, kind)).join('')}</ul>`;
  };
  const cached = (LS.get('discover', {}) || {})[kind];
  if (discoverFresh(cached)) paint(cached);
  try { paint(await loadDiscover(kind)); } catch (err) {
    const box = $('#disc-list');
    if (box && !discoverFresh(cached)) box.innerHTML = `<p class="dim">No se pudo consultar AniList (${esc(err.message || 'sin conexión')}). Intenta en un momento.</p>`;
  }
}
function openDiscoverSheet(id) {
  const all = LS.get('discover', {}) || {};
  const x = Object.values(all).flatMap((d) => (d && d.items) || []).find((y) => y.id === id);
  if (!x) return;
  const syn = (state.syn[x.id] && state.syn[x.id].es) || x.synopsis || '';
  const short = syn.length > 420 ? syn.slice(0, 400).replace(/\s+\S*$/, '') + '…' : syn;
  const facts = [x.year, x.format, x.episodes ? plural(x.episodes, 'capítulo', 'capítulos') : '', x.score ? `★ ${x.score}` : ''].filter(Boolean).join(' · ');
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-back" data-act="close"></div>
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
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  sheet.onclick = (e) => { if (e.target.closest('[data-act="close"]') || e.target.closest('a.sheet-btn')) closeSheet(); };
}

function closeSheet() {
  const sheet = $('#sheet');
  if (sheet.hidden) return;
  sheet.classList.remove('is-open');
  setTimeout(() => { sheet.hidden = true; sheet.innerHTML = ''; }, 180);
}

/* ───────────────────────── página de reproducción ───────────────────────── */

const stage = $('#stage');
const parking = $('#stage-parking');
const video = $('#video');
let playing = null;

function watchDlButton(ep) {
  const t = state.dls[ep.id];
  const queued = state.queue.some((q) => q.ep.id === ep.id);
  const label = t ? `Descargando ${Math.round((t.loaded / t.total) * 100)}%` : queued ? 'En cola' : state.saved.has(ep.id) ? 'Descargado' : 'Descargar';
  const icon = t || queued ? ICON.queued : state.saved.has(ep.id) ? ICON.saved : ICON.down;
  return `<button class="btn ${state.saved.has(ep.id) ? 'is-saved' : ''}" data-act="w-dl" data-id="${esc(ep.id)}">${icon}<span>${label}</span></button>`;
}

function renderWatch(id) {
  const ctx = resolveContext(id);
  // ver un capítulo cuenta como haber visto lo nuevo de esa serie (si no, la burbuja seguía en el inicio)
  const ws = ctx && ctx.si != null && state.library && state.library.series[ctx.si];
  if (ws && newEpisodes(ws).length) markSeriesSeen(ws);
  if (!ctx) {
    if (LS.get('session', null) && (state.connecting || !state.library)) {
      app.innerHTML = header('') + '<main><section class="empty"><p class="dim">Cargando…</p></section></main>';
    } else go('#/');
    return;
  }
  const same = playing && playing.ep.id === id && stage.isConnected && app.contains(stage);
  if (!same) {
    leaveMini();
    parkStage();
    app.innerHTML = header('') + `<main class="watch">
      <div class="watch-grid">
        <div class="watch-main">
          <div class="stage-slot" id="stage-slot"></div>
          <div class="watch-info" id="watch-info"></div>
        </div>
        <aside class="watch-list" id="watch-list"></aside>
      </div>
    </main>`;
    $('#stage-slot').appendChild(stage);
    stage.hidden = false;
    if (!playing || playing.ep.id !== id) startPlayback(ctx);
    else playing.ctx = ctx;
  }
  paintWatchInfo();
}

function paintWatchInfo() {
  if (!playing || route().view !== 'play') return;
  const ctx = resolveContext(playing.ep.id) || playing.ctx;
  playing.ctx = ctx;
  const ep = playing.ep;
  const i = ctx.list.findIndex((x) => x.id === ep.id);
  const prev = ctx.list[i - 1];
  const next = ctx.list[i + 1];
  const upcoming = nextUnseen(ep, ctx.list, 3).filter((x) => !state.saved.has(x.id) && !state.dls[x.id]);
  const info = $('#watch-info');
  if (!info) return;
  info.innerHTML = `<div class="watch-text">
      <a class="watch-series" href="${ctx.back}">${esc(ctx.title)}</a>
      <h2 class="watch-title">${esc(episodeLabel(ep))}</h2>
      ${ctx.sub ? `<p class="watch-sub">${esc(ctx.sub)}</p>` : ''}
    </div>
    <div class="watch-actions">
      ${prev ? `<a class="btn" href="#/play/${encodeURIComponent(prev.id)}" data-replace>${ICON.prev}<span>Anterior</span></a>` : ''}
      ${next ? `<a class="btn" href="#/play/${encodeURIComponent(next.id)}" data-replace><span>Siguiente</span>${ICON.next}</a>` : ''}
      ${watchDlButton(ep)}
      ${upcoming.length ? `<button class="btn" data-act="w-dl-next">${ICON.down}<span>Descargar ${upcoming.length === 1 ? 'el siguiente' : `los ${upcoming.length} siguientes`}</span></button>` : ''}
      <button class="icon-btn" data-act="w-more" aria-label="Más opciones">${ICON.more}</button>
    </div>`;
  const list = $('#watch-list');
  const nextUp = ctx.list[i + 1];
  const done = ctx.shown.filter((x) => (prog(x) || {}).w).length;
  list.innerHTML = `<div class="wl-head"><h3 class="wl-title">${esc(ctx.sub || ctx.title)}</h3><span class="wl-count">${done} de ${ctx.shown.length} vistos</span></div>
    <ol class="episodes is-compact">${ctx.shown.map((x) => episodeRow(x, { current: x.id === ep.id, next: nextUp && x.id === nextUp.id })).join('')}</ol>`;
  hydrateThumbs(list);
  const cur = list.querySelector('.is-current');
  if (cur && list.scrollHeight > list.clientHeight) cur.scrollIntoView({ block: 'nearest' });
}

function parkStage() {
  if (stage.parentElement !== parking) parking.appendChild(stage);
}

/** El archivo descargado que se está reproduciendo, si lo hay (para leerlo por rangos sin ir a MEGA). */
const sourceBlob = (token) => (token && token.source && token.source.blob) || null;

/* ───────────────────────── motor del reproductor ───────────────────────── */

const ui = {
  big: $('#st-big'), play: $('#st-play'), chapter: $('#st-chapter'), lights: $('#st-lights'), seek: $('#st-seek'), time: $('#st-time'),
  speed: $('#st-speed'), pip: $('#st-pip'), fs: $('#st-fs'), mute: $('#st-mute'), next: $('#st-next'),
  skip: $('#st-skip'), menu: $('#st-menu'), flash: $('#st-flash'), nextCard: $('#p-next'), msg: $('#p-msg'), tap: $('#st-tap'),
};
let speed = 1;
let idleTimer;
let nextTimer;
let seeking = false;

async function startPlayback(ctx) {
  if (playing) finishCurrent();
  clearTimeout(nextTimer);
  const ep = ctx.ep;
  const token = { ep, ctx, objectUrl: null, lastSaved: 0, lastSync: Date.now(), recover: [], source: null, chapters: [], autoSkipped: false, learned: false, undo: null, offer: null };
  playing = token;
  ui.msg.hidden = true;
  ui.nextCard.hidden = true;
  closeMenu();
  resetChapters();
  $('#st-marks').innerHTML = '';
  stage.classList.add('is-loading');
  stage.classList.remove('is-ended');
  video.removeAttribute('src');
  video.load();
  paintControls();

  let src = null;
  let localErr = null;
  const blob = await localBlob(ep, true).catch((err) => { localErr = err; return null; });
  if (playing !== token) return;
  if (blob) {
    src = token.objectUrl = URL.createObjectURL(blob);
    token.source = { blob };
  } else if (navigator.onLine) {
    try {
      src = await streamUrl(ep);
      token.source = { stream: true };
    } catch (err) {
      if (playing !== token) return;
      return playerMessage(err.message === 'NOSW'
        ? 'La app se está preparando. Recarga la página y vuelve a intentarlo.'
        : megaMessage(err));
    }
  } else if (localErr && localErr.message === 'NOFOLDER') {
    return playerMessage('Kai necesita permiso para abrir tu carpeta de descargas.', false, true);
  } else if (localErr && localErr.message === 'NOFILE') {
    return playerMessage('El archivo ya no está en tu carpeta de descargas.');
  } else {
    return playerMessage('Este capítulo no está descargado y no hay conexión.');
  }
  if (playing !== token) return;

  const p = prog(ep);
  const startAt = p && !p.w && p.t > 5 ? Math.max(0, p.t - 3) : 0;
  // #t= hace que el navegador empiece directo en ese punto, sin un salto aparte
  video.src = startAt ? `${src}#t=${startAt.toFixed(1)}` : src;
  video.addEventListener('loadedmetadata', () => {
    if (playing !== token) return;
    if (startAt && video.duration && startAt < video.duration - 2 && Math.abs(video.currentTime - startAt) > 2) video.currentTime = startAt;
    video.playbackRate = speed;
  }, { once: true });
  setMediaSession(ep, ctx);
  video.play().catch(() => { stage.classList.remove('is-loading'); paintControls(); });
  initChapters(ep, token);
}

async function streamUrl(ep) {
  if (!('serviceWorker' in navigator)) throw new Error('NOSW');
  if (!navigator.serviceWorker.controller) {
    await Promise.race([navigator.serviceWorker.ready, sleep(3000)]);
    await sleep(50);
    if (!navigator.serviceWorker.controller) throw new Error('NOSW');
  }
  const url = await downloadUrl(ep.id);
  const q = new URLSearchParams({ u: url, k: ep.key, s: String(ep.size), t: ep.mime, i: ep.id });
  return '__stream?' + q.toString();
}

function playerMessage(text, offerDownload = false, offerFolder = false, detail = '') {
  stage.classList.remove('is-loading');
  ui.msg.innerHTML = `<p>${esc(text)}</p>${detail ? `<p class="p-detail">${esc(detail)}</p>` : ''}<div class="btn-row">
    ${offerDownload ? '<button class="btn btn-lamp" data-act="p-dl">Descargar y ver</button>' : ''}
    ${offerFolder ? '<button class="btn btn-lamp" data-act="p-folder">Permitir acceso</button>' : ''}
    <a class="btn" href="${playing ? playing.ctx.back : '#/'}">Volver</a></div>`;
  ui.msg.hidden = false;
}

async function downloadThenPlay() {
  if (!playing) return;
  const { ep, ctx } = playing;
  ui.msg.innerHTML = '<p id="p-dl-status">Descargando…</p>';
  const tick = setInterval(() => {
    const t = state.dls[ep.id];
    const st = $('#p-dl-status');
    if (t && st) st.textContent = `Descargando… ${Math.round((t.loaded / t.total) * 100)}%`;
  }, 400);
  await downloadAndWait(ep, ctx.title);
  clearInterval(tick);
  if (!playing || playing.ep !== ep) return;
  if (state.saved.has(ep.id)) { playing = null; startPlayback(ctx); }
  else playerMessage('No se pudo descargar el capítulo.');
}

function setMediaSession(ep, ctx) {
  if (!('mediaSession' in navigator)) return;
  try {
    const meta = (art) => new MediaMetadata({ title: episodeLabel(ep), artist: ctx.title, album: 'Kai', artwork: art || [] });
    navigator.mediaSession.metadata = meta();
    thumbFor(ep).then((u) => {
      if (u && playing && playing.ep === ep) navigator.mediaSession.metadata = meta([{ src: u, sizes: '320x180', type: 'image/jpeg' }]);
    });
    const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch { /* nada */ } };
    set('nexttrack', () => playNext());
    set('previoustrack', () => playPrev());
    set('seekbackward', () => seekBy(-10));
    set('seekforward', () => seekBy(10));
  } catch { /* nada */ }
}

function neighbor(delta) {
  if (!playing) return null;
  const list = playing.ctx.list;
  const i = list.findIndex((x) => x.id === playing.ep.id);
  return i >= 0 ? list[i + delta] || null : null;
}
function switchTo(ep) {
  if (!ep) return;
  const ctx = resolveContext(ep.id);
  if (!ctx) return;
  if (route().view === 'play') {
    history.replaceState(null, '', '#/play/' + encodeURIComponent(ep.id));
    lastRouteKey = 'play/' + ep.id;
    startPlayback(ctx);
    paintWatchInfo();
  } else {
    startPlayback(ctx); // sigue en el mini reproductor
    paintMini();
  }
}
function playNext() { const n = neighbor(1); if (n) switchTo(n); }
function playPrev() { const n = neighbor(-1); if (n) switchTo(n); }

function savePosition(force = false) {
  if (!playing || !video.duration || !isFinite(video.duration) || !video.currentSrc) return;
  const now = Date.now();
  if (!force && now - playing.lastSaved < 4000) return;
  playing.lastSaved = now;
  setProgress(playing.ep, video.currentTime, video.duration);
  markNow(playing.ep, video.currentTime, video.duration);
  if (force || now - playing.lastSync > 60000) {
    playing.lastSync = now;
    sync();
  }
}

function finishCurrent() {
  if (!playing) return;
  savePosition(true);
  if (playing.objectUrl) {
    const u = playing.objectUrl;
    setTimeout(() => URL.revokeObjectURL(u), 1500);
  }
}

function stopPlayback() {
  clearTimeout(nextTimer);
  if (document.body.classList.contains('lights-off')) setLights(false);
  if (playing) {
    video.pause();
    finishCurrent();
    playing = null;
  }
  resetChapters();
  closeMenu();
  if (isFullscreen()) exitFullscreen();
  if (video.getAttribute('src')) { video.removeAttribute('src'); video.load(); }
  stage.hidden = true;
  leaveMini();
  parkStage();
}

/* ── mini reproductor ── */

const mini = $('#mini');
function enterMini() {
  if (!playing) return;
  if (stage.classList.contains('kai-fs')) setKaiFullscreen(false);
  else if (isFullscreen()) exitFullscreen();
  if (document.body.classList.contains('lights-off')) setLights(false);
  closeMenu();
  const slot = $('#mini-slot');
  if (stage.parentElement !== slot) slot.prepend(stage);
  stage.classList.add('is-mini');
  stage.hidden = false;
  mini.hidden = false;
  document.documentElement.classList.add('has-mini');
  paintMini();
}
function leaveMini() {
  stage.classList.remove('is-mini');
  if (mini.hidden) return;
  mini.hidden = true;
  document.documentElement.classList.remove('has-mini');
}
function paintMini() {
  if (mini.hidden || !playing) return;
  $('#mini-title').textContent = episodeLabel(playing.ep);
  $('#mini-sub').textContent = playing.ctx.title || '';
  const t = $('#mini-toggle');
  t.innerHTML = video.paused ? ICON.play : ICON.pause;
  t.setAttribute('aria-label', video.paused ? 'Reproducir' : 'Pausar');
  const d = isFinite(video.duration) ? video.duration : 0;
  mini.style.setProperty('--mp', d ? (video.currentTime / d) * 100 + '%' : '0%');
}
['play', 'pause', 'timeupdate', 'loadedmetadata'].forEach((ev) => video.addEventListener(ev, paintMini));

// al volver de la ventana flotante del sistema con el botón "volver a la pestaña", regresa al reproductor grande
function backFromSystemPip() {
  setTimeout(() => {
    if (playing && !video.paused && route().view !== 'play') go('#/play/' + encodeURIComponent(playing.ep.id));
  }, 60);
}
video.addEventListener('leavepictureinpicture', backFromSystemPip);
video.addEventListener('webkitpresentationmodechanged', () => { if (video.webkitPresentationMode === 'inline') backFromSystemPip(); });

/* ── controles ── */

// se llama varias veces por segundo: solo toca el DOM cuando algo cambió
const painted = {};
function setOnce(key, value, apply) {
  if (painted[key] === value) return;
  painted[key] = value;
  apply(value);
}
function paintControls() {
  const paused = video.paused;
  setOnce('play', paused, (v) => {
    ui.play.innerHTML = v ? ICON.play : ICON.pause;
    ui.play.setAttribute('aria-label', v ? 'Reproducir' : 'Pausar');
    stage.classList.toggle('is-paused', v);
  });
  const d = isFinite(video.duration) ? video.duration : 0;
  const t = seeking ? Number(ui.seek.value) : video.currentTime;
  ui.seek.max = String(d || 0);
  if (!seeking) ui.seek.value = String(t || 0);
  let buf = 0;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= t + 0.5) buf = Math.max(buf, video.buffered.end(i));
  }
  stage.style.setProperty('--played', d ? (t / d) * 100 + '%' : '0%');
  stage.style.setProperty('--buffered', d ? (buf / d) * 100 + '%' : '0%');
  setOnce('time', `${fmtTime(t)} / ${fmtTime(d)}`, (v) => { ui.time.textContent = v; });
  setOnce('next', !neighbor(1), (v) => { ui.next.hidden = v; });
  paintSkip(t, d);
  const ch = chapterAt(seeking ? t : video.currentTime);
  setOnce('chapter', ch && ch.title ? ch.title : '', (v) => { ui.chapter.textContent = v; });
  setOnce('mute', video.muted || video.volume === 0, (v) => {
    ui.mute.innerHTML = v
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  });
  setOnce('speed', speed === 1 ? '1×' : `${speed}×`, (v) => { ui.speed.textContent = v; });
  setOnce('fs', isFullscreen(), (v) => {
    ui.fs.setAttribute('aria-label', v ? 'Salir de pantalla completa' : 'Pantalla completa');
    stage.classList.toggle('is-fs', v);
  });
}

function wake() {
  stage.classList.remove('is-idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!video.paused && ui.menu.hidden && !seeking) stage.classList.add('is-idle');
  }, 2800);
}

function togglePlay() {
  if (!video.currentSrc) return;
  if (video.paused) video.play().catch(() => {}); else video.pause();
}

function seekBy(s) {
  if (!video.duration) return;
  video.currentTime = Math.max(0, Math.min(video.duration - 0.5, video.currentTime + s));
  ui.flash.textContent = s > 0 ? `+${s} s` : `−${-s} s`;
  ui.flash.dataset.side = s > 0 ? 'right' : 'left';
  ui.flash.classList.remove('is-on');
  void ui.flash.offsetWidth;
  ui.flash.classList.add('is-on');
  wake();
}

const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement || stage.classList.contains('kai-fs'));
/* iPhone no deja poner en pantalla completa un elemento de la página, solo el reproductor
 * nativo de iOS, que tapa los controles y gestos de Kai. Ahí se usa una pantalla completa
 * propia: el reproductor ocupa toda la pantalla (sin barras si Kai está en la pantalla de inicio). */
function setKaiFullscreen(on) {
  stage.classList.toggle('kai-fs', on);
  // en el teléfono (sin girar la pantalla) el video horizontal se muestra girado; ver styles.css
  const wide = !video.videoWidth || video.videoWidth >= video.videoHeight;
  stage.classList.toggle('kai-rot', on && wide && matchMedia('(pointer: coarse)').matches);
  document.documentElement.classList.toggle('kai-fs-on', on);
  paintThemeColor();
  paintControls();
  wake();
}
function exitFullscreen() {
  if (stage.classList.contains('kai-fs')) { setKaiFullscreen(false); return; }
  const fn = document.exitFullscreen || document.webkitExitFullscreen;
  if (fn) fn.call(document).catch?.(() => {});
}
function toggleFullscreen() {
  if (isFullscreen()) { exitFullscreen(); return; }
  const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
  if (req) {
    Promise.resolve(req.call(stage)).then(() => {
      try { screen.orientation.lock('landscape').catch(() => {}); } catch { /* nada */ }
    }).catch(() => setKaiFullscreen(true));
  } else {
    setKaiFullscreen(true);
  }
}

async function togglePip() {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (video.requestPictureInPicture) await video.requestPictureInPicture();
    else if (video.webkitSetPresentationMode) video.webkitSetPresentationMode(video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
  } catch { toast('Este navegador no permite ventana flotante aquí.'); }
}

/* ── menú del reproductor: velocidad ── */

function openMenu(kind) {
  if (!ui.menu.hidden && ui.menu.dataset.kind === kind) { closeMenu(); return; }
  ui.menu.dataset.kind = kind;
  paintMenu();
  ui.menu.hidden = false;
  wake();
}
function closeMenu() { ui.menu.hidden = true; }

function paintMenu() {
  if (ui.menu.hidden && !ui.menu.dataset.kind) return;
  const kind = ui.menu.dataset.kind;
  if (kind === 'speed') {
    ui.menu.innerHTML = `<p class="menu-title">Velocidad</p>${[0.75, 1, 1.25, 1.5, 2].map((v) => `<button class="menu-item ${v === speed ? 'is-on' : ''}" data-act="m-speed" data-v="${v}">${v === 1 ? 'Normal' : v + '×'}</button>`).join('')}`;
  }
}

/* ── capítulos del MP4 ("Intro", "Parte A"…) ──
 * Los videos traen los subtítulos dentro de la imagen, así que Kai ya no busca pistas ni archivos de subtítulos:
 * solo lee los capítulos, y desde MEGA lo hace cuando el video ya empezó, para no quitarle velocidad al arranque. */
let chapCtrl = null;
function resetChapters() {
  if (chapCtrl) chapCtrl.abort();
  chapCtrl = null;
}

/** Espera a que el video esté sonando (o a que pase `ms`, por si no arranca solo). */
const whenPlaying = (ms) => new Promise((res) => {
  if (!video.paused && video.readyState >= 3) { res(); return; }
  let timer = 0;
  const done = () => { clearTimeout(timer); video.removeEventListener('playing', done); res(); };
  timer = setTimeout(done, ms);
  video.addEventListener('playing', done);
});

async function initChapters(ep, token) {
  // mientras no se sepa si el video trae capítulos, Kai no adivina dónde está la intro (ni salta sola con lo aprendido)
  token.chaptersDone = false;
  const giveUp = setTimeout(() => { token.chaptersDone = true; }, 12000);
  try { await loadChapters(ep, token); } catch (err) { if (playing === token) console.warn('capítulos', err); } finally { clearTimeout(giveUp); token.chaptersDone = true; }
}
async function loadChapters(ep, token) {
  const ctrl = new AbortController();
  chapCtrl = ctrl;
  const alive = () => playing === token && !ctrl.signal.aborted;
  const cached = await idb.get('subcache', ep.id).catch(() => null);
  if (!alive()) return;
  if (cached && cached.v === 3) { setChapters(token, cached.chapters || []); return; }
  if (!/mp4|quicktime/.test(ep.mime)) return;
  // desde MEGA, primero que arranque el video; si está descargado, se lee al instante
  if (!(token.source && token.source.blob)) await whenPlaying(4000);
  if (!alive()) return;
  const read = await rangeReader(ep, sourceBlob(token), ctrl.signal);
  const info = await mp4Info(read, ep.size);
  learnAudioLang(ep, info.audioLang);
  if (!alive()) return;
  const chapters = await mp4Chapters(info, read, video.duration);
  if (!alive()) return;
  setChapters(token, chapters);
  saveChapterCache(ep, chapters);
}

/* ── capítulos e intros ── */

const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };

function setChapters(token, chapters) {
  if (playing !== token) return;
  token.chapters = (chapters || []).map((c) => ({ ...c, end: c.end == null || !isFinite(c.end) ? (video.duration || Infinity) : c.end }));
  token.intro = pickIntro(token.chapters); // el opening de verdad (no el pedacito de anime que a veces va antes)
  token.chaptersDone = true;
  paintMarks();
  paintControls();
}

function chapterAt(t) {
  const list = playing && playing.chapters;
  return list ? list.find((c) => t >= c.start && t < c.end) : null;
}

function paintMarks() {
  const el = $('#st-marks');
  const d = video.duration;
  const list = (playing && playing.chapters) || [];
  el.innerHTML = d && isFinite(d) ? list.filter((c) => c.start > 0.5 && c.start < d).map((c) => `<span style="left:${(c.start / d) * 100}%"></span>`).join('') : '';
}

/* Sin capítulos, Kai aprende por serie dónde saltaste el opening. */
function introStats() { return state.shared.intros || {}; }
function learnIntro(from, to) {
  if (!playing || playing.learned) return;
  const len = to - from;
  if (from > 360 || len < 40 || len > 150) return;
  playing.learned = true;
  const all = introStats();
  const key = playing.ctx.title;
  const st = all[key] || { starts: [], lens: [] };
  st.starts = [...st.starts, Math.round(from)].slice(-5);
  st.lens = [...st.lens, Math.round(len)].slice(-5);
  st.u = Date.now();
  all[key] = st;
  state.shared.intros = all;
  saveShared();
  state.dirty = true;
}
function learnedIntro() {
  const st = playing && introStats()[playing.ctx.title];
  if (!st || !st.lens.length) return null;
  const len = median(st.lens);
  const recent = st.starts.slice(-3);
  const start = median(recent);
  const sure = recent.length >= 2 && recent.every((x) => Math.abs(x - start) <= 8);
  return { len, start, sure };
}

/** Qué ofrece el botón flotante en este momento: saltar intro, ir al siguiente o deshacer. */
function skipOffer(t, d) {
  if (!playing || !d) return null;
  if (playing.undo && Date.now() < playing.undo.until) return { label: 'Volver a la intro', act: 'undo' };
  const ch = chapterAt(t);
  if (ch && ch === playing.intro && t < ch.end - 2) return { label: 'Saltar intro', to: ch.end, sure: true };
  if (ch && OUTRO.test(ch.title) && neighbor(1)) return { label: 'Siguiente capítulo', act: 'next' };
  if (!playing.chaptersDone) return null;
  if (playing.intro) return null; // con el opening marcado en el MP4 no hace falta adivinar
  if (d < 400 || t > 360) return null;
  const li = learnedIntro();
  if (li && li.sure) {
    if (t >= li.start - 3 && t < li.start + li.len - 3) return { label: 'Saltar intro', to: li.start + li.len, sure: true, learned: true };
    return null;
  }
  if (t < 3) return null;
  if (li) return { label: 'Saltar intro', to: t + li.len, guess: true };
  return { label: 'Saltar 85 s', to: t + 85, guess: true };
}

function paintSkip(t, d) {
  const offer = skipOffer(t, d);
  playing && (playing.offer = offer);
  ui.skip.hidden = !offer;
  if (!offer) return;
  if (ui.skip.textContent !== offer.label) ui.skip.textContent = offer.label;
  ui.skip.classList.toggle('is-sticky', !!(offer.sure || offer.act));
  // saltar solo: únicamente cuando Kai sabe dónde está la intro
  if (offer.sure && state.settings.autoSkip && !playing.autoSkipped && !video.paused) {
    playing.autoSkipped = true;
    playing.undo = { at: t, until: Date.now() + 6000 };
    seekSure(Math.min(d - 1, offer.to));
    paintSkip(video.currentTime, d);
  }
}

/** Salta a un punto y comprueba que llegó: si el navegador se queda corto (aún no tenía esa parte), lo intenta otra vez. */
function seekSure(to) {
  const tok = playing;
  let tries = 0;
  const check = () => {
    if (playing !== tok) return;
    if (video.currentTime < to - 1.5 && tries < 3) { tries++; video.currentTime = to; video.addEventListener('seeked', check, { once: true }); }
  };
  video.currentTime = to;
  video.addEventListener('seeked', check, { once: true });
}

function doSkip() {
  if (!playing) return;
  const o = skipOffer(video.currentTime, video.duration);
  if (!o) return;
  if (o.act === 'undo') {
    video.currentTime = playing.undo.at;
    playing.undo = null;
    playing.autoSkipped = true;
  } else if (o.act === 'next') playNext();
  else {
    const from = video.currentTime;
    playing.autoSkipped = true;
    seekSure(Math.min(video.duration - 1, o.to));
    if (o.guess) learnIntro(from, o.to);
  }
  paintControls();
}

/* ── tema y luz ── */

const darkMQ = matchMedia('(prefers-color-scheme: dark)');
function resolvedTheme() {
  const t = state.settings.theme;
  return t === 'light' || t === 'dark' ? t : (darkMQ.matches ? 'dark' : 'light');
}
/* color de la barra del sistema; en pantalla completa negro, porque en Android ese color también pinta
 * el hueco de la cámara (en tema claro salía una franja blanca) */
function paintThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  meta.content = isFullscreen() ? '#000000' : resolvedTheme() === 'dark' ? (DARK_TONES[state.settings.darkTone] || DARK_TONES.negro).bg : (TONES[state.settings.tone] || TONES.blanco).bg;
}
function applyTheme() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  const tone = state.settings.tone;
  if (t === 'light' && tone && tone !== 'blanco' && TONES[tone]) document.documentElement.dataset.tone = tone;
  else delete document.documentElement.dataset.tone;
  if (t === 'dark' && state.settings.darkTone === 'gris') document.documentElement.dataset.dark = 'gris';
  else delete document.documentElement.dataset.dark;
  paintThemeColor();
  if (dock.classList.contains('is-open')) fillDock();
  document.querySelectorAll('[data-act="theme"]:not(.dock-chip)').forEach((b) => {
    b.innerHTML = t === 'dark' ? ICON.sun : ICON.moon;
    b.setAttribute('aria-label', `Cambiar a tema ${t === 'dark' ? 'claro' : 'oscuro'}`);
  });
}
darkMQ.addEventListener('change', applyTheme);

function setLights(off) {
  document.body.classList.toggle('lights-off', off);
  $('#lights').hidden = !off;
  ui.lights.classList.toggle('is-on', off);
  ui.lights.setAttribute('aria-label', off ? 'Encender la luz' : 'Apagar la luz');
}

/* ── cuota de MEGA ── */

let lastStreamError = '';
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'mega-bytes') countBytes(e.data.n);
    if (e.data && e.data.type === 'mega-quota') noteQuota(e.data.timeLeft || 3600);
    if (e.data && e.data.type === 'stream-error') lastStreamError = String(e.data.msg || '').slice(0, 80);
    // el service worker encontró el enlace de MEGA caducado: se pide otro y se le responde por su canal
    if (e.data && e.data.type === 'need-url' && e.ports && e.ports[0]) {
      const port = e.ports[0];
      downloadUrl(e.data.id, true).then((url) => port.postMessage({ url }), () => port.postMessage({ url: '' }));
    }
  });
}

/* ── eventos del video ── */

video.addEventListener('timeupdate', () => { if (!seeking) paintControls(); savePosition(); maybePrefetchNext(); });

/** En los últimos minutos baja en silencio el inicio del siguiente capítulo (unos 3 MB) para que empiece sin espera. */
function maybePrefetchNext() {
  if (!playing || playing.prefetched || state.settings.prefetchNext === false || !navigator.onLine) return;
  const d = video.duration;
  if (!isFinite(d) || d - video.currentTime > 150) return;
  playing.prefetched = true;
  const n = neighbor(1);
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!n || !sw || state.saved.has(n.id) || quotaUntil() > 0) return;
  downloadUrl(n.id).then((u) => sw.postMessage({ type: 'prefetch', u, k: n.key, s: n.size, i: n.id, blocks: 3 })).catch(() => {});
}
video.addEventListener('progress', paintControls);
video.addEventListener('durationchange', () => { paintControls(); paintMarks(); });
video.addEventListener('play', () => { paintControls(); wake(); document.body.classList.add('is-playing'); });
video.addEventListener('pause', () => { paintControls(); savePosition(true); stage.classList.remove('is-idle'); document.body.classList.remove('is-playing'); });
video.addEventListener('emptied', () => document.body.classList.remove('is-playing'));
video.addEventListener('waiting', () => stage.classList.add('is-loading'));
['playing', 'canplay', 'seeked'].forEach((ev) => video.addEventListener(ev, () => stage.classList.remove('is-loading')));
video.addEventListener('volumechange', paintControls);
video.addEventListener('ended', () => {
  if (!playing) return;
  setProgress(playing.ep, video.duration, video.duration, true);
  sync();
  stage.classList.add('is-ended');
  const n = neighbor(1);
  if (!n) {
    // fin de la temporada: no sigue sola. Si hay otra después, se ofrece, pero solo si la tocas.
    const lib = state.library;
    const s = playing.ctx.si != null && lib && lib.series[playing.ctx.si];
    const nextSe = s && !isCollection(s) && playing.ctx.ki != null ? s.seasons[playing.ctx.ki + 1] : null;
    if (!nextSe) { playerMessage(`Terminaste ${playing.ctx.title}.`); return; }
    const first = nextSe.episodes.find((e) => !(prog(e) || {}).w) || nextSe.episodes[0];
    ui.nextCard.innerHTML = `<p>Terminaste ${esc(seasonLabel(s, s.seasons[playing.ctx.ki]))}</p>
      <div class="btn-row">
        <button class="btn btn-lamp" data-act="p-next-season" data-id="${esc(first.id)}">${ICON.play}<span>Ver ${esc(seasonLabel(s, nextSe))}</span></button>
        <a class="btn" href="${playing.ctx.back}">Volver</a>
      </div>`;
    ui.nextCard.hidden = false;
    return;
  }
  let left = 6;
  ui.nextCard.innerHTML = `<p>Sigue ${esc(episodeLabel(n))}</p>
    <div class="btn-row">
      <button class="btn btn-lamp" data-act="p-next-now">${ICON.play}<span>Ver ahora</span></button>
      ${state.settings.autoplay ? `<button class="btn" data-act="p-next-cancel">Quedarme aquí <span id="p-count">${left}</span></button>` : ''}
    </div>`;
  ui.nextCard.hidden = false;
  if (state.settings.autoplay) {
    const tick = () => {
      left -= 1;
      const c = $('#p-count');
      if (c) c.textContent = left;
      if (left <= 0) { ui.nextCard.hidden = true; playNext(); } else nextTimer = setTimeout(tick, 1000);
    };
    nextTimer = setTimeout(tick, 1000);
  }
});

video.addEventListener('error', async () => {
  if (!playing || !video.getAttribute('src')) return;
  const { ep } = playing;
  const at = video.currentTime;
  // Un tropiezo de MEGA o de la red no termina la reproducción: se pide un enlace nuevo y se sigue
  // en el mismo punto. Hasta 4 intentos en 3 minutos, para no quedar en un ciclo si de verdad no hay forma.
  const now = Date.now();
  const code = video.error ? video.error.code : 0;
  playing.recover = (playing.recover || []).filter((t) => now - t < 180000);
  // código 3 (decodificar) o 4 (formato no soportado): repetir no sirve más de una vez; se revisa el formato
  const formatError = code === 3 || code === 4;
  if (formatError && (playing.recover.length >= 1 || playing.objectUrl)) { explainFormat(ep, code); return; }
  if (!playing.objectUrl && playing.recover.length < 4 && navigator.onLine) {
    playing.recover.push(now);
    stage.classList.add('is-loading');
    if (playing.recover.length > 1) await sleep(1500 * (playing.recover.length - 1));
    if (!playing || playing.ep !== ep) return;
    try {
      // se comprueba el enlace nuevo; un tropiezo pasajero de MEGA aquí no cuenta como fallo
      for (let tries = 1; ; tries++) {
        try {
          const fresh = await downloadUrl(ep.id, true);
          await C.readRange(fresh, await C.fileKey(ep.key), 0, 15);
          break;
        } catch (err) {
          const passing = !err.status || err.status === 408 || err.status === 429 || err.status >= 500;
          if (!passing || tries >= 3 || /QUOTA|509/.test(String(err.code || err.message))) throw err;
          await sleep(1500 * tries);
          if (!playing || playing.ep !== ep) return;
        }
      }
      video.src = await streamUrl(ep);
      video.addEventListener('loadedmetadata', () => { if (at) video.currentTime = at; }, { once: true });
      video.play().catch(() => {});
      return;
    } catch (err) {
      playerMessage(megaMessage(err));
      return;
    }
  }
  // detalle para saber la causa si vuelve a pasar (código del navegador y último error del service worker)
  const me = video.error;
  const detail = `Detalle: ${me ? `código ${me.code}${me.message ? `, ${me.message.slice(0, 80)}` : ''}` : 'sin código'}${lastStreamError ? `; ${lastStreamError}` : ''}; ${playing.recover.length} intentos`;
  if (/\.mkv$/i.test(ep.name)) playerMessage('Este navegador no reproduce archivos MKV. Usa la versión MP4 del capítulo.');
  else if (!playing.objectUrl && navigator.onLine) playerMessage('No se pudo reproducir en línea. Puedes descargarlo y verlo desde el dispositivo.', true, false, detail);
  else playerMessage('No se pudo reproducir este capítulo en este navegador.');
});

async function explainFormat(ep, code) {
  const token = playing;
  stage.classList.add('is-loading');
  let f = null;
  try { f = await mp4Formats(await rangeReader(ep, sourceBlob(token)), ep.size); } catch (err) { console.warn('formato', err); }
  if (f && f.video) rememberCodec(ep, f);
  if (playing !== token) return;
  const prob = formatProblem(f);
  const detail = `Detalle: código ${code}; ${formatSummary(f)}`;
  if (prob) playerMessage(`Este video viene en ${prob.what}. ${prob.fix}`, false, false, detail);
  else playerMessage('Este navegador no pudo reproducir el video, aunque su formato parece normal. El archivo podría estar dañado o incompleto en MEGA.', !token.objectUrl, false, detail);
}

let seekFrom = null;
ui.seek.addEventListener('input', () => { if (!seeking) seekFrom = video.currentTime; seeking = true; paintControls(); wake(); });
ui.seek.addEventListener('change', () => {
  const to = Number(ui.seek.value);
  if (seekFrom != null && !(playing && playing.chapters && playing.chapters.length)) learnIntro(seekFrom, to);
  video.currentTime = to;
  seeking = false;
  seekFrom = null;
  paintControls();
});
ui.seek.addEventListener('pointerup', () => { if (seeking) { video.currentTime = Number(ui.seek.value); seeking = false; } });

/* Gestos sobre el video.
 * Mouse: un clic pausa, doble clic pantalla completa.
 * Táctil: un toque muestra u oculta los controles; doble toque a la izquierda o derecha salta 10 s
 * (cada toque rápido extra suma otros 10 s); mantener presionado reproduce a 2× mientras no se suelte.
 * Deslizar: en la página, arriba = pantalla completa y abajo = mini reproductor; en pantalla completa,
 * abajo = salir. */
let lastTap = 0;
let lastTapSide = '';
let tapTimer;
let lastTouchEnd = 0;
const holdEl = $('#st-hold');

/** ¿El reproductor está girado 90° con CSS (iPhone vertical en pantalla completa)? */
const isRotated = () => stage.classList.contains('kai-rot') && stage.classList.contains('kai-fs') && matchMedia('(orientation: portrait)').matches;
/** Punto del toque en coordenadas del video (x hacia la derecha, y hacia abajo del video), aunque esté girado. */
function videoPoint(e) {
  if (isRotated()) return { x: e.clientY, y: innerWidth - e.clientX, w: innerHeight, h: innerWidth };
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
}

LS.del('bright'); // la barra de brillo se quitó en v16

function tapSide(fx) {
  return fx < 0.4 ? 'left' : fx > 0.6 ? 'right' : 'center';
}
// como en Android e iOS: el doble toque se mide desde que se soltó el primero hasta que empieza el segundo
const DOUBLE_TAP = 300;
function handleTouchTap(fx, downAt = Date.now()) {
  const side = tapSide(fx);
  const now = Date.now();
  const gap = downAt - lastTap;
  // racha de toques: tras un doble toque, cada toque rápido del mismo lado suma otros 10 s
  if (lastTapSide === side + '-streak' && gap < 650 && side !== 'center') {
    lastTap = now;
    seekBy(side === 'left' ? -10 : 10);
    return;
  }
  if (gap < DOUBLE_TAP && lastTapSide === side) {
    clearTimeout(tapTimer);
    lastTap = now;
    if (side === 'center') { lastTapSide = ''; togglePlay(); return; }
    lastTapSide = side + '-streak';
    seekBy(side === 'left' ? -10 : 10);
    return;
  }
  lastTap = now;
  lastTapSide = side;
  clearTimeout(tapTimer);
  tapTimer = setTimeout(() => {
    if (stage.classList.contains('is-idle') || video.paused) wake(); else stage.classList.add('is-idle');
  }, DOUBLE_TAP + 60);
}

let touch = null; // gesto táctil en curso
function endHold() {
  if (!touch || !touch.hold) return;
  touch.hold = false;
  video.playbackRate = speed;
  holdEl.classList.remove('is-on');
}
ui.tap.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || !e.isPrimary) return;
  try { ui.tap.setPointerCapture(e.pointerId); } catch { /* nada */ }
  const p = videoPoint(e);
  if (Date.now() - lastTap < DOUBLE_TAP) clearTimeout(tapTimer); // puede ser el segundo toque: no ocultar controles todavía
  touch = { id: e.pointerId, x: p.x, y: p.y, w: p.w, h: p.h, mode: null, hold: false, at: Date.now() };
  const t = touch;
  t.timer = setTimeout(() => {
    if (touch !== t || t.mode || !video.currentSrc || video.paused || video.ended) return;
    t.hold = true;
    t.mode = 'hold';
    video.playbackRate = 2;
    holdEl.classList.add('is-on');
    clearTimeout(tapTimer);
  }, 500);
});
ui.tap.addEventListener('pointermove', (e) => {
  const t = touch;
  if (!t || e.pointerId !== t.id) return;
  const p = videoPoint(e);
  const dx = p.x - t.x;
  const dy = t.y - p.y; // hacia arriba del video es positivo
  if (!t.mode && Math.hypot(dx, dy) > 12) {
    clearTimeout(t.timer);
    const vertical = Math.abs(dy) > Math.abs(dx);
    // en pantalla completa, abajo = salir; en la página, abajo = mini reproductor y arriba = pantalla completa
    t.mode = !vertical ? 'none' : isFullscreen() ? (dy < 0 ? 'fs-down' : 'none') : dy < 0 ? 'down' : 'up';
  }
  if (t.mode === 'down' || t.mode === 'fs-down') {
    const d = Math.max(0, p.y - t.y);
    t.dist = d;
    // el video sigue al dedo; girado, "abajo" del video es hacia la izquierda de la pantalla
    const k = Math.min(d, 220);
    const base = isRotated() ? 'rotate(90deg) ' : '';
    stage.style.transition = 'none';
    stage.style.transform = `${base}translateY(${k * 0.6}px) scale(${1 - k / 1100})`;
    stage.style.opacity = String(1 - k / 600);
  } else if (t.mode === 'up') {
    t.dist = Math.max(0, t.y - p.y);
  }
});
function touchEnd(e, cancelled) {
  const t = touch;
  if (!t || e.pointerId !== t.id) return;
  clearTimeout(t.timer);
  lastTouchEnd = Date.now();
  if (t.hold) endHold();
  else if (t.mode === 'down' || t.mode === 'fs-down') {
    stage.style.transition = 'transform 0.2s, opacity 0.2s';
    stage.style.transform = '';
    stage.style.opacity = '';
    setTimeout(() => { stage.style.transition = ''; }, 220);
    if (!cancelled && t.dist > 70) {
      if (t.mode === 'fs-down') exitFullscreen(); // vuelve al reproductor normal
      else if (playing) goBack(playing.ctx.back); // queda en el mini reproductor
    }
  } else if (t.mode === 'up') {
    if (!cancelled && t.dist > 60) toggleFullscreen();
  }
  else if (!t.mode && !cancelled) handleTouchTap(t.x / Math.max(1, t.w), t.at);
  touch = null;
}
ui.tap.addEventListener('pointerup', (e) => touchEnd(e, false));
ui.tap.addEventListener('pointercancel', (e) => touchEnd(e, true));
ui.tap.addEventListener('contextmenu', (e) => e.preventDefault()); // mantener presionado no abre el menú del sistema

ui.tap.addEventListener('click', (e) => {
  if (Date.now() - lastTouchEnd < 800) return; // ya lo manejaron los gestos táctiles
  if (e.pointerType === 'mouse' || (!e.pointerType && matchMedia('(hover: hover)').matches)) {
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { togglePlay(); }, 200);
    wake();
    return;
  }
  const p = videoPoint(e);
  handleTouchTap(p.x / Math.max(1, p.w));
});
ui.tap.addEventListener('dblclick', (e) => {
  if (!matchMedia('(hover: hover)').matches) return;
  clearTimeout(tapTimer);
  e.preventDefault();
  toggleFullscreen();
});
stage.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') wake(); });

stage.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el === ui.tap) return;
  const act = el.dataset.act;
  wake();
  if (act === 'toggle') togglePlay();
  else if (act === 'back10') seekBy(-10);
  else if (act === 'fwd10') seekBy(10);
  else if (act === 'next') playNext();
  else if (act === 'skip') doSkip();
  else if (act === 'lights') setLights(!document.body.classList.contains('lights-off'));
  else if (act === 'fs') toggleFullscreen();
  else if (act === 'pip') togglePip();
  else if (act === 'mute') video.muted = !video.muted;
  else if (act === 'speed') openMenu('speed');
  else if (act === 'm-speed') { speed = Number(el.dataset.v); video.playbackRate = speed; paintMenu(); paintControls(); }
  else if (act === 'p-next-now') { ui.nextCard.hidden = true; clearTimeout(nextTimer); playNext(); }
  else if (act === 'p-next-season') { ui.nextCard.hidden = true; switchTo(epById(el.dataset.id)); }
  else if (act === 'p-next-cancel') { clearTimeout(nextTimer); ui.nextCard.hidden = true; }
  else if (act === 'p-dl') downloadThenPlay();
  else if (act === 'p-folder' && playing) {
    const ctx = playing.ctx;
    dirAccess(state.dlMeta.get(playing.ep.id)?.dirKey, true).then((d) => { if (d) { playing = null; startPlayback(ctx); flushFolder(); } });
  }
});
ui.menu.addEventListener('change', (e) => {
});
document.addEventListener('pointerdown', (e) => {
  if (!ui.menu.hidden && !ui.menu.contains(e.target) && !e.target.closest('[data-act="cc"],[data-act="speed"]')) closeMenu();
});
['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, () => {
  document.documentElement.classList.toggle('kai-fs-on', isFullscreen());
  paintThemeColor();
  paintControls();
  wake();
}));

if (!(document.pictureInPictureEnabled || video.webkitSupportsPresentationMode)) ui.pip.hidden = true;

document.addEventListener('keydown', (e) => {
  if (route().view !== 'play' || !playing) {
    if (e.key === 'Escape') { closeSheet(); closeDrawer(); if (viewState.picking) endPicking(); }
    return;
  }
  if (e.target.closest('input:not([type="range"]), textarea, select')) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'k') { e.preventDefault(); togglePlay(); }
  else if (k === 'arrowright' || k === 'l') { e.preventDefault(); seekBy(10); }
  else if (k === 'arrowleft' || k === 'j') { e.preventDefault(); seekBy(-10); }
  else if (k === 'f') toggleFullscreen();
  else if (k === 'm') video.muted = !video.muted;
  else if (k === 'n') playNext();
  else if (k === 'b') setLights(!document.body.classList.contains('lights-off'));
  else if (k === 's' && playing && playing.offer) doSkip();
  else if (k === 'p') playPrev();
  else if (k === 'escape') { if (!ui.menu.hidden) closeMenu(); else if (stage.classList.contains('kai-fs')) setKaiFullscreen(false); }
  else return;
  wake();
});

/* ───────────────────────── avisos ───────────────────────── */

let toastTimer;
let toastSeq = 0;
function toast(text) {
  toastSeq++;
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 3800);
}

/* ───────────────────────── eventos globales ───────────────────────── */

document.addEventListener('click', async (e) => {
  // cambiar de capítulo desde la página de reproducción sin llenar el historial
  const link = e.target.closest('a[href^="#/play/"]');
  if (link && route().view === 'play' && app.contains(link)) {
    e.preventDefault();
    const id = decodeURIComponent(link.getAttribute('href').slice('#/play/'.length));
    const ep = epById(id) || (resolveContext(id) || {}).ep;
    if (ep && (!playing || playing.ep.id !== id)) switchTo(ep);
    return;
  }
  const focusLink = e.target.closest('a[data-focus]');
  if (focusLink) { try { sessionStorage.setItem('kai.focus', focusLink.dataset.focus); } catch { /* nada */ } }
  const el = e.target.closest('[data-act]');
  if (!el || stage.contains(el)) return;
  const act = el.dataset.act;
  const li = el.closest('.ep');
  const ep = li && epById(li.dataset.id);
  if (act === 'profile-pick') selectProfile(el.dataset.id);
  else if (act === 'profile-add') renderProfiles(false, true);
  else if (act === 'profiles-edit') renderProfiles(true);
  else if (act === 'profiles-done') renderProfiles(false);
  else if (act === 'profile-delete') {
    const prof = visibleProfiles().find((x) => x.id === el.dataset.id);
    if (!prof || !confirm(`¿Quitar el perfil ${prof.name}? Su progreso deja de mostrarse en Kai.`)) return;
    prof.deleted = true; prof.u = Date.now();
    saveShared();
    if (state.profile && state.profile.id === prof.id) { state.profile = null; LS.del('profile'); }
    renderProfiles(visibleProfiles().length > 0);
    sync();
  }
  else if (act === 'check-update') checkUpdate();
  else if (act === 'home-search') { if ($('#home-search') && !$('#home-search').hidden) closeHomeSearch(); else openHomeSearch(); }
  else if (act === 'home-search-close') closeHomeSearch();
  else if (act === 'cat-clear') { const t = (app.querySelector('.catalog') || {}).dataset?.t; go('#/catalogo' + (t ? '?t=' + t : '')); }
  else if (act === 'apply-update') applyUpdate();
  else if (act === 'dismiss-update') { const n = $('#update-notice'); if (n) n.remove(); }
  else if (act === 'mini-open' && playing) go('#/play/' + encodeURIComponent(playing.ep.id));
  else if (act === 'mini-toggle') togglePlay();
  else if (act === 'mini-close') stopPlayback();
  else if (act === 'dir-pick') pickFolder();
  else if (act === 'dir-off') dropFolder();
  else if (act === 'dir-grant') {
    if (await dirAccess(null, true)) { flushFolder(); if (route().view === 'ajustes') paintDownloadsWhere(); else softRender(); }
    else toast('Sin permiso, Kai guarda las descargas dentro de la app.');
  }
  else if (act === 'pick-mode') { if (viewState.picking) endPicking(); else startPicking(Number(route().arg.split('/')[1]) || 0); }
  else if (act === 'pick-all' || act === 'pick-unseen' || act === 'pick-dl') pickAction(act);
  else if (act === 'seen-all') paintSeenByAll(el);
  else if (act === 'news-clear') {
    LS.set(pkey('news'), []);
    // "Limpiar" también quita las burbujas de "Nuevo" de los pósters: todo lo que hay queda como ya visto
    if (state.library && state.library.series) saveKnown(Object.fromEntries(state.library.series.map((s) => [s.name, (s.full || s.all).map((e) => e.id)])));
    app.querySelectorAll('.tile-badge, .ep-new:not(.is-lang)').forEach((b) => { if (/nuev/i.test(b.textContent)) b.remove(); });
    paintDock();
    const box = $('#news'); if (box) box.innerHTML = newsHTML();
  }
  else if (act === 'movie-dl' || act === 'later-item') {
    const sr = state.library.series[Number(el.dataset.si)];
    const it = sr && collectionItems(sr).find((x) => x.key === el.dataset.key);
    if (!it) return;
    if (act === 'later-item') setLater(sr, it.key, !isLater(sr, it.key));
    else { it.eps.filter((e) => !state.saved.has(e.id)).forEach((e) => queueDownload(e, movieTitle(sr, it))); softRender(); }
  }
  else if (act === 'later') { const sr = state.library.series[Number(el.dataset.si)]; if (sr) setLater(sr, '', !isLater(sr)); }
  else if (act === 'resume-here') {
    const o = resumeOffer(!!playing);
    if (!o) { render(); return; }
    LS.set('nowSeen', o.n.u);
    const p = prog(o.ep);
    // se empieza justo donde quedó el otro dispositivo
    if (!p || Math.abs((p.t || 0) - o.n.t) > 5) setProgress(o.ep, o.n.t, o.n.d || (p && p.d) || 0, false);
    go('#/play/' + encodeURIComponent(o.ep.id));
  }
  else if (act === 'resume-dismiss') { const o = resumeOffer(!!playing); if (o) LS.set('nowSeen', o.n.u); render(); }
  else if (act === 'lang') {
    const sr = state.library && state.library.series[viewState.heroSi];
    if (!sr) return;
    setLangPref(sr, el.dataset.lang);
    if (viewState.picking) viewState.picking.ids = new Set();
    softRender();
  }
  else if (act === 'series-dl') {
    const sr = state.library.series[Number(el.dataset.si)];
    // en la página de una temporada, los siguientes de esa temporada
    const nx = sr && (el.dataset.from ? epById(el.dataset.from) : nextFor(sr));
    const e = nx && el.dataset.from && index.byId.get(nx.id);
    if (nx) {
      const ups = [nx, ...nextUnseen(nx, e ? sr.seasons[e.ki].episodes : sr.all, 2)].filter((x) => !state.saved.has(x.id));
      ups.forEach((x) => queueDownload(x, sr.name));
      toast(`${plural(ups.length, 'capítulo', 'capítulos')} en cola de descarga.`);
    }
  }
  else if (act === 'tmdb-del') { setTmdbKey(''); paintCineKey('Clave quitada.'); }
  else if (act === 'translate') {
    const sr = state.library.series[viewState.heroSi];
    const m = sr && state.meta[el.dataset.key ? itemMetaKey(sr, el.dataset.key) : sr.name];
    if (!m) return;
    el.textContent = 'Traduciendo…';
    const es = await translateToSpanish(m.synopsis, true);
    if (es) {
      m.synopsisEs = es; saveMeta();
      if (m.id) { state.syn[m.id] = { es, u: Date.now() }; saveSyn(); state.synDirty = true; sync(); }
      softRender();
      translateMissing(); // ya con el traductor listo, sigue con las demás
    } else el.textContent = 'Este navegador no puede traducir ahora.';
  }
  else if (act === 'dock') {
    if (dock.classList.contains('is-up')) {
      setDockUp(false);
      upHoldUntil = Date.now() + 1500;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (dock.classList.contains('is-open')) closeDock(); else openDock();
  }
  else if (act === 'profiles-retry') {
    state.sharedError = false;
    renderProfiles();
    try { await connect(); if (syncing) await syncing.catch(() => {}); await sync(); } catch (err) { state.sharedErrorMsg = megaMessage(err); }
    if (!state.sharedLoaded) state.sharedError = true;
    render();
  }
  else if (act === 'theme') { state.settings.theme = resolvedTheme() === 'dark' ? 'light' : 'dark'; saveSettings(); applyTheme(); }
  else if (act === 'set-theme') { state.settings.theme = el.dataset.v; saveSettings(); applyTheme(); renderSettings(); }
  else if (act === 'set-dark-tone') { state.settings.darkTone = el.dataset.v; saveSettings(); applyTheme(); renderSettings(); }
  else if (act === 'set-tone') { state.settings.tone = el.dataset.v; saveSettings(); applyTheme(); renderSettings(); }
  else if (act === 'lights') setLights(false);

  else if (act === 'back') goBack(playing ? playing.ctx.back : '#/');
  else if (act === 'home') goHome();
  else if (act === 'dl' && ep) {
    if (state.dls[ep.id] || state.queue.some((q) => q.ep.id === ep.id)) removeDownload(ep.id);
    else if (state.saved.has(ep.id)) { if (confirm(`¿Quitar ${episodeLabel(ep)} del dispositivo?`)) removeDownload(ep.id); }
    else queueDownload(ep);
  } else if (act === 'more' && ep) openSheet(ep);
  else if (act === 'discover-open') openDiscoverSheet(Number(el.dataset.id));
  else if (act === 'w-more' && playing) openSheet(playing.ep);
  else if (act === 'w-dl' && playing) {
    const cur = playing.ep;
    if (state.saved.has(cur.id)) { if (confirm(`¿Quitar ${episodeLabel(cur)} del dispositivo?`)) removeDownload(cur.id); }
    else if (state.dls[cur.id] || state.queue.some((q) => q.ep.id === cur.id)) removeDownload(cur.id);
    else queueDownload(cur, playing.ctx.title);
  } else if (act === 'w-dl-next' && playing) {
    const ups = nextUnseen(playing.ep, playing.ctx.list, 3).filter((x) => !state.saved.has(x.id));
    ups.forEach((x) => queueDownload(x, playing.ctx.title));
    toast(`${plural(ups.length, 'capítulo', 'capítulos')} en cola de descarga.`);
    paintWatchInfo();
  } else if (act === 'set-root') {
    const node = state.storage && state.storage.files[el.dataset.id];
    if (!node) return;
    state.settings.root = nodePath(node);
    saveSettings();
    state.error = null;
    refreshLibrary(false);
    sync();
    toast(`Tus series ahora salen de ${node.name}.`);
    go('#/');
  } else if (act === 'refresh') {
    el.classList.add('is-spinning');
    try {
      const seq = toastSeq;
      await connect();
      refreshLibrary();
      await sync();
      if (toastSeq === seq) toast('Biblioteca actualizada.');
    } catch (err) {
      toast(megaMessage(err));
    }
    el.classList.remove('is-spinning');
  } else if (act === 'sync-now') {
    await sync();
    toast(state.syncState === 'error' ? 'No se pudo sincronizar. Revisa la conexión.' : 'Progreso sincronizado.');
  } else if (act === 'clear-dl') {
    if (!confirm('¿Quitar todos los capítulos descargados de este dispositivo?')) return;
    await removeAllDownloads();
    toast('Descargas quitadas.');
    render();
  } else if (act === 'logout') {
    if (!confirm('Cerrar sesión borra de este dispositivo la biblioteca y los capítulos descargados. Tu progreso sigue en MEGA.')) return;
    if (state.dirty) await sync().catch(() => {});
    try { if (state.storage) state.storage.close(); } catch { /* nada */ }
    state.storage = null;
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('kai.') && k !== 'kai.settings') localStorage.removeItem(k); } catch { /* nada */ }
    for (const s of ['chunks', 'dl', 'thumbs', 'subcache']) await idb.clear(s).catch(() => {});
    state.library = null; setIndex(buildIndex(null)); state.progress = {}; state.saved.clear(); state.dlMeta.clear();
    state.profile = null; state.shared = { profiles: [], intros: {}, picks: {}, legacyBy: null }; state.sharedLoaded = false; state.meta = {}; resetFichas();
    location.hash = '';
    render();
  }
});

let heroTimer;
app.addEventListener('pointerover', (e) => {
  const t = e.target.closest('.tile');
  if (!t || e.pointerType !== 'mouse' || route().view !== 'home') return;
  clearTimeout(heroTimer);
  heroTimer = setTimeout(() => setHero(Number(t.dataset.si)), 140);
});
app.addEventListener('focusin', (e) => {
  const t = e.target.closest('.tile');
  if (t && route().view === 'home') { clearTimeout(heroTimer); setHero(Number(t.dataset.si)); }
});
// flechas como control remoto: va al mosaico o botón más cercano en esa dirección
app.addEventListener('keydown', (e) => {
  const t = e.target.closest('.tile');
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!t || !dir) return;
  const a = t.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of app.querySelectorAll('.tile, .tv-hero .tv-btn')) {
    if (el === t || !el.offsetParent) continue;
    const b = el.getBoundingClientRect();
    const dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
    const along = dx * dir[0] + dy * dir[1];
    if (along <= 4) continue;
    const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
    const score = along + across * 2.5;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { e.preventDefault(); best.focus(); best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }
});

window.addEventListener('hashchange', () => { onHashChange(); render(); });
window.addEventListener('online', async () => {
  paintSync();
  try { if (!state.storage) { await connect(); refreshLibrary(); } } catch { /* nada */ }
  sync();
  resumePendingDownloads();
});
window.addEventListener('offline', paintSync);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    savePosition(true);
    if (state.dirty) sync();
  } else {
    if (Object.keys(state.dls).length) holdWake();
    if (state.storage && route().view !== 'play') sync();
  }
});
window.addEventListener('pagehide', () => savePosition(true));

/* ───────────────────────── arranque ───────────────────────── */

/* ── actualizaciones ──
 * El service worker se instala solo cuando cambia; al activarse toma el control de la página
 * (controllerchange). Ahí Kai avisa que hay versión nueva y basta con recargar. */
let swReg = null;
let updateReady = false;
let hadController = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
function swVersion() {
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!sw) return Promise.resolve('');
  return new Promise((res) => {
    const done = (e) => { if (e.data && e.data.type === 'version') { navigator.serviceWorker.removeEventListener('message', done); res(e.data.version); } };
    navigator.serviceWorker.addEventListener('message', done);
    sw.postMessage({ type: 'version' });
    setTimeout(() => res(''), 2000);
  });
}
function showUpdateNotice() {
  updateReady = true;
  const btn = $('#check-update');
  if (btn) btn.querySelector('span').textContent = 'Actualizar ahora';
  if ($('#update-notice')) return;
  const el = document.createElement('div');
  el.id = 'update-notice';
  el.className = 'update-notice';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>Hay una versión nueva de Kai.</span><button class="update-btn" data-act="apply-update">Actualizar</button><button class="update-x" data-act="dismiss-update" aria-label="Más tarde">${'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'}</button>`;
  document.body.appendChild(el);
}
function applyUpdate() {
  savePosition(true);
  location.reload();
}
async function checkUpdate() {
  if (updateReady) { applyUpdate(); return; }
  const btn = $('#check-update');
  if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Buscando…'; }
  let found = false;
  try {
    if (!swReg && navigator.serviceWorker) swReg = await navigator.serviceWorker.getRegistration();
    if (swReg) {
      await swReg.update();
      found = !!(swReg.installing || swReg.waiting);
      // si hay una nueva, se instala y toma el control en unos segundos
      for (let i = 0; i < 40 && found && !updateReady; i++) await sleep(250);
    }
  } catch { /* sin conexión */ }
  if (btn) { btn.disabled = false; btn.querySelector('span').textContent = updateReady ? 'Actualizar ahora' : 'Buscar actualización'; }
  if (!updateReady) toast(navigator.onLine ? (found ? 'Descargando la versión nueva…' : 'Ya tienes la última versión.') : 'Necesitas conexión para buscar actualizaciones.');
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; } // primera instalación: no hay nada que avisar
    showUpdateNotice();
  });
}

async function boot() {
  applyTheme();
  paintQuota();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((r) => { swReg = r; }).catch((e) => console.warn('sw', e));
  }
  await refreshSaved().catch(() => {});
  render();
  // Samsung Internet oscurece las páginas a su manera y Kai no lo puede evitar desde aquí: se avisa una vez
  if (/SamsungBrowser/.test(navigator.userAgent) && !LS.get('samsungHint', false)) {
    LS.set('samsungHint', true);
    setTimeout(() => toast('Si Kai se ve con colores raros aquí, desactiva el modo oscuro de Samsung Internet o usa Chrome.'), 2500);
  }
  getDir().then((d) => { if (d) flushFolder(); }).catch(() => {}); // si la carpeta ya tiene permiso, termina lo pendiente
  if (!LS.get('session', null) || !navigator.onLine) return;
  try {
    await connect();
    refreshLibrary(false);
    render();
    await sync();
    if (!state.profile || route().view === 'perfiles') render();
    resumePendingDownloads();
    refreshAccountInfo();
    ensureMeta();
  } catch (err) {
    const m = megaMessage(err);
    if (/venció/.test(m)) {
      LS.del('session');
      loginNote = m;
      renderLogin(m);
    } else {
      toast(m);
      render();
    }
  }
}

boot();
