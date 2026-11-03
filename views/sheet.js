// @ts-check
/*
 * views/sheet.js — la hoja que sube desde abajo (opciones de un capítulo, ficha de una recomendación) y la
 * confirmación antes de quitar algo. Kai no usa confirm() del navegador: en iPhone a veces no aparece.
 */

import { $, esc } from '../lib/util.js';

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

/**
 * Pregunta antes de quitar o cerrar algo. Resuelve true solo si se toca el botón de aceptar;
 * tocar fuera, «Cancelar» o Escape es que no.
 * @param {string} title la pregunta
 * @param {{ detail?: string, ok?: string }} [opts] una aclaración y el texto del botón de aceptar
 * @returns {Promise<boolean>}
 */
export function askConfirm(title, { detail = '', ok = 'Aceptar' } = {}) {
  return new Promise((resolve) => {
    const answer = (yes) => {
      document.removeEventListener('keydown', onKey);
      closeSheet();
      resolve(yes);
    };
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') answer(false);
    };
    const sheet = showSheet(
      `<div class="sheet-back" data-act="close"></div>
    <div class="sheet-panel" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
      <p class="sheet-title">${esc(title)}</p>
      ${detail ? `<p class="sheet-sub">${esc(detail)}</p>` : ''}
      <button class="sheet-btn is-danger" data-act="confirm-ok">${esc(ok)}</button>
      <button class="sheet-btn is-quiet" data-act="close">Cancelar</button>
    </div>`,
      (e) => {
        const el = /** @type {HTMLElement} */ (e.target).closest('[data-act]');
        if (el instanceof HTMLElement) answer(el.dataset.act === 'confirm-ok');
      },
    );
    document.addEventListener('keydown', onKey);
    /** @type {HTMLElement} */ (sheet.querySelector('.is-quiet')).focus();
  });
}
