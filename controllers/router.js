/*
 * controllers/router.js — qué página se dibuja según la dirección (#/serie/3, #/play/…), y el historial propio de
 * Kai: "volver" salta las entradas que son la misma página, y al volver la página queda donde estaba.
 *
 * El reproductor se registra con setPlayer: así el enrutador puede pasarlo al mini reproductor o detenerlo al cambiar
 * de página, sin depender de cómo está hecho.
 */

import { on } from '../lib/events.js';
import { route } from '../lib/route.js';
import { closeDrawer, paintDock } from './dock.js';
import { LS } from '../lib/util.js';
import { renderLogin, renderProfiles } from '../views/account.js';
import { viewState } from '../views/view-state.js';
import { state, visibleProfiles } from '../models/store.js';
import { endPicking } from './picking.js';
import { resolveContext } from '../models/context.js';
import { setTint, app } from '../views/components.js';
import { seriesColor } from '../models/fichas.js';
import { renderSeries, renderMovie } from '../views/series.js';
import { renderExplorer } from '../views/explorer.js';
import { renderCatalog } from '../views/catalog.js';
import { renderDownloads } from '../views/downloads.js';
import { renderSettings } from '../views/settings.js';
import { renderDiscover } from '../views/discover.js';
import { renderHome } from '../views/home.js';
import { paintSync } from '../views/dock.js';
import { hydrateThumbs } from '../views/thumbs.js';

/** Lo que el enrutador necesita del reproductor. */
const player = {
  /** ¿hay un video cargado? */ hasMedia: () => false,
  /** pasa al mini reproductor */ toMini: () => {},
  /** detiene y cierra el video */ stop: () => {},
  /** dibuja la página de reproducción de ese capítulo @param {string} id */ show: (id) => {},
  /** redibuja la información junto al video (sin tocar el video) */ refreshInfo: () => {},
  /** guarda dónde quedó el video ahora */ save: () => {},
};
/** El reproductor registrado (para quien necesite guardarlo o detenerlo, p. ej. al cambiar de perfil). */
export const playerHooks = player;
/** @param {Partial<typeof player>} api */
export function setPlayer(api) {
  Object.assign(player, api);
}

// las vistas piden navegar con un aviso (no conocen el enrutador)
on('navigate', ({ hash, replace }) => {
  if (replace) {
    navReplacing = true;
    location.replace(hash);
  } else go(hash);
});

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
addEventListener(
  'scroll',
  () => {
    scrollMemo.set(location.hash || '#/', window.scrollY);
  },
  { passive: true },
);
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
export function onHashChange() {
  const h = location.hash || '#/';
  navWasBack = !!navBackSteps || (navStack.length > 1 && navStack[navStack.length - 2] === h);
  if (navBackSteps) {
    navStack.length = Math.max(1, navStack.length - navBackSteps);
    navBackSteps = 0;
    navStack[navStack.length - 1] = h;
  } else if (navReplacing) {
    navStack[navStack.length - 1] = h;
    navReplacing = false;
  } else if (navStack.length > 1 && navStack[navStack.length - 2] === h)
    navStack.pop(); // botón atrás del navegador
  else if (navStack[navStack.length - 1] !== h) navStack.push(h);
}
export function go(hash) {
  if (location.hash !== hash) location.hash = hash;
  else render();
}
export function goHome() {
  if (navPage(location.hash) === '#/' || !location.hash) {
    render();
    return;
  }
  // si el inicio está en el historial, se vuelve a él; si no, se va directo
  const i = navStack.map(navPage).lastIndexOf('#/');
  if (i >= 0 && i < navStack.length - 1) {
    navBackSteps = navStack.length - 1 - i;
    history.go(-navBackSteps);
  } else go('#/');
}
export function goBack(fallback = '#/') {
  const cur = navPage(navStack[navStack.length - 1]);
  let i = navStack.length - 2;
  while (i >= 0 && navPage(navStack[i]) === cur) i--;
  if (i >= 0) {
    navBackSteps = navStack.length - 1 - i;
    history.go(-navBackSteps);
  } else {
    navReplacing = true;
    location.replace(fallback);
  }
}

let lastRouteKey = '';
/** El reproductor cambió de capítulo sin pasar por render (history.replaceState). @param {string} key */
export function setRouteKey(key) {
  lastRouteKey = key;
}

/** Vuelve a dibujar la vista actual sin tocar el reproductor. */
export function softRender() {
  if (route().view === 'play') {
    player.refreshInfo();
    return;
  }
  render();
}

export function render() {
  closeDrawer();
  if (!LS.get('session', null)) {
    player.stop();
    renderLogin(viewState.loginNote);
    return;
  }
  const { view, arg } = route();
  if (!state.profile || (!visibleProfiles().some((p) => p.id === state.profile.id) && state.sharedLoaded)) {
    if (state.profile && state.sharedLoaded) {
      state.profile = null;
      LS.del('profile');
    }
    if (!state.profile) {
      player.stop();
      renderProfiles();
      paintDock();
      lastRouteKey = 'perfiles';
      return;
    }
  }
  if (view === 'perfiles') {
    player.stop();
    renderProfiles();
    paintDock();
    lastRouteKey = 'perfiles';
    return;
  }
  if (viewState.picking && (view !== 'serie' || String(viewState.picking.si) !== arg.split('/')[0])) endPicking(false);
  if (view === 'play') {
    const c = resolveContext(arg);
    const si = c && c.si;
    setTint(si != null && state.library && state.library.series[si] ? seriesColor(state.library.series[si]) : null);
    player.show(arg);
  } else {
    if (player.hasMedia()) player.toMini();
    else player.stop();
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
  if (key !== lastRouteKey && view !== 'play')
    window.scrollTo(0, navWasBack ? scrollMemo.get(location.hash || '#/') || 0 : 0);
  navWasBack = false;
  if (key !== lastRouteKey && view === 'play' && lastRouteKey.split('/')[0] !== 'play') window.scrollTo(0, 0);
  lastRouteKey = key;
}
