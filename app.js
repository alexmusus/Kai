/*
 * Punto de entrada de Kai: conecta los modelos con las vistas (eventos), registra los controladores y arranca.
 * La lógica vive en models/, la pantalla en views/ y la respuesta a lo que hace el usuario en controllers/.
 * Ver docs/arquitectura.md.
 */
import { LS } from './lib/util.js';
import { on } from './lib/events.js';
import { route } from './lib/route.js';
import { state, setIndex } from './models/store.js';
import { megaMessage, connect } from './models/mega.js';
import { loadProfileState, buildIndex } from './models/library.js';
import { setInUseCheck, refreshSaved, resumePendingDownloads, getDir, flushFolder } from './models/downloads.js';
import { refreshAccountInfo } from './models/quota.js';
import { ensureMeta } from './models/fichas-sync.js';
import { cacheChapters } from './models/media.js';
import { viewState } from './views/view-state.js';
import { renderLogin } from './views/account.js';
import { toast } from './views/toast.js';
import { applyTheme } from './views/theme.js';
import { paintQuota } from './views/quota.js';
import { paintDrawerCount, paintNewsDot } from './views/dock.js';
import { paintEpisode } from './views/episodes.js';
import { renderDownloads } from './views/downloads.js';
import { paintSpace } from './views/settings.js';
import './views/images.js';
import { setPlayer, render, softRender } from './controllers/router.js';
import { dock, fillDock } from './controllers/dock.js';
import { sync, refreshLibrary } from './controllers/sync.js';
import { initActions } from './controllers/actions.js';
import { initHomeNav } from './controllers/home.js';
import { initLifecycle } from './controllers/lifecycle.js';
import { initUpdates } from './controllers/updates.js';
import { P } from './controllers/player/state.js';
import { video, stage } from './controllers/player/dom.js';
import { enterMini } from './controllers/player/mini.js';
import { savePosition, stopPlayback } from './controllers/player/engine.js';
import { renderWatch, paintWatchInfo } from './controllers/player/page.js';
// los gestos y los eventos del video se registran al cargarse
import './controllers/player/gestures.js';
import './controllers/player/events.js';

/* ── de los modelos a la pantalla ── */

on('quota', paintQuota);
on('theme', () => {
  if (dock.classList.contains('is-open')) fillDock();
});
on('notice', (text) => toast(text));
on('news', () => paintNewsDot());
on('download-changed', (id) => {
  paintEpisode(id);
  paintDrawerCount();
});
on('download-done', (ep) => {
  cacheChapters(ep).catch(() => {});
});
on('downloads-removed', () => {
  if (route().view === 'descargas') renderDownloads();
});
on('folder-moved', () => paintSpace());
on('tree-changed', () => refreshLibrary());
on('meta-changed', (views) => {
  if (views.includes(route().view)) softRender();
});
on('sync-needed', () => sync());

/* ── el reproductor, para quien lo necesita sin depender de él ── */

setInUseCheck((id) => !!(P.playing && P.playing.ep.id === id));
viewState.isPlaying = () => !!P.playing;
setPlayer({
  hasMedia: () => !!(P.playing && video.currentSrc),
  toMini: (opts) => enterMini(opts),
  rect: () => (stage.parentElement && stage.parentElement.id === 'stage-slot' ? stage.getBoundingClientRect() : null),
  stop: () => stopPlayback(),
  show: (id) => renderWatch(id),
  refreshInfo: () => paintWatchInfo(),
  save: () => savePosition(true),
});

/* ── lo guardado en este dispositivo y los controladores ── */

setIndex(buildIndex(state.library));
loadProfileState();
initActions();
initHomeNav();
initLifecycle();

/* ── arranque ── */

/** Samsung Internet oscurece las páginas a su manera y Kai no lo puede evitar desde aquí: se avisa una vez. */
function samsungHint() {
  if (!/SamsungBrowser/.test(navigator.userAgent) || LS.get('samsungHint', false)) return;
  LS.set('samsungHint', true);
  setTimeout(
    () => toast('Si Kai se ve con colores raros aquí, desactiva el modo oscuro de Samsung Internet o usa Chrome.'),
    2500,
  );
}

async function boot() {
  applyTheme();
  paintQuota();
  initUpdates();
  await refreshSaved().catch(() => {});
  render();
  samsungHint();
  getDir()
    .then((d) => d && flushFolder()) // si la carpeta ya tiene permiso, termina lo pendiente
    .catch(() => {});
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
