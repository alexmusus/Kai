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

/* Gestos sobre el video.
 * Mouse: un clic pausa, doble clic pantalla completa.
 * Táctil: un toque muestra u oculta los controles; doble toque a la izquierda o derecha salta 10 s
 * (cada toque rápido extra suma otros 10 s); mantener presionado reproduce a 2× mientras no se suelte.
 * Deslizar: en la página, arriba = pantalla completa y abajo = mini reproductor; en pantalla completa,
 * abajo = salir. */
export const holdEl = $('#st-hold');
