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
const lowMemory = !!nav.deviceMemory && nav.deviceMemory <= 4;
/* La memoria no lo dice todo (un Moto G85 trae 8 GB y aun así se traba con las animaciones), así que las dos cosas
 * también se eligen a mano en Ajustes → Apariencia:
 *  - Modo liviano (html.lite): sin desenfoques. Automático = solo con poca memoria.
 *  - Animaciones (html.calm): sin vuelos ni fundidos. Automático = sin ellas en modo liviano; "Completas" las deja
 *    aunque esté el modo liviano; "Reducidas" las quita siempre. */
export function applyMotion() {
  const s = state.settings;
  const lite = s.lite === 'on' || (s.lite !== 'off' && lowMemory);
  const calm = s.motion === 'reduced' || (s.motion !== 'full' && lite);
  document.documentElement.classList.toggle('lite', lite);
  document.documentElement.classList.toggle('calm', calm);
}
applyMotion();

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
  applyMotion();
  paintThemeColor();
  emit('theme');
  document.querySelectorAll('[data-act="theme"]:not(.dock-item)').forEach((b) => {
    b.innerHTML = t === 'dark' ? ICON.sun : ICON.moon;
    b.setAttribute('aria-label', `Cambiar a tema ${t === 'dark' ? 'claro' : 'oscuro'}`);
  });
}
darkMQ.addEventListener('change', applyTheme);
