import { translateToSpanish } from './models/meta-api.js';
import { $, LS, plural } from './lib/util.js';
import { state, index, setIndex, saveSettings, pkey, saveShared, visibleProfiles } from './models/store.js';
import { megaMessage, connect } from './models/mega.js';
import { loadProfileState, nodePath, buildIndex, setLangPref } from './models/library.js';

import { setInUseCheck, removeAllDownloads, refreshSaved, resumePendingDownloads, removeDownload, holdWake, getDir, dirAccess, flushFolder } from './models/downloads.js';
import { episodeLabel } from './models/collections.js';
import { nextUnseen, resumeOffer } from './models/progress.js';
import { viewState } from './views/view-state.js';
import { startPicking, endPicking, pickAction } from './controllers/picking.js';
import { isUpdateReady, markUpdateReady, setRegistration, findUpdate } from './models/updates.js';
import { renderLogin, renderProfiles } from './views/account.js';
import { toast, toastCount } from './views/toast.js';
import { resolvedTheme, applyTheme } from './views/theme.js';
import './views/images.js';
import { setPlayer, go, goHome, goBack, render, softRender, onHashChange } from './controllers/router.js';
import { dock, paintDock, fillDock, toggleDock } from './controllers/dock.js';
import { sync, syncing, refreshLibrary, setLater } from './controllers/sync.js';
import { selectProfile } from './controllers/account.js';
import { queueDownload, pickFolder, dropFolder } from './controllers/downloads.js';
import { openSheet } from './controllers/sheet.js';
import { P } from './controllers/player/state.js';
import { on } from './lib/events.js';
import { refreshAccountInfo } from './models/quota.js';
import { paintQuota } from './views/quota.js';
import { collectionItems, itemMetaKey, movieTitle } from './models/collections.js';
import { prog, setProgress, isLater } from './models/progress.js';
import { saveMeta } from './models/fichas.js';
import { setTmdbKey, ensureMeta, saveSyn, translateMissing, resetFichas } from './models/fichas-sync.js';
import { idb } from './models/idb.js';
import { saveKnown } from './models/news.js';
import { epById } from './models/library.js';
import { cacheChapters } from './models/media.js';
import { nextFor } from './models/plans.js';
import { app } from './views/components.js';
import { setHero } from './views/home.js';
import { dlButton } from './views/episodes.js';
import { route } from './lib/route.js';
import { resolveContext } from './models/context.js';
import { paintSync, paintDrawerCount, paintNewsDot } from './views/dock.js';
import { openHomeSearch, closeHomeSearch } from './views/catalog.js';
import { renderDownloads } from './views/downloads.js';
import { newsHTML, paintSeenByAll, renderSettings, paintCineKey, paintDownloadsWhere, paintSpace } from './views/settings.js';
import { openDiscoverSheet } from './views/discover.js';
import { stage, video } from './controllers/player/dom.js';
import { watchDlButton } from './views/watch.js';
import { enterMini } from './controllers/player/mini.js';
import { togglePlay, setLights } from './controllers/player/controls.js';
import { switchTo, savePosition, stopPlayback } from './controllers/player/engine.js';
import { renderWatch, paintWatchInfo } from './controllers/player/page.js';
// los gestos y los eventos del video se registran al cargarse
import './controllers/player/gestures.js';
import './controllers/player/events.js';

on('quota', paintQuota);
on('theme', () => { if (dock.classList.contains('is-open')) fillDock(); });
on('notice', (text) => toast(text));
on('download-changed', (id) => { paintEpisode(id); paintDrawerCount(); });
on('download-done', (ep) => { cacheChapters(ep).catch(() => {}); });
on('downloads-removed', () => { if (route().view === 'descargas') renderDownloads(); });
on('folder-moved', () => paintSpace());
setInUseCheck((id) => !!(P.playing && P.playing.ep.id === id));
viewState.isPlaying = () => !!P.playing;
setPlayer({
  hasMedia: () => !!(P.playing && video.currentSrc),
  toMini: () => enterMini(),
  stop: () => stopPlayback(),
  show: (id) => renderWatch(id),
  refreshInfo: () => paintWatchInfo(),
  save: () => savePosition(true),
});
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

