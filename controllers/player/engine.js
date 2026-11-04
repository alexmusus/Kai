/*
 * controllers/player/engine.js — El motor: empezar un capítulo (del archivo descargado o de MEGA por el service
 * worker), avisos cuando no se puede, guardar dónde quedó, pasar al siguiente o al anterior, terminar y detener.
 * También explica por qué un formato no se reproduce.
 */

import { P } from './state.js';
import { ui, stage, video } from './dom.js';
import { closeMenu, paintControls, seekBy, setLights, isFullscreen, exitFullscreen } from './controls.js';
import { resetChapters, initChapters } from './chapters.js';
import { $, sleep, esc } from '../../lib/util.js';
import { localBlob } from '../../models/downloads.js';
import { megaMessage, downloadUrl } from '../../models/mega.js';
import { prog, setProgress, markNow } from '../../models/progress.js';
import { state } from '../../models/store.js';
import { downloadAndWait } from '../downloads.js';
import { episodeLabel } from '../../models/collections.js';
import { thumbFor } from '../../models/thumbs.js';
import { resolveContext } from '../../models/context.js';
import { route } from '../../lib/route.js';
import { setRouteKey } from '../router.js';
import { paintMini, leaveMini } from './mini.js';
import { sync } from '../sync.js';
import { quotaUntil } from '../../models/quota.js';
import { mp4Formats } from '../../models/mp4.js';
import { rangeReader, rememberCodec, formatProblem, formatSummary } from '../../models/media.js';
import { paintWatchInfo, parkStage } from './page.js';

/** El archivo descargado que se está reproduciendo, si lo hay (para leerlo por rangos sin ir a MEGA). */
export const sourceBlob = (token) => (token && token.source && token.source.blob) || null;

export async function startPlayback(ctx) {
  if (P.playing) finishCurrent();
  clearTimeout(P.nextTimer);
  const ep = ctx.ep;
  const token = {
    ep,
    ctx,
    objectUrl: null,
    lastSaved: 0,
    lastSync: Date.now(),
    recover: [],
    source: null,
    chapters: [],
    autoSkipped: false,
    learned: false,
    undo: null,
    offer: null,
  };
  P.playing = token;
  ui.msg.hidden = true;
  ui.nextCard.hidden = true;
  closeMenu();
  resetChapters();
  $('#st-marks').innerHTML = '';
  stage.classList.add('is-loading');
  stage.classList.remove('is-ended');
  video.removeAttribute('src');
  video.load();
  paintControls();

  let src = null;
  let localErr = null;
  const blob = await localBlob(ep, true).catch((err) => {
    localErr = err;
    return null;
  });
  if (P.playing !== token) return;
  if (blob) {
    src = token.objectUrl = URL.createObjectURL(blob);
    token.source = { blob };
  } else if (navigator.onLine) {
    try {
      src = await streamUrl(ep);
      token.source = { stream: true };
    } catch (err) {
      if (P.playing !== token) return;
      return playerMessage(
        err.message === 'NOSW'
          ? 'La app se está preparando. Recarga la página y vuelve a intentarlo.'
          : megaMessage(err),
      );
    }
  } else if (localErr && localErr.message === 'NOFOLDER') {
    return playerMessage('Kai necesita permiso para abrir tu carpeta de descargas.', false, true);
  } else if (localErr && localErr.message === 'NOFILE') {
    return playerMessage('El archivo ya no está en tu carpeta de descargas.');
  } else {
    return playerMessage('Este capítulo no está descargado y no hay conexión.');
  }
  if (P.playing !== token) return;

  const p = prog(ep);
  const startAt = p && !p.w && p.t > 5 ? Math.max(0, p.t - 3) : 0;
  // #t= hace que el navegador empiece directo en ese punto, sin un salto aparte
  video.src = startAt ? `${src}#t=${startAt.toFixed(1)}` : src;
  video.addEventListener(
    'loadedmetadata',
    () => {
      if (P.playing !== token) return;
      if (startAt && video.duration && startAt < video.duration - 2 && Math.abs(video.currentTime - startAt) > 2)
        video.currentTime = startAt;
      video.playbackRate = P.speed;
    },
    { once: true },
  );
  setMediaSession(ep, ctx);
  video.play().catch(() => {
    stage.classList.remove('is-loading');
    paintControls();
  });
  initChapters(ep, token);
}

export async function streamUrl(ep) {
  if (!('serviceWorker' in navigator)) throw new Error('NOSW');
  if (!navigator.serviceWorker.controller) {
    await Promise.race([navigator.serviceWorker.ready, sleep(3000)]);
    await sleep(50);
    if (!navigator.serviceWorker.controller) throw new Error('NOSW');
  }
  const url = await downloadUrl(ep.id);
  const q = new URLSearchParams({ u: url, k: ep.key, s: String(ep.size), t: ep.mime, i: ep.id });
  return '__stream?' + q.toString();
}

export function playerMessage(text, offerDownload = false, offerFolder = false, detail = '') {
  stage.classList.remove('is-loading');
  ui.msg.innerHTML = `<p>${esc(text)}</p>${detail ? `<p class="p-detail">${esc(detail)}</p>` : ''}<div class="btn-row">
    ${offerDownload ? '<button class="btn btn-lamp" data-act="p-dl">Descargar y ver</button>' : ''}
    ${offerFolder ? '<button class="btn btn-lamp" data-act="p-folder">Permitir acceso</button>' : ''}
    <a class="btn" href="${P.playing ? P.playing.ctx.back : '#/'}">Volver</a></div>`;
  ui.msg.hidden = false;
}

