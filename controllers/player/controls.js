/*
 * controllers/player/controls.js — Los controles: dibujarlos, mostrarlos al moverse, reproducir y pausar, ± segundos,
 * pantalla completa (también la propia de Kai en iPhone), ventana flotante, velocidad y luz apagada.
 */

import { profilePrefs } from '../../models/profiles.js';
import { video, ui, stage, holdEl } from './dom.js';
import { ICON } from '../../views/icons.js';
import { P } from './state.js';
import { fmtTime, $, esc } from '../../lib/util.js';
import { paintThemeColor } from '../../views/theme.js';
import { toast } from '../../views/toast.js';
import { neighbor } from './engine.js';
import { paintSkip } from './chapters.js';
import { episodeLabel } from '../../models/collections.js';

// se llama varias veces por segundo: solo toca el DOM cuando algo cambió
export const painted = {};
export function setOnce(key, value, apply) {
  if (painted[key] === value) return;
  painted[key] = value;
  apply(value);
}
export function paintControls() {
  const paused = video.paused;
  setOnce('play', paused, (v) => {
    ui.play.innerHTML = v ? ICON.play : ICON.pause;
    ui.play.setAttribute('aria-label', v ? 'Reproducir' : 'Pausar');
    stage.classList.toggle('is-paused', v);
    // el botón grande del centro también: sale al tocar el video, con play o pausa según toque
    ui.big.innerHTML = v ? ICON.play : ICON.pause;
    ui.big.setAttribute('aria-label', v ? 'Reproducir' : 'Pausar');
    ui.big.classList.toggle('is-pause', !v);
  });
  // los botones de ± dicen cuánto saltan (lo elige cada perfil)
  setOnce('step', seekStep(), (v) => {
    for (const [act, dir] of [
      ['back10', 'Retroceder'],
      ['fwd10', 'Adelantar'],
    ]) {
      const b = stage.querySelector(`[data-act="${act}"]`);
      if (!b) continue;
      b.setAttribute('aria-label', `${dir} ${v} segundos`);
      const n = b.querySelector('.st-num');
      if (n) n.textContent = String(v);
    }
  });
  // en medio de la barra: qué se está viendo (en el teléfono, solo el capítulo: la serie se esconde)
  const series = (P.playing && P.playing.ctx && P.playing.ctx.title) || '';
  const what = P.playing
    ? `${series ? `<span class="st-series">${esc(series)} · </span>` : ''}${esc(episodeLabel(P.playing.ep))}`
    : '';
  setOnce('title', what, (v) => {
    ui.title.innerHTML = v;
  });
  const d = isFinite(video.duration) ? video.duration : 0;
  const t = P.seeking ? Number(ui.seek.value) : video.currentTime;
  ui.seek.max = String(d || 0);
  if (!P.seeking) ui.seek.value = String(t || 0);
  let buf = 0;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= t + 0.5) buf = Math.max(buf, video.buffered.end(i));
  }
  stage.style.setProperty('--played', d ? (t / d) * 100 + '%' : '0%');
  stage.style.setProperty('--buffered', d ? (buf / d) * 100 + '%' : '0%');
  setOnce('time', `${fmtTime(t)} / ${fmtTime(d)}`, (v) => {
    ui.time.textContent = v;
  });
  setOnce('next', !neighbor(1), (v) => {
    ui.next.hidden = v;
  });
  paintSkip(t, d);
  setOnce('mute', video.muted || video.volume === 0, (v) => {
    ui.mute.innerHTML = v
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  });
  setOnce('speed', P.speed === 1 ? '1×' : `${P.speed}×`, (v) => {
    ui.speed.textContent = v;
  });
  setOnce('fs', isFullscreen(), (v) => {
    ui.fs.setAttribute('aria-label', v ? 'Salir de pantalla completa' : 'Pantalla completa');
    stage.classList.toggle('is-fs', v);
  });
}

export function wake() {
  stage.classList.remove('is-idle');
  clearTimeout(P.idleTimer);
  // también en pausa: como en YouTube, al rato queda solo la imagen (tocar la vuelve a mostrar)
  P.idleTimer = setTimeout(() => {
    if (ui.menu.hidden && !P.seeking) stage.classList.add('is-idle');
  }, 2800);
}

export function togglePlay() {
  if (!video.currentSrc) return;
  if (video.paused) video.play().catch(() => {});
  else video.pause();
}

/** ±s segundos. Con `quiet` (doble toque en el teléfono) los controles se esconden para ver el video mientras
 * adelanta; solo se ve el aviso de cuánto. @param {number} s @param {{ quiet?: boolean }} [opts] */