/* ───────────────────────── miniaturas ───────────────────────── */

/* ───────────────────────── capítulos fuera de la biblioteca ───────────────────────── */

/* ───────────────────────── progreso ───────────────────────── */

/** Lo que quedó viendo este perfil en otro dispositivo hace poco, si conviene ofrecer seguir aquí. */

/* ───────────────────────── descargas ───────────────────────── */

/* ───────────────────────── rutas y vistas ───────────────────────── */

/* ── botón flotante (reemplaza el menú lateral) ── */

/* ── entrar ── */

/* ── perfiles ── */

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

/* ───────────────────────── página de reproducción ───────────────────────── */

/* ───────────────────────── motor del reproductor ───────────────────────── */

/* ── mini reproductor ── */

/* ── controles ── */

/* ── menú del reproductor: velocidad ── */

/* ── capítulos e intros ── */

/* ── tema y luz ── */

/* ── cuota de MEGA ── */

/* ── eventos del video ── */

/* ───────────────────────── avisos ───────────────────────── */

/* ───────────────────────── eventos globales ───────────────────────── */

document.addEventListener('click', async (e) => {
  // cambiar de capítulo desde la página de reproducción sin llenar el historial
  const link = e.target.closest('a[href^="#/play/"]');
  if (link && route().view === 'play' && app.contains(link)) {
    e.preventDefault();
    const id = decodeURIComponent(link.getAttribute('href').slice('#/play/'.length));
    const ep = epById(id) || (resolveContext(id) || {}).ep;
    if (ep && (!P.playing || P.playing.ep.id !== id)) switchTo(ep);
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
  else if (act === 'mini-open' && P.playing) go('#/play/' + encodeURIComponent(P.playing.ep.id));
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
    const o = resumeOffer(!!P.playing);
    if (!o) { render(); return; }
    LS.set('nowSeen', o.n.u);
    const p = prog(o.ep);
    // se empieza justo donde quedó el otro dispositivo
    if (!p || Math.abs((p.t || 0) - o.n.t) > 5) setProgress(o.ep, o.n.t, o.n.d || (p && p.d) || 0, false);
    go('#/play/' + encodeURIComponent(o.ep.id));
  }
  else if (act === 'resume-dismiss') { const o = resumeOffer(!!P.playing); if (o) LS.set('nowSeen', o.n.u); render(); }
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
    toggleDock();
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

  else if (act === 'back') goBack(P.playing ? P.playing.ctx.back : '#/');
  else if (act === 'home') goHome();
  else if (act === 'dl' && ep) {
    if (state.dls[ep.id] || state.queue.some((q) => q.ep.id === ep.id)) removeDownload(ep.id);
    else if (state.saved.has(ep.id)) { if (confirm(`¿Quitar ${episodeLabel(ep)} del dispositivo?`)) removeDownload(ep.id); }
    else queueDownload(ep);
  } else if (act === 'more' && ep) openSheet(ep);
  else if (act === 'discover-open') openDiscoverSheet(Number(el.dataset.id));
  else if (act === 'w-more' && P.playing) openSheet(P.playing.ep);
  else if (act === 'w-dl' && P.playing) {
    const cur = P.playing.ep;
    if (state.saved.has(cur.id)) { if (confirm(`¿Quitar ${episodeLabel(cur)} del dispositivo?`)) removeDownload(cur.id); }
    else if (state.dls[cur.id] || state.queue.some((q) => q.ep.id === cur.id)) removeDownload(cur.id);
    else queueDownload(cur, P.playing.ctx.title);
  } else if (act === 'w-dl-next' && P.playing) {
    const ups = nextUnseen(P.playing.ep, P.playing.ctx.list, 3).filter((x) => !state.saved.has(x.id));
    ups.forEach((x) => queueDownload(x, P.playing.ctx.title));
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
      viewState.loginNote = m;
      renderLogin(m);
    } else {
      toast(m);
      render();
    }
  }
}

boot();
