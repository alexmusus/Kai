/*
 * views/theme.js — el tema (automático, claro u oscuro), sus tonos y el color de la barra del sistema.
 * Avisa "theme" al cambiar (el menú del botón flotante muestra el botón contrario).
 */

import { $ } from '../lib/util.js';
import { emit } from '../lib/events.js';
import { state, TONES, DARK_TONES, BLOCK_TONES, BLOCK_DARK } from '../models/store.js';
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
  meta.content = isFullscreen() ? '#000000' : toneOf(resolvedTheme()).bg;
}
/** El tono que se ve: el del estilo elegido (Vidrio o Bloques) para el tema claro u oscuro. */
function toneOf(t) {
  const s = state.settings;
  if (s.style === 'bloques')
    return t === 'dark'
      ? { id: BLOCK_DARK[s.blockDark] ? s.blockDark : 'grafito', ...(BLOCK_DARK[s.blockDark] || BLOCK_DARK.grafito) }
      : { id: BLOCK_TONES[s.blockTone] ? s.blockTone : 'piedra', ...(BLOCK_TONES[s.blockTone] || BLOCK_TONES.piedra) };
  return t === 'dark'
    ? { id: DARK_TONES[s.darkTone] ? s.darkTone : 'negro', ...(DARK_TONES[s.darkTone] || DARK_TONES.negro) }
    : { id: TONES[s.tone] ? s.tone : 'blanco', ...(TONES[s.tone] || TONES.blanco) };
}
/* Las letras del estilo Bloques se piden solo al elegirlo (el service worker las guarda para usarlas sin conexión). */
const BLOCK_FONTS =
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Space+Mono:wght@400;700&display=swap';
function loadBlockFonts() {
  if (document.querySelector('link[data-kai-fonts]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = BLOCK_FONTS;
  l.dataset.kaiFonts = '';
  document.head.append(l);
}
export function applyTheme() {
  const t = resolvedTheme();
  const d = document.documentElement;
  const blocks = state.settings.style === 'bloques';
  const tone = toneOf(t).id;
  d.dataset.theme = t;
  if (blocks) d.dataset.style = 'bloques';
  else delete d.dataset.style;
  // el tono va en data-tone (claro) o data-dark (oscuro); los de siempre (Blanco y Negro) no llevan nada
  if (t === 'light' && (blocks || tone !== 'blanco')) d.dataset.tone = tone;
  else delete d.dataset.tone;
  if (t === 'dark' && (blocks || tone !== 'negro')) d.dataset.dark = tone;
  else delete d.dataset.dark;
  if (blocks) loadBlockFonts();
  applyMotion();
  paintThemeColor();
  emit('theme');
  document.querySelectorAll('[data-act="theme"]:not(.dock-item)').forEach((b) => {
    b.innerHTML = t === 'dark' ? ICON.sun : ICON.moon;
    b.setAttribute('aria-label', `Cambiar a tema ${t === 'dark' ? 'claro' : 'oscuro'}`);
  });
}
darkMQ.addEventListener('change', applyTheme);
