/*
 * controllers/player/mini.js — El mini reproductor: el video sigue sonando mientras navegas por Kai; y volver
 * desde la ventana flotante del sistema.
 */

import { P } from './state.js';
import { stage, mini, video } from './dom.js';
import { $ } from '../../lib/util.js';
import { episodeLabel } from '../../models/collections.js';
import { ICON } from '../../views/icons.js';
import { route } from '../../lib/route.js';
import { go } from '../router.js';
import { setKaiFullscreen, isFullscreen, exitFullscreen, setLights, closeMenu } from './controls.js';
['play', 'pause', 'timeupdate', 'loadedmetadata'].forEach((ev) => video.addEventListener(ev, paintMini));

video.addEventListener('leavepictureinpicture', backFromSystemPip);

video.addEventListener('webkitpresentationmodechanged', () => {
  if (video.webkitPresentationMode === 'inline') backFromSystemPip();
});

export function enterMini() {
  if (!P.playing) return;
  if (stage.classList.contains('kai-fs')) setKaiFullscreen(false);
  else if (isFullscreen()) exitFullscreen();
  if (document.body.classList.contains('lights-off')) setLights(false);
  closeMenu();
  const slot = $('#mini-slot');
  if (stage.parentElement !== slot) slot.prepend(stage);
  stage.classList.add('is-mini');
  stage.hidden = false;
  mini.hidden = false;
  document.documentElement.classList.add('has-mini');
  paintMini();
}
export function leaveMini() {
  stage.classList.remove('is-mini');
  if (mini.hidden) return;
  mini.hidden = true;
  document.documentElement.classList.remove('has-mini');
}
export function paintMini() {
  if (mini.hidden || !P.playing) return;
  $('#mini-title').textContent = episodeLabel(P.playing.ep);
  $('#mini-sub').textContent = P.playing.ctx.title || '';
  const t = $('#mini-toggle');
  t.innerHTML = video.paused ? ICON.play : ICON.pause;
  t.setAttribute('aria-label', video.paused ? 'Reproducir' : 'Pausar');
  const d = isFinite(video.duration) ? video.duration : 0;
  mini.style.setProperty('--mp', d ? (video.currentTime / d) * 100 + '%' : '0%');
}

// al volver de la ventana flotante del sistema con el botón "volver a la pestaña", regresa al reproductor grande
export function backFromSystemPip() {
  setTimeout(() => {
    if (P.playing && !video.paused && route().view !== 'play') go('#/play/' + encodeURIComponent(P.playing.ep.id));
  }, 60);
}
