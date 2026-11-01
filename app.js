import { mp4Info, mp4Chapters, mp4Formats, pickIntro, OUTRO_RE as OUTRO } from './models/subs.js';
import { translateToSpanish } from './models/meta-api.js';
import { $, LS, esc, sleep, fmtTime, fmtSize, plural } from './lib/util.js';
import { ICON } from './views/icons.js';
import { state, index, setIndex, saveSettings, pkey, saveShared, visibleProfiles } from './models/store.js';
import { C, megaMessage, login, connect, downloadUrl } from './models/mega.js';
import { loadProfileState, nodePath, buildLibrary, buildIndex, learnAudioLang, setLangPref, setLibrary, librarySignature } from './models/library.js';

import * as downloads from './models/downloads.js';
import { setInUseCheck, removeAllDownloads, refreshSaved, resumePendingDownloads, removeDownload, localBlob, holdWake, getDir, dirAccess, flushFolder, useFolder, forgetFolder } from './models/downloads.js';
import { episodeLabel } from './models/collections.js';
import { nextUnseen, resumeOffer } from './models/progress.js';
import { viewState } from './views/view-state.js';
import { startPicking, endPicking, pickAction } from './controllers/picking.js';
import { isUpdateReady, markUpdateReady, setRegistration, findUpdate } from './models/updates.js';
import { renderLogin, renderProfiles, avatarHTML } from './views/account.js';
import { addProfile, useProfile } from './models/profiles.js';
import { toast, toastCount } from './views/toast.js';
import { resolvedTheme, paintThemeColor, applyTheme } from './views/theme.js';
import './views/images.js';
import { on } from './lib/events.js';
import { syncShared, syncProgress } from './models/sync.js';
import { countBytes, noteQuota, quotaUntil, refreshAccountInfo } from './models/quota.js';
import { quotaText, paintQuota } from './views/quota.js';
import { isCollection, collectionItems, itemMetaKey, itemFor, movieTitle } from './models/collections.js';
import { prog, setProgress, markNow, isLater } from './models/progress.js';
import { setLaterFlag } from './models/progress.js';
import { profilesFromBackup, normName } from './models/profiles.js';
import { seasonLabel, saveMeta } from './models/fichas.js';
import { setTmdbKey, ensureMeta, saveSyn, translateMissing, syncSynopses, syncFichas, resetFichas } from './models/fichas-sync.js';
import { idb } from './models/idb.js';
import { saveKnown, initKnown, newEpisodes, markSeriesSeen, hasUnreadNews, announceNew } from './models/news.js';
import { epById } from './models/library.js';
import { thumbFor } from './models/thumbs.js';
import { saveChapterCache, rangeReader, cacheChapters, formatProblem, formatSummary, rememberCodec } from './models/media.js';
import { hydrateThumbs } from './views/thumbs.js';
import { nextFor } from './models/plans.js';
import { seriesColor } from './models/fichas.js';
import { header, setTint, app } from './views/components.js';
import { setHero, renderHome } from './views/home.js';
import { dlButton, episodeRow } from './views/episodes.js';
import { renderSeries, renderMovie } from './views/series.js';
import { route } from './lib/route.js';
import { resolveContext, titleFor } from './models/context.js';
import { paintSync, paintDrawerCount, paintNewsDot } from './views/dock.js';
import { renderCatalog, openHomeSearch, closeHomeSearch } from './views/catalog.js';
import { renderExplorer } from './views/explorer.js';
import { renderDownloads } from './views/downloads.js';
import { newsHTML, paintSeenByAll, renderSettings, paintCineKey, paintDownloadsWhere, paintSpace } from './views/settings.js';
import { renderDiscover, openDiscoverSheet } from './views/discover.js';
import { showSheet, closeSheet } from './views/sheet.js';