/** Cuántos segundos salta cada ±, según el perfil. */
export const seekStep = () => profilePrefs().step;

/* Mantener presionado (el dedo en el video, o la barra espaciadora en la PC): otra velocidad mientras dura. */
let fast = false;
export function startFast() {
  if (fast || !video.currentSrc || video.paused || video.ended) return;
  fast = true;
  const rate = profilePrefs().hold;
  video.playbackRate = rate;
  const label = holdEl.firstChild;
  if (label && label.nodeType === 3) label.textContent = `${String(rate).replace('.', ',')}× `;
  holdEl.classList.add('is-on');
}
export function stopFast() {
  if (!fast) return;
  fast = false;
  video.playbackRate = P.speed;
  holdEl.classList.remove('is-on');
}

export function seekBy(s, { quiet = false } = {}) {
  if (!video.duration) return;
  video.currentTime = Math.max(0, Math.min(video.duration - 0.5, video.currentTime + s));
  ui.flash.textContent = s > 0 ? `+${s} s` : `−${-s} s`;
  ui.flash.dataset.side = s > 0 ? 'right' : 'left';
  ui.flash.classList.remove('is-on');
  void ui.flash.offsetWidth;
  ui.flash.classList.add('is-on');
  if (quiet) {
    clearTimeout(P.idleTimer);
    stage.classList.add('is-idle');
    return;
  }
  wake();
}

export const isFullscreen = () =>
  !!(document.fullscreenElement || document.webkitFullscreenElement || stage.classList.contains('kai-fs'));
/* iPhone no deja poner en pantalla completa un elemento de la página, solo el reproductor
 * nativo de iOS, que tapa los controles y gestos de Kai. Ahí se usa una pantalla completa
 * propia: el reproductor ocupa toda la pantalla (sin barras si Kai está en la pantalla de inicio). */
export function setKaiFullscreen(on) {
  stage.classList.toggle('kai-fs', on);
  // en el teléfono (sin girar la pantalla) el video horizontal se muestra girado; ver styles.css
  const wide = !video.videoWidth || video.videoWidth >= video.videoHeight;
  stage.classList.toggle('kai-rot', on && wide && matchMedia('(pointer: coarse)').matches);
  document.documentElement.classList.toggle('kai-fs-on', on);
  paintThemeColor();
  paintControls();
  wake();
}
export function exitFullscreen() {
  if (stage.classList.contains('kai-fs')) {
    setKaiFullscreen(false);
    return;
  }
  const fn = document.exitFullscreen || document.webkitExitFullscreen;
  if (fn) fn.call(document).catch?.(() => {});
}
export function toggleFullscreen() {
  if (isFullscreen()) {
    exitFullscreen();
    return;
  }
  const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
  if (req) {
    Promise.resolve(req.call(stage))
      .then(() => {
        try {
          screen.orientation.lock('landscape').catch(() => {});
        } catch {
          /* nada */
        }
      })
      .catch(() => setKaiFullscreen(true));
  } else {
    setKaiFullscreen(true);
  }
}

export async function togglePip() {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (video.requestPictureInPicture) await video.requestPictureInPicture();
    else if (video.webkitSetPresentationMode)
      video.webkitSetPresentationMode(
        video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture',
      );
  } catch {
    toast('Este navegador no permite ventana flotante aquí.');
  }
}

export function openMenu(kind) {
  if (!ui.menu.hidden && ui.menu.dataset.kind === kind) {
    closeMenu();
    return;
  }
  ui.menu.dataset.kind = kind;
  paintMenu();
  ui.menu.hidden = false;
  wake();
}
export function closeMenu() {
  ui.menu.hidden = true;
}

export function paintMenu() {
  if (ui.menu.hidden && !ui.menu.dataset.kind) return;
  const kind = ui.menu.dataset.kind;
  if (kind === 'speed') {
    ui.menu.innerHTML = `<p class="menu-title">Velocidad</p>${[0.75, 1, 1.25, 1.5, 2].map((v) => `<button class="menu-item ${v === P.speed ? 'is-on' : ''}" data-act="m-speed" data-v="${v}">${v === 1 ? 'Normal' : v + '×'}</button>`).join('')}`;
  }
}

export function setLights(off) {
  document.body.classList.toggle('lights-off', off);
  $('#lights').hidden = !off;
  ui.lights.classList.toggle('is-on', off);
  ui.lights.setAttribute('aria-label', off ? 'Encender la luz' : 'Apagar la luz');
}
