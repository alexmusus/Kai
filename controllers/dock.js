/*
 * controllers/dock.js — el botón flotante (reemplaza el menú lateral): el menú con el perfil y las páginas, la flecha
 * para ir arriba en pantallas táctiles, y que tocar fuera con el menú abierto solo lo cierre.
 */
import { $, LS, esc } from '../lib/util.js';
import { route } from '../lib/route.js';
import { state, visibleProfiles } from '../models/store.js';
import { avatarHTML } from '../views/account.js';
import { ICON } from '../views/icons.js';
import { paintSync, paintNewsDot } from '../views/dock.js';
import { resolvedTheme } from '../views/theme.js';
import { on } from '../lib/events.js';

export const dock = $('#dock');

let dockHtml = '';
export function paintDock() {
  const v = route().view;
  const show = !!(LS.get('session', null) && state.profile && v !== 'perfiles');
  dock.hidden = !show;
  if (!show) {
    closeDock();
    return;
  }
  const p = visibleProfiles().find((x) => x.id === state.profile.id) || state.profile;
  const btn = dock.querySelector('.dock-btn');
  // se llama en cada cambio de página: solo se rehace si cambió el perfil (rehacerlo igual lo hacía parpadear)
  const html = `${avatarHTML(p, 'dock-avatar')}<span class="dock-ring" aria-hidden="true"></span><span class="dock-state" aria-hidden="true"></span>`;
  if (dockHtml !== html) {
    btn.innerHTML = html;
    dockHtml = html;
  }
  btn.dataset.name = p.name;
  paintTabs(v);
  // al cambiar de página la barra vuelve a su tamaño (y el scroll de volver a donde estabas no la achica)
  setCompact(false);
  setDeep(false);
  compactHold = performance.now() + 500;
  paintSync();
  paintNewsDot();
  if (!dock.querySelector('.dock-panel').hidden) fillDock();
}

/* ── la barra se achica al bajar ──
 * En el teléfono, al bajar queda solo la casita (con el punto de sincronización), y se queda así
 * hasta que la tocas: ese toque solo la agranda (no navega; en el inicio, además sube). Lejos del principio, fuera
 * del inicio, al lado aparece una burbuja con una flecha para subir. */
