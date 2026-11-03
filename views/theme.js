/*
 * views/theme.js — el tema (automático, claro u oscuro), sus tonos y el color de la barra del sistema.
 * Avisa "theme" al cambiar (el menú del botón flotante muestra el botón contrario).
 */

import { $ } from '../lib/util.js';
import { emit } from '../lib/events.js';
import { state, TONES, DARK_TONES } from '../models/store.js';
import { ICON } from './icons.js';

/** ¿Hay un video en pantalla completa? (también la "pantalla completa" propia de Kai en iPhone) */
const isFullscreen = () =>
  !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    ($('#stage') && $('#stage').classList.contains('kai-fs'))
  );

/* Teléfonos de gama media (4 GB de memoria o menos; solo Chrome y Android lo dicen): sin desenfoques ni fondo en
 * movimiento. Se ve casi igual y la tarjeta gráfica no tiene que recalcular el vidrio en cada animación. */
const nav = /** @type {Navigator & { deviceMemory?: number }} */ (navigator);
if (nav.deviceMemory && nav.deviceMemory <= 4) document.documentElement.classList.add('lite');

const darkMQ = matchMedia('(prefers-color-scheme: dark)');
export function resolvedTheme() {
  const t = state.settings.theme;
  return t === 'light' || t === 'dark' ? t : darkMQ.matches ? 'dark' : 'light';
}
/* color de la barra del sistema; en pantalla completa negro, porque en Android ese color también pinta
 * el hueco de la cámara (en tema claro salía una franja blanca) */
export function paintThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  meta.content = isFullscreen()
    ? '#000000'
    : resolvedTheme() === 'dark'
      ? (DARK_TONES[state.settings.darkTone] || DARK_TONES.negro).bg
      : (TONES[state.settings.tone] || TONES.blanco).bg;
}
export function applyTheme() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  const tone = state.settings.tone;
  if (t === 'light' && tone && tone !== 'blanco' && TONES[tone]) document.documentElement.dataset.tone = tone;
  else delete document.documentElement.dataset.tone;
  if (t === 'dark' && state.settings.darkTone === 'gris') document.documentElement.dataset.dark = 'gris';
  else delete document.documentElement.dataset.dark;
  paintThemeColor();
  emit('theme');
  document.querySelectorAll('[data-act="theme"]:not(.dock-item)').forEach((b) => {
    b.innerHTML = t === 'dark' ? ICON.sun : ICON.moon;
    b.setAttribute('aria-label', `Cambiar a tema ${t === 'dark' ? 'claro' : 'oscuro'}`);
  });
}
darkMQ.addEventListener('change', applyTheme);
