/*
 * Los botones de Kai: cada elemento con data-act="nombre" ejecuta la acción de ese nombre al tocarlo.
 * Las del reproductor (dentro de #stage) las atiende controllers/player/; aquí está todo lo demás.
 */
import { translateToSpanish } from '../models/meta-api.js';
import { $, LS, plural } from '../lib/util.js';
import { route } from '../lib/route.js';
import { state, index, setIndex, saveSettings, pkey, saveShared, visibleProfiles } from '../models/store.js';
import { megaMessage, connect } from '../models/mega.js';
import { nodePath, buildIndex, setLangPref, epById } from '../models/library.js';
import { removeAllDownloads, removeDownload, dirAccess, flushFolder } from '../models/downloads.js';
import {
  episodeLabel,
  collectionItems,
  itemMetaKey,
  movieTitle,
  studioSorted,
  setStudioShuffle,
} from '../models/collections.js';
import { nextUnseen, resumeOffer, prog, setProgress, isLater } from '../models/progress.js';
import { saveMeta } from '../models/fichas.js';
import { setTmdbKey, saveSyn, translateMissing, resetFichas } from '../models/fichas-sync.js';
import { idb } from '../models/idb.js';
import { refreshAccountInfo } from '../models/quota.js';
import { saveKnown } from '../models/news.js';
import { nextFor } from '../models/plans.js';
import { resolveContext } from '../models/context.js';
import { viewState } from '../views/view-state.js';
import { renderProfiles } from '../views/account.js';
import { askConfirm } from '../views/sheet.js';
import { toast, toastCount } from '../views/toast.js';
import { resolvedTheme, applyTheme } from '../views/theme.js';
import { app } from '../views/components.js';
import { openHomeSearch, closeHomeSearch } from '../views/catalog.js';
import {
  newsHTML,
  paintSeenByAll,
  renderSettings,
  paintCineKey,
  paintDownloadsWhere,
  avatarPickHTML,
} from '../views/settings.js';
import { setProfilePref, setProfileAvatar, setProfileImage } from '../models/profiles.js';
import { openDiscoverSheet } from '../views/discover.js';
import { startPicking, endPicking, pickAction, pickAll } from './picking.js';
import { go, goHome, goBack, render, softRender } from './router.js';
import { paintDock, toggleDock, dockUp } from './dock.js';
import { sync, syncing, refreshLibrary, setLater } from './sync.js';
import { forgetSyncSkips } from '../models/sync.js';
import { selectProfile, checkCopies, pickCopy, applyCopies } from './account.js';
import { queueDownload, pickFolder, dropFolder } from './downloads.js';
import { openSheet } from './sheet.js';
import { checkUpdate, applyUpdate, showUpdateNews } from './updates.js';
import { scrollRow } from './posters.js';
import { P } from './player/state.js';
import { stage } from './player/dom.js';
import { togglePlay, setLights, paintControls } from './player/controls.js';
import { switchTo, stopPlayback } from './player/engine.js';
import { paintWatchInfo } from './player/page.js';
import { openFromMini } from './player/mini.js';

const seriesAt = (el) => state.library && state.library.series[Number(el.dataset.si)];
const isQueued = (id) => !!state.dls[id] || state.queue.some((q) => q.ep.id === id);

/** Descarga un capítulo, o lo quita si ya está (pregunta antes de borrar uno terminado). */
async function toggleDownload(ep, title) {
  if (state.saved.has(ep.id)) {
    if (await askConfirm(`¿Quitar ${episodeLabel(ep)} del dispositivo?`, { ok: 'Quitar' })) removeDownload(ep.id);
  } else if (isQueued(ep.id)) removeDownload(ep.id);
  else queueDownload(ep, title);
}

function queueNext(ups, title) {
  ups.forEach((x) => queueDownload(x, title));
  toast(`${plural(ups.length, 'capítulo', 'capítulos')} en cola de descarga.`);
}

