/*
 * controllers/player/events.js — Lo que hace el reproductor cuando el video avisa algo (avanzó, terminó, falló, se
 * cortó), la línea de tiempo, los botones del escenario, el teclado y los mensajes del service worker (bytes
 * bajados, cuota, enlaces vencidos).
 */

import { countBytes, noteQuota } from '../../models/quota.js';
import { downloadUrl, C, megaMessage } from '../../models/mega.js';
import { setProgress, prog } from '../../models/progress.js';
import { sync } from '../sync.js';
import { state } from '../../models/store.js';
import { isCollection, episodeLabel } from '../../models/collections.js';
import { esc, $, sleep } from '../../lib/util.js';
import { seasonLabel } from '../../models/fichas.js';
import { ICON } from '../../views/icons.js';
import { epById } from '../../models/library.js';
import { dirAccess, flushFolder } from '../../models/downloads.js';
import { paintThemeColor } from '../../views/theme.js';
import { route } from '../../lib/route.js';
import { closeSheet } from '../../views/sheet.js';
import { closeDrawer } from '../dock.js';
import { viewState } from '../../views/view-state.js';
import { endPicking } from '../picking.js';
import { P } from './state.js';
import { video, stage, ui } from './dom.js';
import {
  paintControls,
  wake,
  togglePlay,
  seekBy,
  setLights,
  toggleFullscreen,
  togglePip,
  openMenu,
  paintMenu,
  closeMenu,
  isFullscreen,
  setKaiFullscreen,
} from './controls.js';
import {
  savePosition,
  maybePrefetchNext,
  neighbor,
  playerMessage,
  playNext,
  explainFormat,
  streamUrl,
  switchTo,
  downloadThenPlay,
  startPlayback,
  playPrev,
} from './engine.js';
import { paintMarks, learnIntro, doSkip } from './chapters.js';
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'mega-bytes') countBytes(e.data.n);
    if (e.data && e.data.type === 'mega-quota') noteQuota(e.data.timeLeft || 3600);
    if (e.data && e.data.type === 'stream-error') P.lastStreamError = String(e.data.msg || '').slice(0, 80);
    // el service worker encontró el enlace de MEGA caducado: se pide otro y se le responde por su canal
    if (e.data && e.data.type === 'need-url' && e.ports && e.ports[0]) {
      const port = e.ports[0];
      downloadUrl(e.data.id, true).then(
        (url) => port.postMessage({ url }),
        () => port.postMessage({ url: '' }),
      );
    }
  });
}

video.addEventListener('timeupdate', () => {
  if (!P.seeking) paintControls();
  savePosition();
  maybePrefetchNext();
});

video.addEventListener('progress', paintControls);

video.addEventListener('durationchange', () => {
  paintControls();
  paintMarks();
});

video.addEventListener('play', () => {
  paintControls();
  wake();
  document.body.classList.add('is-playing');
});

video.addEventListener('pause', () => {
  paintControls();
  savePosition(true);
  stage.classList.remove('is-idle');
  document.body.classList.remove('is-playing');
});

video.addEventListener('emptied', () => document.body.classList.remove('is-playing'));

video.addEventListener('waiting', () => stage.classList.add('is-loading'));

['playing', 'canplay', 'seeked'].forEach((ev) =>
  video.addEventListener(ev, () => stage.classList.remove('is-loading')),
);

video.addEventListener('volumechange', paintControls);

