/*
 * controllers/router.js — qué página se dibuja según la dirección (#/serie/3, #/play/…), y el historial propio de
 * Kai: "volver" salta las entradas que son la misma página, y al volver la página queda donde estaba.
 *
 * El reproductor se registra con setPlayer: así el enrutador puede pasarlo al mini reproductor o detenerlo al cambiar
 * de página, sin depender de cómo está hecho.
 */

import { on } from '../lib/events.js';
import { route } from '../lib/route.js';
import { closeDock, paintDock } from './dock.js';
import { LS } from '../lib/util.js';
import { createNavHistory } from '../lib/nav-history.js';
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
const KEY = 'kaiPos'; // la posición de cada entrada, guardada en history.state
const markedPos = () => {
  const s = history.state;
  return s && typeof s[KEY] === 'number' ? s[KEY] : null;
};
const mark = (pos) => {
  if (markedPos() !== pos) history.replaceState({ ...(history.state || {}), [KEY]: pos }, '');
};
/* La app instalada abre en "kai.musus.dev/" (sin #): era la única entrada del historial sin #, y al volver a ella
 * deslizando, Safari no tenía su foto y mostraba la pantalla en negro hasta dibujar el inicio. Con "#/" queda igual
 * que todas las demás. */
if (!location.hash) history.replaceState(history.state, '', '#/');
const nav = createNavHistory(location.hash || '#/', markedPos() ?? 0);
mark(nav.pos);
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
/* Volver la deja el navegador ('auto') y Kai repite lo mismo por si no llegó. Con 'manual' (hasta la entrega 14),
 * Safari quitaba la foto del deslizar antes de dibujar la página en su lugar, y al volver al inicio desde abajo se
 * veía la pantalla en blanco o negro un momento. */
if ('scrollRestoration' in history) history.scrollRestoration = 'auto';
export function onHashChange() {
  const r = nav.arrive(location.hash || '#/', markedPos(), navReplacing);
  navReplacing = false;
  navWasBack = r.back;
  mark(r.pos);
}
/** ¿Kai ya está en esta entrada del historial (la misma posición y dirección)? Así un cambio que avisan
 * 'popstate' y 'hashchange' a la vez se atiende una sola vez. */
export function alreadyArrived() {
  return markedPos() === nav.pos && nav.current === (location.hash || '#/');
}
export function go(hash) {
  if (location.hash !== hash) location.hash = hash;
  else render();
}
export function goHome() {
  // ya en el inicio: Inicio lleva arriba (como en las apps de Apple)
  if (navPage(location.hash) === '#/' || !location.hash) {
    if (window.scrollY > 0)
      window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    else render();
    return;
  }
  // si el inicio está en el historial, se vuelve a él; si no, se va directo
  const steps = nav.stepsBackTo((h) => navPage(h) === '#/');
  if (steps) history.go(steps);
  else go('#/');
}
export function goBack(fallback = '#/') {
  const cur = navPage(nav.current);
  const steps = nav.stepsBackTo((h) => navPage(h) !== cur);
  if (steps) history.go(steps);
  else {
    navReplacing = true;
    location.replace(fallback);
  }
}

/* ── páginas que se reusan ──
 * Dibujar una página crea de cero sus tarjetas, imágenes y etiquetas, y el iPhone tiene que pintarlas otra vez: al
 * volver atrás, o cuando una sincronización en segundo plano vuelve a dibujar la misma página, algunas (la etiqueta
 * SUB, un póster, una fila entera) alcanzaban a parpadear. Por eso, después de dibujar, cada parte que salió idéntica
 * a la que había antes en esa dirección se cambia por la de antes, ya pintada; lo nuevo se descarta antes de verse.
 * Se compara parte por parte (la portada que cambió se dibuja nueva, las filas de pósters que no cambiaron se reusan)
 * con el HTML tal como lo dibujó la vista, así que cualquier cambio de datos dibuja de nuevo esa parte. */
const REUSABLE = new Set(['home', 'serie', 'pelicula', 'catalogo']);
const KEPT_MAX = 6;
const DEPTH = 6; // hasta qué profundidad se compara (más adentro, la parte se reusa entera o no)
/* Cada parte guarda una copia de cómo la dibujó la vista (después se le agregan miniaturas, clases de las imágenes…,
 * así que no se puede comparar contra ella misma). Comparar con isEqualNode es del navegador y se detiene en la
 * primera diferencia: mucho más barato que convertir la página a texto. */
/** @type {WeakMap<Element, Element>} */
const drawn = new WeakMap();
// las copias viven en un documento aparte: ahí las imágenes no se piden ni se decodifican
const inert = document.implementation.createHTMLDocument('');
/** @type {{ hash: string, nodes: ChildNode[] } | null} la página que está en pantalla */
let shown = null;
/** @type {Map<string, { hash: string, nodes: ChildNode[] }>} páginas dejadas hace poco */
const kept = new Map();