/**
 * Cambia un ajuste de apariencia. Si viene del selector (`el`), solo se mueve la opción marcada de ese selector: no
 * hace falta volver a dibujar toda la página de Ajustes (recalculaba el espacio, la versión y todo lo demás en cada
 * toque). El estilo y el Laboratorio sí la redibujan, porque cambian qué opciones hay.
 */
function setThemeSetting(key, value, repaint = true, el = null) {
  state.settings[key] = value;
  saveSettings();
  applyTheme();
  const group = el && el.closest('.segmented');
  if (group && key !== 'style' && key !== 'lab') {
    for (const b of group.querySelectorAll('.seg')) {
      b.classList.toggle('is-on', b === el);
      b.setAttribute('aria-pressed', String(b === el));
    }
    return;
  }
  if (repaint) renderSettings();
}

/* ── perfiles y cuenta ── */

async function deleteProfile(el) {
  const prof = visibleProfiles().find((x) => x.id === el.dataset.id);
  if (!prof) return;
  const ok = await askConfirm(`¿Quitar el perfil ${prof.name}?`, {
    detail: 'Su progreso deja de mostrarse en Kai.',
    ok: 'Quitar perfil',
  });
  if (!ok) return;
  prof.deleted = true;
  prof.u = Date.now();
  saveShared();
  if (state.profile && state.profile.id === prof.id) {
    state.profile = null;
    LS.del('profile');
  }
  renderProfiles(visibleProfiles().length > 0);
  sync();
}

async function retryProfiles() {
  state.sharedError = false;
  renderProfiles();
  try {
    await connect();
    if (syncing) await syncing.catch(() => {});
    await sync();
  } catch (err) {
    state.sharedErrorMsg = megaMessage(err);
  }
  if (!state.sharedLoaded) state.sharedError = true;
  render();
}

async function logout() {
  const ok = await askConfirm('¿Cerrar sesión en este dispositivo?', {
    detail: 'Se borran de este dispositivo la biblioteca y los capítulos descargados. Tu progreso sigue en MEGA.',
    ok: 'Cerrar sesión',
  });
  if (!ok) return;
  // siempre se intenta subir antes de borrar lo de este dispositivo; si algo no subió, se avisa (antes se perdía)
  await sync().catch(() => {});
  const pending =
    state.dirty ||
    (!!state.storage && state.syncState === 'error') ||
    visibleProfiles().some((p) => LS.get(`p.${p.id}.dirty`, false));
  if (pending) {
    const sure = await askConfirm('Hay progreso que no se pudo subir a MEGA.', {
      detail: 'Si cierras sesión ahora, lo que viste en este dispositivo y no se subió se pierde.',
      ok: 'Cerrar sesión igual',
    });
    if (!sure) return;
  }
  try {
    if (state.storage) state.storage.close();
  } catch {
    /* nada */
  }
  state.storage = null;
  try {
    for (const k of Object.keys(localStorage))
      if (k.startsWith('kai.') && k !== 'kai.settings') localStorage.removeItem(k);
  } catch {
    /* nada */
  }
  for (const s of ['chunks', 'dl', 'thumbs', 'subcache']) await idb.clear(s).catch(() => {});
  state.library = null;
  setIndex(buildIndex(null));
  state.progress = {};
  state.saved.clear();
  state.dlMeta.clear();
  state.profile = null;
  state.shared = { profiles: [], intros: {}, picks: {}, legacyBy: null };
  state.sharedLoaded = false;
  state.meta = {};
  resetFichas();
  location.hash = '';
  render();
}

/* ── biblioteca ── */

async function refreshNow(el) {
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
}

function setRoot(el) {
  const node = state.storage && state.storage.files[el.dataset.id];
  if (!node) return;
  state.settings.root = nodePath(node);
  saveSettings();
  state.error = null;
  refreshLibrary(false);
  sync();
  toast(`Tus series ahora salen de ${node.name}.`);
  go('#/');
}