on('quota', paintQuota);
on('theme', () => { if (dock.classList.contains('is-open')) fillDock(); });
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
  if (!LS.get('session', null)) { stopPlayback(); renderLogin(loginNote); return; }
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
on('login', async ({ email, password, code, needCode }) => {
  try {
    await login(email, password, code);
    loginNote = '';
    refreshLibrary(false);
    location.hash = '#/';
    render();
    sync();
  } catch (err) {
    const m = megaMessage(err);
    if (m === 'MFA') renderLogin('', true, email);
    else renderLogin(m, needCode, email);
  }
});

/* ── perfiles ── */

on('profile-create', (name) => createProfile(name));
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
  selectProfile(addProfile(name).id);
}

function selectProfile(id) {
  const p = visibleProfiles().find((x) => x.id === id);
  if (!p) return;
  if (state.profile && state.profile.id !== id) { savePosition(true); stopPlayback(); }
  useProfile(p);
  location.hash = '#/';
  render();
  sync();
}
/* ── capítulos nuevos ── */

/* ── sinopsis e imágenes ── */

/* ── portada estilo TV ── */

/* ── catálogo: todo lo que hay, con buscador y filtros ── */

// tocar o hacer clic en cualquier otra parte cierra el buscador (sus resultados y la lupa no cuentan)
document.addEventListener('pointerdown', (e) => {
  const bar = $('#home-search');
  if (!bar || bar.hidden) return;
  if (e.target.closest('#home-search, #home-results, [data-act="home-search"]')) return;
  closeHomeSearch();
});

/* ── serie ── */

/* ── películas: el estante (la carpeta) y la página de cada una ── */

/* ── selección de varios capítulos de una temporada para descargarlos juntos ── */


function paintEpisode(id) {
  const ep = epById(id);
  if (!ep) return;
  document.querySelectorAll(`.ep[data-id="${CSS.escape(id)}"] [data-act="dl"]`).forEach((btn) => { btn.outerHTML = dlButton(ep); });
  const wd = document.querySelector(`[data-act="w-dl"][data-id="${CSS.escape(id)}"]`);
  if (wd) wd.outerHTML = watchDlButton(ep);
}

/* ── explorar MEGA ── */

/* ── descargados ── */

/* ── ajustes ── */

/* ── hoja de opciones de un capítulo ── */

function openSheet(ep) {
  const p = prog(ep);
  const saved = state.saved.has(ep.id);
  const busy = !!state.dls[ep.id] || state.queue.some((q) => q.ep.id === ep.id);
  const ctx = resolveContext(ep.id);
  const upcoming = ctx ? nextUnseen(ep, ctx.list, 3).filter((x) => !state.saved.has(x.id)) : [];
  const ie = index.byId.get(ep.id);
  const series = ie ? state.library.series[ie.si] : null;
  const movie = series ? itemFor(series, ep) : null; // solo las películas de la colección
  const sheet = showSheet(`<div class="sheet-back" data-act="close"></div>
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
    </div>`, async (e) => {
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
  });
  sheet.querySelector('.sheet-btn').focus();
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
      const seq = toastCount();
      await connect();
      refreshLibrary();
      await sync();
      if (toastCount() === seq) toast('Biblioteca actualizada.');
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
let hadController = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
function showUpdateNotice() {
  markUpdateReady();
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
  if (isUpdateReady()) { applyUpdate(); return; }
  const btn = $('#check-update');
  if (btn) { btn.disabled = true; btn.querySelector('span').textContent = 'Buscando…'; }
  const found = await findUpdate();
  if (btn) { btn.disabled = false; btn.querySelector('span').textContent = isUpdateReady() ? 'Actualizar ahora' : 'Buscar actualización'; }
  if (!isUpdateReady()) toast(navigator.onLine ? (found ? 'Descargando la versión nueva…' : 'Ya tienes la última versión.') : 'Necesitas conexión para buscar actualizaciones.');
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
    navigator.serviceWorker.register('sw.js').then((r) => { setRegistration(r); }).catch((e) => console.warn('sw', e));
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
