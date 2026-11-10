// @ts-check
/*
 * lib/motion.js — las animaciones de Kai: si van o no, y cuánto duran.
 *
 * Las duraciones y curvas son variables CSS de :root (styles.css, "--kai-…"): se leen en el momento de animar, así se
 * pueden ajustar en vivo sin recargar (document.documentElement.style.setProperty('--kai-fly-dur', '450ms'), o los
 * controles del registro de diagnóstico, lib/diag.js).
 */

const html = document.documentElement;
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');

/** ¿Sin animaciones? Lo pide el sistema ("reducir movimiento") o Ajustes → Animaciones (html.calm, views/theme.js). */
export const calmMotion = () => html.classList.contains('calm') || reduceMQ.matches;

/**
 * Una duración de las variables CSS, en milisegundos.
 * @param {string} name p. ej. "--kai-fly-dur"
 * @param {number} fallback si la variable no está o no se entiende
 */
export function motionMs(name, fallback) {
  const v = getComputedStyle(html).getPropertyValue(name).trim();
  const n = parseFloat(v);
  if (!v || !isFinite(n)) return fallback;
  return v.endsWith('ms') ? n : n * 1000;
}

/**
 * Una curva de las variables CSS.
 * @param {string} name p. ej. "--kai-fly-ease"
 * @param {string} fallback
 */
export function motionEase(name, fallback) {
  return getComputedStyle(html).getPropertyValue(name).trim() || fallback;
}