video.addEventListener('ended', () => {
  if (!P.playing) return;
  setProgress(P.playing.ep, video.duration, video.duration, true);
  sync();
  stage.classList.add('is-ended');
  const n = neighbor(1);
  if (!n) {
    // fin de la temporada: no sigue sola. Si hay otra después, se ofrece, pero solo si la tocas.
    const lib = state.library;
    const s = P.playing.ctx.si != null && lib && lib.series[P.playing.ctx.si];
    const nextSe = s && !isCollection(s) && P.playing.ctx.ki != null ? s.seasons[P.playing.ctx.ki + 1] : null;
    if (!nextSe) {
      playerMessage(`Terminaste ${P.playing.ctx.title}.`);
      return;
    }
    const first = nextSe.episodes.find((e) => !(prog(e) || {}).w) || nextSe.episodes[0];
    ui.nextCard.innerHTML = `<p>Terminaste ${esc(seasonLabel(s, s.seasons[P.playing.ctx.ki]))}</p>
      <div class="btn-row">
        <button class="btn btn-lamp" data-act="p-next-season" data-id="${esc(first.id)}">${ICON.play}<span>Ver ${esc(seasonLabel(s, nextSe))}</span></button>
        <a class="btn" href="${P.playing.ctx.back}">Volver</a>
      </div>`;
    ui.nextCard.hidden = false;
    return;
  }
  let left = 6;
  ui.nextCard.innerHTML = `<p>Sigue ${esc(episodeLabel(n))}</p>
    <div class="btn-row">
      <button class="btn btn-lamp" data-act="p-next-now">${ICON.play}<span>Ver ahora</span></button>
      ${state.settings.autoplay ? `<button class="btn" data-act="p-next-cancel">Quedarme aquí <span id="p-count">${left}</span></button>` : ''}
    </div>`;
  ui.nextCard.hidden = false;
  if (state.settings.autoplay) {
    const tick = () => {
      left -= 1;
      const c = $('#p-count');
      if (c) c.textContent = left;
      if (left <= 0) {
        ui.nextCard.hidden = true;
        playNext();
      } else P.nextTimer = setTimeout(tick, 1000);
    };
    P.nextTimer = setTimeout(tick, 1000);
  }
});

video.addEventListener('error', async () => {
  if (!P.playing || !video.getAttribute('src')) return;
  const { ep } = P.playing;
  const at = video.currentTime;
  // Un tropiezo de MEGA o de la red no termina la reproducción: se pide un enlace nuevo y se sigue
  // en el mismo punto. Hasta 4 intentos en 3 minutos, para no quedar en un ciclo si de verdad no hay forma.
  const now = Date.now();
  const code = video.error ? video.error.code : 0;
  P.playing.recover = (P.playing.recover || []).filter((t) => now - t < 180000);
  // código 3 (decodificar) o 4 (formato no soportado): repetir no sirve más de una vez; se revisa el formato
  const formatError = code === 3 || code === 4;
  if (formatError && (P.playing.recover.length >= 1 || P.playing.objectUrl)) {
    explainFormat(ep, code);
    return;
  }
  if (!P.playing.objectUrl && P.playing.recover.length < 4 && navigator.onLine) {
    P.playing.recover.push(now);
    stage.classList.add('is-loading');
    if (P.playing.recover.length > 1) await sleep(1500 * (P.playing.recover.length - 1));
    if (!P.playing || P.playing.ep !== ep) return;
    try {
      // se comprueba el enlace nuevo; un tropiezo pasajero de MEGA aquí no cuenta como fallo
      for (let tries = 1; ; tries++) {
        try {
          const fresh = await downloadUrl(ep.id, true);
          await C.readRange(fresh, await C.fileKey(ep.key), 0, 15);
          break;
        } catch (err) {
          const passing = !err.status || err.status === 408 || err.status === 429 || err.status >= 500;
          if (!passing || tries >= 3 || /QUOTA|509/.test(String(err.code || err.message))) throw err;
          await sleep(1500 * tries);
          if (!P.playing || P.playing.ep !== ep) return;
        }
      }
      video.src = await streamUrl(ep);
      video.addEventListener(
        'loadedmetadata',
        () => {
          if (at) video.currentTime = at;
        },
        { once: true },
      );
      video.play().catch(() => {});
      return;
    } catch (err) {
      playerMessage(megaMessage(err));
      return;
    }
  }
  // detalle para saber la causa si vuelve a pasar (código del navegador y último error del service worker)
  const me = video.error;
  const detail = `Detalle: ${me ? `código ${me.code}${me.message ? `, ${me.message.slice(0, 80)}` : ''}` : 'sin código'}${P.lastStreamError ? `; ${P.lastStreamError}` : ''}; ${P.playing.recover.length} intentos`;
  if (/\.mkv$/i.test(ep.name))
    playerMessage('Este navegador no reproduce archivos MKV. Usa la versión MP4 del capítulo.');
  else if (!P.playing.objectUrl && navigator.onLine)
    playerMessage(
      'No se pudo reproducir en línea. Puedes descargarlo y verlo desde el dispositivo.',
      true,
      false,
      detail,
    );
  else playerMessage('No se pudo reproducir este capítulo en este navegador.');
});

ui.seek.addEventListener('input', () => {
  if (!P.seeking) P.seekFrom = video.currentTime;
  P.seeking = true;
  paintControls();
  wake();
});

