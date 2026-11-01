// @ts-check
/*
 * views/sheet.js — la hoja que sube desde abajo (opciones de un capítulo, ficha de una recomendación).
 */

import { $ } from '../lib/util.js';

/**
 * Muestra la hoja con ese contenido. `onClick` recibe cada toque dentro de la hoja.
 * @param {string} html
 * @param {(e: MouseEvent) => void} onClick
 */
export function showSheet(html, onClick) {
  const sheet = $('#sheet');
  sheet.innerHTML = html;
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('is-open'));
  sheet.onclick = onClick;
  return sheet;
}

/** Cierra la hoja (con su animación). */
export function closeSheet() {
  const sheet = $('#sheet');
  if (sheet.hidden) return;
  sheet.classList.remove('is-open');
  setTimeout(() => {
    sheet.hidden = true;
    sheet.innerHTML = '';
  }, 180);
}
