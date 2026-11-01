// @ts-check
/*
 * views/toast.js — los avisos cortos que aparecen abajo unos segundos.
 */

import { $ } from '../lib/util.js';

/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;
let toastSeq = 0;

/** Muestra un aviso (reemplaza al anterior). @param {string} text */
export function toast(text) {
  toastSeq++;
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 3800);
}

/** Cuántos avisos se mostraron (para saber si otro aviso salió mientras tanto). */
export const toastCount = () => toastSeq;