function clearNews() {
  LS.set(pkey('news'), []);
  // "Limpiar" también quita las burbujas de "Nuevo" de los pósters: todo lo que hay queda como ya visto
  if (state.library && state.library.series)
    saveKnown(Object.fromEntries(state.library.series.map((s) => [s.name, (s.full || s.all).map((e) => e.id)])));
  app.querySelectorAll('.tile-badge, .ep-new:not(.is-lang)').forEach((b) => {
    if (/nuev/i.test(b.textContent)) b.remove();
  });
  paintDock();
  const box = $('#news');
  if (box) box.innerHTML = newsHTML();
}

/* ── seguir viendo lo de otro dispositivo ── */

function resumeHere() {
  const o = resumeOffer(!!P.playing);
  if (!o) return render();
  LS.set('nowSeen', o.n.u);
  const p = prog(o.ep);
  // se empieza justo donde quedó el otro dispositivo
  if (!p || Math.abs((p.t || 0) - o.n.t) > 5) setProgress(o.ep, o.n.t, o.n.d || (p && p.d) || 0, false);
  go('#/play/' + encodeURIComponent(o.ep.id));
}

function dismissResume() {
  const o = resumeOffer(!!P.playing);
  if (o) LS.set('nowSeen', o.n.u);
  render();
}

/* ── series y películas ── */

function movieAction(el, later) {
  const sr = seriesAt(el);
  const it = sr && collectionItems(sr).find((x) => x.key === el.dataset.key);
  if (!it) return;
  if (later) return setLater(sr, it.key, !isLater(sr, it.key));
  it.eps.filter((e) => !state.saved.has(e.id)).forEach((e) => queueDownload(e, movieTitle(sr, it)));
  softRender();
}

/** "Descargar los 3 siguientes": en la página de una temporada, los siguientes de esa temporada. */
function downloadNextOfSeries(el) {
  const sr = seriesAt(el);
  const nx = sr && (el.dataset.from ? epById(el.dataset.from) : nextFor(sr));
  if (!nx) return;
  const e = el.dataset.from && index.byId.get(nx.id);
  const list = e ? sr.seasons[e.ki].episodes : sr.all;
  queueNext(
    [nx, ...nextUnseen(nx, list, 2)].filter((x) => !state.saved.has(x.id)),
    sr.name,
  );
}

function chooseLang(el) {
  const sr = state.library && state.library.series[viewState.heroSi];
  if (!sr) return;
  setLangPref(sr, el.dataset.lang);
  if (viewState.picking) viewState.picking.ids = new Set();
  softRender();
}

async function translateSynopsis(el) {
  const sr = state.library.series[viewState.heroSi];
  const m = sr && state.meta[el.dataset.key ? itemMetaKey(sr, el.dataset.key) : sr.name];
  if (!m) return;
  el.textContent = 'Traduciendo…';
  const es = await translateToSpanish(m.synopsis, true);
  if (!es) {
    el.textContent = 'Este navegador no puede traducir ahora.';
    return;
  }
  m.synopsisEs = es;
  saveMeta();
  if (m.id) {
    state.syn[m.id] = { es, u: Date.now() };
    saveSyn();
    state.synDirty = true;
    sync();
  }
  softRender();
  translateMissing(); // ya con el traductor listo, sigue con las demás
}

/* ── descargas ── */

async function grantFolder() {
  if (!(await dirAccess(null, true))) return toast('Sin permiso, Kai guarda las descargas dentro de la app.');
  flushFolder();
  if (route().view === 'ajustes') paintDownloadsWhere();
  else softRender();
}

async function clearDownloads() {
  const ok = await askConfirm('¿Quitar todas las descargas?', {
    detail: 'Se quitan de este dispositivo todos los capítulos descargados.',
    ok: 'Quitar todas',
  });
  if (!ok) return;
  await removeAllDownloads();
  toast('Descargas quitadas.');
  render();
}