ui.seek.addEventListener('change', () => {
  const to = Number(ui.seek.value);
  if (P.seekFrom != null && !(P.playing && P.playing.chapters && P.playing.chapters.length)) learnIntro(P.seekFrom, to);
  video.currentTime = to;
  P.seeking = false;
  P.seekFrom = null;
  paintControls();
});

ui.seek.addEventListener('pointerup', () => {
  if (P.seeking) {
    video.currentTime = Number(ui.seek.value);
    P.seeking = false;
  }
});

stage.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el === ui.tap) return;
  const act = el.dataset.act;
  wake();
  if (act === 'toggle') togglePlay();
  else if (act === 'back10') seekBy(-10);
  else if (act === 'fwd10') seekBy(10);
  else if (act === 'next') playNext();
  else if (act === 'skip') doSkip();
  else if (act === 'lights') setLights(!document.body.classList.contains('lights-off'));
  else if (act === 'fs') toggleFullscreen();
  else if (act === 'pip') togglePip();
  else if (act === 'mute') video.muted = !video.muted;
  else if (act === 'speed') openMenu('speed');
  else if (act === 'm-speed') {
    P.speed = Number(el.dataset.v);
    video.playbackRate = P.speed;
    paintMenu();
    paintControls();
  } else if (act === 'p-next-now') {
    ui.nextCard.hidden = true;
    clearTimeout(P.nextTimer);
    playNext();
  } else if (act === 'p-next-season') {
    ui.nextCard.hidden = true;
    switchTo(epById(el.dataset.id));
  } else if (act === 'p-next-cancel') {
    clearTimeout(P.nextTimer);
    ui.nextCard.hidden = true;
  } else if (act === 'p-dl') downloadThenPlay();
  else if (act === 'p-folder' && P.playing) {
    const ctx = P.playing.ctx;
    dirAccess(state.dlMeta.get(P.playing.ep.id)?.dirKey, true).then((d) => {
      if (d) {
        P.playing = null;
        startPlayback(ctx);
        flushFolder();
      }
    });
  }
});

document.addEventListener('pointerdown', (e) => {
  if (!ui.menu.hidden && !ui.menu.contains(e.target) && !e.target.closest('[data-act="cc"],[data-act="speed"]'))
    closeMenu();
});

/* Al salir, lo de detrás sigue sin calcularse hasta que el teléfono termina de girar (styles.css, html.fs-leaving):
 * se espera a que el tamaño de la pantalla se quede quieto, como mucho 900 ms. */
let leaveTimer = 0;
let leaveCap = 0;
function endLeaving() {
  clearTimeout(leaveTimer);
  clearTimeout(leaveCap);
  removeEventListener('resize', onLeaveResize);
  document.documentElement.classList.remove('fs-leaving');
}
function onLeaveResize() {
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(endLeaving, 150);
}
['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) =>
  document.addEventListener(ev, () => {
    const on = isFullscreen();
    const html = document.documentElement;
    if (!on && html.classList.contains('kai-fs-on')) {
      html.classList.add('fs-leaving');
      addEventListener('resize', onLeaveResize);
      onLeaveResize();
      clearTimeout(leaveCap);
      leaveCap = setTimeout(endLeaving, 900);
    } else if (on) endLeaving();
    html.classList.toggle('kai-fs-on', on);
    paintThemeColor();
    paintControls();
    wake();
  }),
);

if (!(document.pictureInPictureEnabled || video.webkitSupportsPresentationMode)) ui.pip.hidden = true;

document.addEventListener('keydown', (e) => {
  if (route().view !== 'play' || !P.playing) {
    if (e.key === 'Escape') {
      closeSheet();
      closeDrawer();
      if (viewState.picking) endPicking();
    }
    return;
  }
  if (e.target.closest('input:not([type="range"]), textarea, select')) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'k') {
    e.preventDefault();
    togglePlay();
  } else if (k === 'arrowright' || k === 'l') {
    e.preventDefault();
    seekBy(10);
  } else if (k === 'arrowleft' || k === 'j') {
    e.preventDefault();
    seekBy(-10);
  } else if (k === 'f') toggleFullscreen();
  else if (k === 'm') video.muted = !video.muted;
  else if (k === 'n') playNext();
  else if (k === 'b') setLights(!document.body.classList.contains('lights-off'));
  else if (k === 's' && P.playing && P.playing.offer) doSkip();
  else if (k === 'p') playPrev();
  else if (k === 'escape') {
    if (!ui.menu.hidden) closeMenu();
    else if (stage.classList.contains('kai-fs')) setKaiFullscreen(false);
  } else return;
  wake();
});
