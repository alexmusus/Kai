/*
 * controllers/player/dom.js — El escenario del video y sus controles en la página (se mueve entre la página de
 * reproducción y el mini reproductor).
 */

import { $ } from '../../lib/util.js';

export const stage = $('#stage');
export const parking = $('#stage-parking');
export const video = $('#video');

export const ui = {
  big: $('#st-big'),
  play: $('#st-play'),
  title: $('#st-title'),
  lights: $('#st-lights'),
  seek: $('#st-seek'),
  time: $('#st-time'),
  speed: $('#st-speed'),
  pip: $('#st-pip'),
  fs: $('#st-fs'),
  mute: $('#st-mute'),
  next: $('#st-next'),
  skip: $('#st-skip'),
  menu: $('#st-menu'),
  flash: $('#st-flash'),
  nextCard: $('#p-next'),
  msg: $('#p-msg'),
  tap: $('#st-tap'),
};

export const mini = $('#mini');

/**
 * Mueve un elemento a otro lugar de la página. Donde el navegador lo permite (moveBefore; Chrome, también en Android)
 * lo mueve sin desmontarlo: el video no pierde su superficie ni se vuelve a montar (en teléfonos de gama media, al
 * agrandar o achicar quedaba mal un momento y después se acomodaba). Donde no (Safari), se inserta como siempre.
 * @param {Element} parent @param {Element} el @param {Node | null} [before]
 */
export function moveInto(parent, el, before = null) {
  const p = /** @type {any} */ (parent);
  if (typeof p.moveBefore === 'function' && el.isConnected && parent.isConnected) {
    try {
      p.moveBefore(el, before);
      return;
    } catch {
      /* no se pudo mover así: se inserta como siempre */
    }
  }
  parent.insertBefore(el, before);
}

/* Gestos sobre el video.
 * Mouse: un clic pausa, doble clic pantalla completa.
 * Táctil: un toque muestra u oculta los controles; doble toque a la izquierda o derecha salta 10 s
 * (cada toque rápido extra suma otros 10 s); mantener presionado reproduce a 2× mientras no se suelte.
 * Deslizar: en la página, arriba = pantalla completa y abajo = mini reproductor; en pantalla completa,
 * abajo = salir. */
export const holdEl = $('#st-hold');