/** Studio → todas las canciones seguidas, en orden o en aleatorio. @param {HTMLElement} el @param {boolean} shuffle */
function studioPlay(el, shuffle) {
  const s = state.library && state.library.series[Number(el.dataset.si)];
  if (!s) return;
  const ids = studioSorted(s.all).map((e) => e.id);
  if (shuffle)
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
  setStudioShuffle(shuffle ? ids : null);
  if (ids.length) go('#/play/' + encodeURIComponent(ids[0]));
}

/** Descargados → quitar de una vez los capítulos que este perfil ya terminó de ver. */
async function clearSeenDownloads() {
  const epOf = (/** @type {any} */ m) => m.ep || (index.byId.get(m.id) || {}).ep;
  const seen = [...state.dlMeta.values()].filter((m) => m.done && epOf(m) && (prog(epOf(m)) || {}).w);
  if (!seen.length) return;
  const ok = await askConfirm(`¿Quitar ${plural(seen.length, 'capítulo visto', 'capítulos vistos')}?`, {
    detail: 'Se quitan de este dispositivo los capítulos descargados que este perfil ya terminó de ver.',
    ok: 'Quitar',
  });
  if (!ok) return;
  for (const m of seen) await removeDownload(m.id, true);
  toast(`${plural(seen.length, 'capítulo quitado', 'capítulos quitados')} del dispositivo.`);
  render();
}

/**
 * Cada acción recibe el elemento tocado y, si está dentro de una fila de capítulo, ese capítulo.
 * @type {Record<string, (el: HTMLElement, ep: any) => unknown>}
 */