const COMPACT_ON = matchMedia('(max-width: 899px)');
let compactY = window.scrollY;
let compactFrame = 0;
let compactHold = 0;
/** @param {boolean} on */
function setCompact(on) {
  if (dock.classList.contains('is-compact') !== on) dock.classList.toggle('is-compact', on);
}
/** @param {boolean} on */
function setDeep(on) {
  if (dock.classList.contains('is-deep') !== on) dock.classList.toggle('is-deep', on);
}
function checkCompact() {
  compactFrame = 0;
  const y = window.scrollY;
  setDeep(y > 600 && route().view !== 'home'); // en el inicio sube la casita: no hace falta la burbuja
  const dy = y - compactY;
  if (Math.abs(dy) < 8) return; // movimientos mínimos no cuentan
  compactY = y;
  if (performance.now() < compactHold) return;
  if (!COMPACT_ON.matches || dock.classList.contains('is-open')) return setCompact(false);
  // solo se achica: volver a agrandarse es al tocarla (el rebote al llegar al final ya no la agranda)
  if (dy > 0 && y > 140) setCompact(true);
}
/** La burbuja de subir: sube y la barra vuelve a su tamaño. */
export function dockUp() {
  setCompact(false);
  setDeep(false);
  compactHold = performance.now() + 1500; // mientras sube sola, no se achica ni vuelve la burbuja
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
addEventListener(
  'scroll',
  () => {
    if (!compactFrame) compactFrame = requestAnimationFrame(checkCompact);
  },
  { passive: true },
);
dock.addEventListener(
  'click',
  (e) => {
    if (!dock.classList.contains('is-compact')) return;
    if (!(/** @type {Element} */ (e.target).closest('.dock-bar'))) return;
    e.preventDefault();
    e.stopPropagation();
    // en el inicio, la casita achicada sube de una vez (ahí no está la burbuja); en otra página solo la agranda
    if (route().view === 'home') return dockUp();
    setCompact(false);
    compactHold = performance.now() + 1200; // que el siguiente movimiento no la vuelva a achicar enseguida
  },
  true,
);

/* ── pestañas de la barra ── */
const TABS = [
  { id: 'home', label: 'Inicio', icon: 'home', act: 'home' },
  { id: 'catalogo', label: 'Catálogo', icon: 'grid', href: '#/catalogo' },
  { id: 'descargas', label: 'Descargas', icon: 'down', href: '#/descargas' },
  { id: 'ajustes', label: 'Ajustes', icon: 'gear', href: '#/ajustes' },
];
/** De qué pestaña es cada página (la serie, la película y el reproductor siguen siendo "Inicio"). */
const TAB_OF = {
  home: 'home',
  serie: 'home',
  pelicula: 'home',
  play: 'home',
  descubrir: 'home',
  catalogo: 'catalogo',
  descargas: 'descargas',
  ajustes: 'ajustes',
};
/** @param {string} view */
function paintTabs(view) {
  const box = dock.querySelector('.dock-tabs');
  if (!box) return;
  if (!box.firstElementChild) {
    box.innerHTML = TABS.map(
      (t) =>
        `${t.href ? `<a href="${t.href}"` : `<button data-act="${t.act}"`} class="dock-tab" data-tab="${t.id}">${ICON[t.icon]}<span>${t.label}</span>${t.id === 'descargas' ? '<b class="dock-badge" id="dock-count"></b>' : ''}${t.href ? '</a>' : '</button>'}`,
    ).join('');
  }
  const on = TAB_OF[view] || '';
  for (const el of box.children) {
    const is = /** @type {HTMLElement} */ (el).dataset.tab === on;
    el.classList.toggle('is-on', is);
    if (is) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  }
  const count = $('#dock-count');
  if (count) count.textContent = state.saved.size ? String(state.saved.size) : '';
}

export function fillDock() {
  const p = visibleProfiles().find((x) => x.id === state.profile.id) || state.profile;
  const dark = resolvedTheme() === 'dark';
  // solo lo de tu perfil: cambiar de perfil, actualizar y el tema (Explorar MEGA y la transferencia están en
  // Ajustes, y Descubrir al final del inicio)
  dock.querySelector('.dock-panel').innerHTML = `
    <a class="dock-profile" href="#/perfiles" role="menuitem">${avatarHTML(p)}<span><span class="dock-pname">${esc(p.name)}</span><span class="dock-psub">Cambiar perfil</span></span></a>
    <button class="dock-item" data-act="refresh" role="menuitem">${ICON.refresh}<span>Actualizar</span></button>
    <button class="dock-item" data-act="theme" role="menuitem">${dark ? ICON.sun : ICON.moon}<span>${dark ? 'Tema claro' : 'Tema oscuro'}</span></button>`;
}

// al cambiar el tema desde el menú, su botón pasa a ofrecer el otro
on('theme', () => {
  if (!dock.querySelector('.dock-panel').hidden) fillDock();
});

export function openDock() {
  fillDock();
  const panel = dock.querySelector('.dock-panel');
  panel.hidden = false;
  dock.classList.add('is-open');
  dock.querySelector('.dock-btn').setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => panel.classList.add('is-in'));
  const first = panel.querySelector('.dock-profile');
  if (first) first.focus({ preventScroll: true });
}
export function closeDock() {
  const panel = dock.querySelector('.dock-panel');
  if (!panel || panel.hidden) return;
  panel.classList.remove('is-in');
  dock.classList.remove('is-open');
  dock.querySelector('.dock-btn').setAttribute('aria-expanded', 'false');
  setTimeout(() => {
    if (!panel.classList.contains('is-in')) panel.hidden = true;
  }, 180);
}
/** Tocar tu perfil abre o cierra el menú. */
export function toggleDock() {
  if (dock.classList.contains('is-open')) closeDock();
  else openDock();
}

// Con el menú abierto, tocar fuera solo lo cierra: ese toque no abre un capítulo, ni reproduce, ni sigue un enlace.
let dockSwallow = 0; // hasta cuándo se ignora el clic de ese toque
document.addEventListener(
  'pointerdown',
  (e) => {
    if (!dock.classList.contains('is-open')) {
      dockSwallow = 0;
      return;
    } // un toque nuevo con el menú cerrado nunca se ignora
    if (dock.contains(e.target)) return;
    closeDock();
    e.stopPropagation(); // que no llegue a los gestos del reproductor
    dockSwallow = Date.now() + 800;
  },
  true,
);
document.addEventListener(
  'click',
  (e) => {
    if (Date.now() > dockSwallow || dock.contains(e.target)) return;
    dockSwallow = 0;
    e.preventDefault();
    e.stopPropagation();
  },
  true,
);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dock.classList.contains('is-open')) {
    closeDock();
    dock.querySelector('.dock-btn').focus();
  }
});