export async function downloadThenPlay() {
  if (!P.playing) return;
  const { ep, ctx } = P.playing;
  ui.msg.innerHTML = '<p id="p-dl-status">Descargando…</p>';
  const tick = setInterval(() => {
    const t = state.dls[ep.id];
    const st = $('#p-dl-status');
    if (t && st) st.textContent = `Descargando… ${Math.round((t.loaded / t.total) * 100)}%`;
  }, 400);
  await downloadAndWait(ep, ctx.title);
  clearInterval(tick);
  if (!P.playing || P.playing.ep !== ep) return;
  if (state.saved.has(ep.id)) {
    P.playing = null;
    startPlayback(ctx);
  } else playerMessage('No se pudo descargar el capítulo.');
}

export function setMediaSession(ep, ctx) {
  if (!('mediaSession' in navigator)) return;
  try {
    const meta = (art) =>
      new MediaMetadata({ title: episodeLabel(ep), artist: ctx.title, album: 'Kai', artwork: art || [] });
    navigator.mediaSession.metadata = meta();
    thumbFor(ep).then((u) => {
      if (u && P.playing && P.playing.ep === ep)
        navigator.mediaSession.metadata = meta([{ src: u, sizes: '320x180', type: 'image/jpeg' }]);
    });
    const set = (a, fn) => {
      try {
        navigator.mediaSession.setActionHandler(a, fn);
      } catch {
        /* nada */
      }
    };
    set('nexttrack', () => playNext());
    set('previoustrack', () => playPrev());
    set('seekbackward', () => seekBy(-10));
    set('seekforward', () => seekBy(10));
  } catch {
    /* nada */
  }
}

export function neighbor(delta) {
  if (!P.playing) return null;
  const list = P.playing.ctx.list;
  const i = list.findIndex((x) => x.id === P.playing.ep.id);
  return i >= 0 ? list[i + delta] || null : null;
}
export function switchTo(ep) {
  if (!ep) return;
  const ctx = resolveContext(ep.id);
  if (!ctx) return;
  if (route().view === 'play') {
    history.replaceState(history.state, '', '#/play/' + encodeURIComponent(ep.id));
    setRouteKey('play/' + ep.id);
    startPlayback(ctx);
    paintWatchInfo();
  } else {
    startPlayback(ctx); // sigue en el mini reproductor
    paintMini();
  }
}
export function playNext() {
  const n = neighbor(1);
  if (n) switchTo(n);
}
export function playPrev() {
  const n = neighbor(-1);
  if (n) switchTo(n);
}

export function savePosition(force = false) {
  if (!P.playing || !video.duration || !isFinite(video.duration) || !video.currentSrc) return;
  const now = Date.now();
  if (!force && now - P.playing.lastSaved < 4000) return;
  P.playing.lastSaved = now;
  setProgress(P.playing.ep, video.currentTime, video.duration);
  markNow(P.playing.ep, video.currentTime, video.duration);
  if (force || now - P.playing.lastSync > 60000) {
    P.playing.lastSync = now;
    sync();
  }
}

export function finishCurrent() {
  if (!P.playing) return;
  savePosition(true);
  if (P.playing.objectUrl) {
    const u = P.playing.objectUrl;
    setTimeout(() => URL.revokeObjectURL(u), 1500);
  }
}

export function stopPlayback() {
  clearTimeout(P.nextTimer);
  if (document.body.classList.contains('lights-off')) setLights(false);
  if (P.playing) {
    video.pause();
    finishCurrent();
    P.playing = null;
  }
  resetChapters();
  closeMenu();
  if (isFullscreen()) exitFullscreen();
  if (video.getAttribute('src')) {
    video.removeAttribute('src');
    video.load();
  }
  stage.hidden = true;
  leaveMini();
  parkStage();
}

/** En los últimos minutos baja en silencio el inicio del siguiente capítulo (unos 3 MB) para que empiece sin espera. */
export function maybePrefetchNext() {
  if (!P.playing || P.playing.prefetched || state.settings.prefetchNext === false || !navigator.onLine) return;
  const d = video.duration;
  if (!isFinite(d) || d - video.currentTime > 150) return;
  P.playing.prefetched = true;
  const n = neighbor(1);
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!n || !sw || state.saved.has(n.id) || quotaUntil() > 0) return;
  downloadUrl(n.id)
    .then((u) => sw.postMessage({ type: 'prefetch', u, k: n.key, s: n.size, i: n.id, blocks: 3 }))
    .catch(() => {});
}

export async function explainFormat(ep, code) {
  const token = P.playing;
  stage.classList.add('is-loading');
  let f = null;
  try {
    f = await mp4Formats(await rangeReader(ep, sourceBlob(token)), ep.size);
  } catch (err) {
    console.warn('formato', err);
  }
  if (f && f.video) rememberCodec(ep, f);
  if (P.playing !== token) return;
  const prob = formatProblem(f);
  const detail = `Detalle: código ${code}; ${formatSummary(f)}`;
  if (prob) playerMessage(`Este video viene en ${prob.what}. ${prob.fix}`, false, false, detail);
  else
    playerMessage(
      'Este navegador no pudo reproducir el video, aunque su formato parece normal. El archivo podría estar dañado o incompleto en MEGA.',
      !token.objectUrl,
      false,
      detail,
    );
}