const ACTIONS = {
  // perfiles y cuenta
  'profile-pick': (el) => selectProfile(el.dataset.id),
  'profile-add': () => renderProfiles(false, true),
  'profiles-edit': () => renderProfiles(true),
  'profiles-done': () => renderProfiles(false),
  'profile-delete': deleteProfile,
  'profiles-retry': retryProfiles,
  logout,

  // actualizaciones
  'check-update': () => checkUpdate(),
  'apply-update': () => applyUpdate(),
  'update-news': () => showUpdateNews(),

  // navegación
  dock: () => toggleDock(),
  'dock-up': () => dockUp(),
  back: () => goBack(P.playing ? P.playing.ctx.back : '#/'),
  home: () => goHome(),
  'home-search': () => {
    const bar = $('#home-search');
    if (bar && !bar.hidden) closeHomeSearch();
    else openHomeSearch();
  },
  'home-search-close': () => closeHomeSearch(),
  'cat-clear': () => {
    const t = app.querySelector('.catalog')?.dataset?.t;
    go('#/catalogo' + (t ? '?t=' + t : ''));
  },
  'discover-open': (el) => openDiscoverSheet(Number(el.dataset.id)),

  // mini reproductor
  'mini-open': () => openFromMini(),
  'mini-toggle': () => togglePlay(),
  'mini-close': () => stopPlayback(),

  // biblioteca y sincronización
  refresh: refreshNow,
  'sync-now': async (el) => {
    // el botón muestra que está trabajando y, al terminar, que quedó (en Bloques se ve con un giro y un ✓)
    el.classList.add('is-working');
    forgetSyncSkips(); // pedido a mano: se lee todo de MEGA, aunque parezca igual
    await sync();
    el.classList.remove('is-working');
    // si la sincronización trajo cambios, Ajustes se volvió a dibujar y el botón es otro: se marca el que está ahora
    const btn = document.querySelector('[data-act="sync-now"]') || el;
    btn.classList.remove('is-working');
    if (state.syncState !== 'error') {
      btn.classList.add('is-done');
      setTimeout(() => btn.classList.remove('is-done'), 1800);
    }
    refreshAccountInfo(true);
    toast(state.syncState === 'error' ? 'No se pudo sincronizar. Revisa la conexión.' : 'Progreso sincronizado.');
  },
  'set-root': setRoot,
  'news-clear': clearNews,
  'seen-all': (el) => paintSeenByAll(el),
  'copies-check': (el) => checkCopies(/** @type {HTMLButtonElement} */ (el)),
  'copy-pick': (el) => pickCopy(el),
  'copies-apply': () => applyCopies(),
  'resume-here': resumeHere,
  'resume-toggle': (el) => {
    const box = el.closest('.resume-card');
    const open = !box.classList.contains('is-open');
    box.classList.toggle('is-open', open);
    box.querySelector('.resume-pill')?.setAttribute('aria-expanded', String(open));
  },
  'resume-dismiss': dismissResume,

  // series, temporadas y películas
  lang: chooseLang,
  later: (el) => {
    const sr = seriesAt(el);
    if (sr) setLater(sr, '', !isLater(sr));
  },
  'later-item': (el) => movieAction(el, true),
  'movie-dl': (el) => movieAction(el, false),
  'series-dl': downloadNextOfSeries,
  'pick-mode': () => (viewState.picking ? endPicking() : startPicking(Number(route().arg.split('/')[1]) || 0)),
  'pick-all': () => pickAll(),
  'pick-seen': () => pickAction('pick-seen'),
  'pick-unseen': () => pickAction('pick-unseen'),
  'pick-dl': () => pickAction('pick-dl'),
  translate: translateSynopsis,
  'tmdb-del': () => {
    setTmdbKey('');
    paintCineKey('Clave quitada.');
  },

  // capítulos
  dl: (el, ep) => ep && toggleDownload(ep),
  more: (el, ep) => ep && openSheet(ep),
  'w-more': () => P.playing && openSheet(P.playing.ep),
  'w-dl': () => P.playing && toggleDownload(P.playing.ep, P.playing.ctx.title),
  'w-dl-next': () => {
    if (!P.playing) return;
    queueNext(
      nextUnseen(P.playing.ep, P.playing.ctx.list, 3).filter((x) => !state.saved.has(x.id)),
      P.playing.ctx.title,
    );
    paintWatchInfo();
  },

  // descargas
  'dir-pick': () => pickFolder(),
  'dir-off': () => dropFolder(),
  'dir-grant': grantFolder,
  'clear-dl': clearDownloads,
  'clear-seen-dl': clearSeenDownloads,
  'row-prev': (el) => scrollRow(el, -1),
  'row-next': (el) => scrollRow(el, 1),
  'studio-play': (el) => studioPlay(el, false),
  'studio-shuffle': (el) => studioPlay(el, true),

  // tema y luz
  theme: () => setThemeSetting('theme', resolvedTheme() === 'dark' ? 'light' : 'dark', false),
  'set-theme': (el) => setThemeSetting('theme', el.dataset.v, true, el),
  'set-avatar': (el) => {
    setProfileAvatar(el.dataset.v || '');
    repaintAvatar();
  },
  'avatar-upload': () => pickAvatarImage(),
  'set-hold': (el) => setPlayerPref('hold', Number(el.dataset.v)),
  'set-step': (el) => setPlayerPref('step', Number(el.dataset.v)),
  'set-dark-tone': (el) => setThemeSetting('darkTone', el.dataset.v, true, el),
  'set-tone': (el) => setThemeSetting('tone', el.dataset.v, true, el),
  'set-style': (el) => setThemeSetting('style', el.dataset.v),
  'set-lab': (el) => setThemeSetting('lab', el.dataset.v === 'on'),
  'set-block-tone': (el) => setThemeSetting('blockTone', el.dataset.v, true, el),
  'set-block-dark': (el) => setThemeSetting('blockDark', el.dataset.v, true, el),
  'set-motion': (el) => setThemeSetting('motion', el.dataset.v, true, el),
  'set-lite': (el) => setThemeSetting('lite', el.dataset.v, true, el),
  lights: () => setLights(false),
};

