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
import { hasUnreadNews } from '../models/news.js';
import { quotaText } from '../views/quota.js';

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
  const html = `${avatarHTML(p, 'dock-avatar')}<span class="dock-top" aria-hidden="true">${ICON.top}</span><span class="dock-ring" aria-hidden="true"></span><span class="dock-state" aria-hidden="true"></span>`;
  if (dockHtml !== html) {
    btn.innerHTML = html;
    dockHtml = html;
  }
  btn.dataset.name = p.name;
  paintSync();
  paintNewsDot();
  if (!dock.querySelector('.dock-panel').hidden) fillDock();
}

export function fillDock() {
  const { view } = route();
  const p = visibleProfiles().find((x) => x.id === state.profile.id) || state.profile;
  const item = (href, icon, label, on, extra = '') =>
    `<a class="dock-item ${on ? 'is-on' : ''}" href="${href}" role="menuitem">${icon}<span>${label}</span>${extra}</a>`;
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

export function openDock() {
  fillDock();
  const panel = dock.querySelector('.dock-panel');
  panel.hidden = false;
  dock.classList.add('is-open');
  dock.querySelector('.dock-btn').setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => panel.classList.add('is-in'));
  const first = panel.querySelector('.dock-item.is-on') || panel.querySelector('.dock-item');
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
/* Ir arriba: en pantallas táctiles, el botón flotante se vuelve una flecha cuando bajaste más de dos pantallas
 * y empiezas a subir. Vuelve a ser el de siempre al llegar arriba, al seguir bajando o tras unos segundos quieto.
 * (UP_ON_IOS: en iPhone/iPad ya se sube tocando la hora; se deja encendido mientras Alex lo prueba.) */
const UP_ON_IOS = true;
const IS_IOS =
  /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const UP_ENABLED = matchMedia('(pointer: coarse)').matches && (UP_ON_IOS || !IS_IOS);
let upLastY = 0,
  upIdle = 0,
  upFrame = 0,
  upHoldUntil = 0; // upHoldUntil: mientras sube solo, no volver a mostrar la flecha
export function setDockUp(on) {
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
  if (!ok || y < 80 || dy > 0 || Date.now() < upHoldUntil) {
    setDockUp(false);
    return;
  }
  if (y > window.innerHeight * 2) {
    setDockUp(true);
    upIdle = setTimeout(() => setDockUp(false), 3000);
  }
}
if (UP_ENABLED) {
  addEventListener(
    'scroll',
    () => {
      if (!upFrame) upFrame = requestAnimationFrame(checkDockUp);
    },
    { passive: true },
  );
}

/** Tocar el botón: si es la flecha, sube; si no, abre o cierra el menú. */
export function toggleDock() {
  if (dock.classList.contains('is-up')) {
    setDockUp(false);
    upHoldUntil = Date.now() + 1500; // mientras sube solo, no volver a mostrar la flecha
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  if (dock.classList.contains('is-open')) closeDock();
  else openDock();
}

// nombre antiguo que aún usan otras partes
export const closeDrawer = closeDock;
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