/** Guarda la copia de cada parte recién dibujada. @param {Element[]} els @param {Element[]} copies @param {number} depth */
function noteDrawn(els, copies, depth) {
  els.forEach((el, i) => {
    drawn.set(el, copies[i]);
    if (depth < DEPTH && el.childElementCount) noteDrawn([...el.children], [...copies[i].children], depth + 1);
  });
}
/** Cambia las partes nuevas que son iguales a las de antes por las de antes. */
function reuseParts(/** @type {Element[]} */ fresh, /** @type {Element[]} */ old, depth = 1) {
  if (fresh.length !== old.length) return;
  fresh.forEach((el, i) => {
    const prev = old[i];
    const was = drawn.get(prev);
    if (!was || el.tagName !== prev.tagName) return;
    if (el.isEqualNode(was)) {
      el.replaceWith(prev);
      return;
    }
    if (depth < DEPTH) reuseParts([...el.children], [...prev.children], depth + 1);
  });
}
/** @param {string} view @param {ChildNode[]} before lo que había en pantalla antes de dibujar */
function reuseIfSame(view, before) {
  // si otra pantalla (perfiles, reproductor, entrar) reemplazó lo de la página, ya no hay nada que guardar
  if (shown && !(before.length && before[0] === shown.nodes[0])) shown = null;
  if (shown) {
    // lo que se deja (con lo que se le agregó después: miniaturas, etiquetas de códec) queda guardado
    shown.nodes = before;
    kept.delete(shown.hash);
    kept.set(shown.hash, shown);
    if (kept.size > KEPT_MAX) kept.delete(/** @type {string} */ (kept.keys().next().value));
  }
  shown = null;
  if (!REUSABLE.has(view) || viewState.picking) return;
  const hash = location.hash || '#/';
  const fresh = [...app.children];
  noteDrawn(fresh, /** @type {Element[]} */ ([.../** @type {Element} */ (inert.importNode(app, true)).children]), 1);
  const old = kept.get(hash);
  if (old) {
    kept.delete(hash);
    const focused = document.activeElement;
    reuseParts(fresh, /** @type {Element[]} */ (old.nodes.filter((x) => x.nodeType === 1)));
    // si la vista enfocó algo (el buscador) y quedó la parte de antes, se enfoca el de antes
    if (focused && focused.id && !focused.isConnected)
      /** @type {HTMLElement | null} */ (app.querySelector('#' + CSS.escape(focused.id)))?.focus();
  }
  shown = { hash, nodes: [...app.childNodes] };
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

/** La página que llega después de leavePage aparece suave (si llegaba de golpe, su portada "saltaba" a la vista
 * mientras el video todavía volaba al mini). */
function arrive() {
  if (document.documentElement.classList.contains('lite') || matchMedia('(prefers-reduced-motion: reduce)').matches)
    return;
  if (!app.animate) return;
  // aparece y se acomoda desde un poco más chica (medida desde el centro de la pantalla, no desde arriba de la página)
  app.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: 40, easing: 'ease-out', fill: 'backwards' });
  for (const el of app.children) {
    const origin = `50% ${Math.round(innerHeight / 2 - el.getBoundingClientRect().top)}px`;
    el.animate(
      [
        { transform: 'scale(0.965)', transformOrigin: origin },
        { transform: 'none', transformOrigin: origin },
      ],
      { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }
}
/** La página actual se desvanece mientras llega la siguiente (al pasar al mini deslizando). */
export function leavePage() {
  app.classList.add('is-leaving');
  // por si la siguiente no llega a dibujarse
  setTimeout(() => {
    app.classList.remove('is-leaving', 'is-pulling');
    app.style.removeProperty('--pull');
  }, 800);
}

export function render() {
  const arriving = app.classList.contains('is-leaving');
  app.classList.remove('is-leaving', 'is-pulling');
  app.style.removeProperty('--pull');
  closeDock();
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
    const before = [...app.childNodes];
    if (view === 'serie') renderSeries(arg);
    else if (view === 'pelicula') renderMovie(arg);
    else if (view === 'explorar') renderExplorer(arg);
    else if (view === 'catalogo') renderCatalog();
    else if (view === 'descargas') renderDownloads();
    else if (view === 'ajustes') renderSettings();
    else if (view === 'descubrir') renderDiscover(arg);
    else renderHome();
    reuseIfSame(view, before);
  }
  if (view === 'play') shown = null;
  paintSync();
  paintDock();
  hydrateThumbs(app);
  const key = view + '/' + arg;
  if (key !== lastRouteKey && view !== 'play')
    window.scrollTo(0, navWasBack ? scrollMemo.get(location.hash || '#/') || 0 : 0);
  navWasBack = false;
  if (key !== lastRouteKey && view === 'play' && lastRouteKey.split('/')[0] !== 'play') window.scrollTo(0, 0);
  lastRouteKey = key;
  if (arriving && view !== 'play') arrive();
}