/** Cambiar de capítulo desde la página de reproducción sin llenar el historial. */
function switchFromLink(e) {
  const link = e.target.closest('a[href^="#/play/"]');
  if (!link || route().view !== 'play' || !app.contains(link)) return false;
  e.preventDefault();
  const id = decodeURIComponent(link.getAttribute('href').slice('#/play/'.length));
  const ep = epById(id) || (resolveContext(id) || {}).ep;
  if (ep && (!P.playing || P.playing.ep.id !== id)) switchTo(ep);
  return true;
}

function onClick(e) {
  if (switchFromLink(e)) return;
  const focusLink = e.target.closest('a[data-focus]');
  if (focusLink) {
    try {
      sessionStorage.setItem('kai.focus', focusLink.dataset.focus);
    } catch {
      /* nada */
    }
  }
  const el = e.target.closest('[data-act]');
  if (!el || stage.contains(el)) return;
  const run = Object.hasOwn(ACTIONS, el.dataset.act) && ACTIONS[el.dataset.act];
  if (!run) return;
  const li = el.closest('.ep');
  Promise.resolve(run(el, li && epById(li.dataset.id))).catch((err) => console.warn(el.dataset.act, err));
}

/** Tocar o hacer clic en cualquier otra parte cierra el buscador (sus resultados y la lupa no cuentan). */
function closeSearchOutside(e) {
  const bar = $('#home-search');
  if (!bar || bar.hidden) return;
  if (e.target.closest('#home-search, #home-results, [data-act="home-search"]')) return;
  closeHomeSearch();
}

/** Después de cambiar el avatar: su sección de Ajustes, la barra, y a sincronizar. */
function repaintAvatar() {
  const box = $('#avatar-pick');
  if (box) box.innerHTML = avatarPickHTML();
  paintDock();
  sync();
}

const AVATAR_PX = 192;
/**
 * Achica una imagen a un cuadrado de 192 px (recortando el centro) y la devuelve como texto (JPEG). Queda en unos
 * 10 a 20 KB: lo bastante chica para viajar dentro del perfil.
 * @param {File} file
 */
async function squareAvatar(file) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = AVATAR_PX;
  const g = c.getContext('2d');
  g.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  if (bmp.close) bmp.close();
  for (const q of [0.85, 0.7, 0.55]) {
    const url = c.toDataURL('image/jpeg', q);
    if (url.length < 60000) return url;
  }
  return c.toDataURL('image/jpeg', 0.4);
}

/** Abre el selector de archivos y deja la imagen elegida como avatar del perfil. */
function pickAvatarImage() {
  const input = /** @type {HTMLInputElement | null} */ ($('#avatar-file'));
  if (!input) return;
  input.onchange = async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      if (!setProfileImage(await squareAvatar(file))) throw new Error('no se pudo guardar');
      repaintAvatar();
      toast('Listo: tu avatar se verá en todos tus dispositivos.');
    } catch (err) {
      console.warn('avatar', err);
      toast('No se pudo usar esa imagen. Prueba con una foto en JPG o PNG.');
    }
  };
  input.click();
}

/** Una preferencia del reproductor del perfil activo (Ajustes): se guarda, se redibuja su sección y se sincroniza. */
function setPlayerPref(/** @type {'hold' | 'step'} */ key, /** @type {number} */ v) {
  setProfilePref(key, v);
  // solo se mueve la opción marcada (redibujar el grupo hacía saltar la píldora)
  const box = $('#player-prefs');
  const act = key === 'hold' ? 'set-hold' : 'set-step';
  if (box)
    for (const b of box.querySelectorAll(`[data-act="${act}"]`)) {
      const on = Number(/** @type {HTMLElement} */ (b).dataset.v) === v;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  paintControls();
  sync();
}

export function initActions() {
  document.addEventListener('click', onClick);
  document.addEventListener('pointerdown', closeSearchOutside);
}
