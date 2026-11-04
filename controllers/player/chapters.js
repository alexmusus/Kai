/*
 * controllers/player/chapters.js — Capítulos del MP4 ("Intro", "Parte A"…) y la intro: marcas en la línea de
 * tiempo, saltar el opening exacto si el MP4 lo marca, y si no, aprender dónde está por serie (con "Volver a la
 * intro").
 */

import { P } from './state.js';
import { video, ui } from './dom.js';
import { idb } from '../../models/idb.js';
import { rangeReader, saveChapterCache } from '../../models/media.js';
import { mp4Info, mp4Chapters, pickIntro, OUTRO_RE as OUTRO } from '../../models/mp4.js';
import { learnAudioLang } from '../../models/library.js';
import { paintControls } from './controls.js';
import { $ } from '../../lib/util.js';
import { state, saveShared } from '../../models/store.js';
import { sourceBlob, neighbor, playNext } from './engine.js';

/* ── capítulos del MP4 ("Intro", "Parte A"…) ──
 * Los videos traen los subtítulos dentro de la imagen, así que Kai ya no busca pistas ni archivos de subtítulos:
 * solo lee los capítulos, y desde MEGA lo hace cuando el video ya empezó, para no quitarle velocidad al arranque. */
export function resetChapters() {
  if (P.chapCtrl) P.chapCtrl.abort();
  P.chapCtrl = null;
}

/** Espera a que el video esté sonando (o a que pase `ms`, por si no arranca solo). */
export const whenPlaying = (ms) =>
  new Promise((res) => {
    if (!video.paused && video.readyState >= 3) {
      res();
      return;
    }
    let timer = 0;
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener('playing', done);
      res();
    };
    timer = setTimeout(done, ms);
    video.addEventListener('playing', done);
  });

export async function initChapters(ep, token) {
  // mientras no se sepa si el video trae capítulos, Kai no adivina dónde está la intro (ni salta sola con lo aprendido)
  token.chaptersDone = false;
  const giveUp = setTimeout(() => {
    token.chaptersDone = true;
  }, 12000);
  try {
    await loadChapters(ep, token);
  } catch (err) {
    if (P.playing === token) console.warn('capítulos', err);
  } finally {
    clearTimeout(giveUp);
    token.chaptersDone = true;
  }
}
export async function loadChapters(ep, token) {
  const ctrl = new AbortController();
  P.chapCtrl = ctrl;
  const alive = () => P.playing === token && !ctrl.signal.aborted;
  const cached = await idb.get('subcache', ep.id).catch(() => null);
  if (!alive()) return;
  if (cached && cached.v === 3) {
    setChapters(token, cached.chapters || []);
    return;
  }
  if (!/mp4|quicktime/.test(ep.mime)) return;
  // desde MEGA, primero que arranque el video; si está descargado, se lee al instante
  if (!(token.source && token.source.blob)) await whenPlaying(4000);
  if (!alive()) return;
  const read = await rangeReader(ep, sourceBlob(token), ctrl.signal);
  const info = await mp4Info(read, ep.size);
  learnAudioLang(ep, info.audioLang);
  if (!alive()) return;
  const chapters = await mp4Chapters(info, read, video.duration);
  if (!alive()) return;
  setChapters(token, chapters);
  saveChapterCache(ep, chapters);
}

export const median = (a) => {
  const b = [...a].sort((x, y) => x - y);
  return b.length ? b[Math.floor(b.length / 2)] : 0;
};

export function setChapters(token, chapters) {
  if (P.playing !== token) return;
  token.chapters = (chapters || []).map((c) => ({
    ...c,
    end: c.end == null || !isFinite(c.end) ? video.duration || Infinity : c.end,
  }));
  token.intro = pickIntro(token.chapters); // el opening de verdad (no el pedacito de anime que a veces va antes)
  token.chaptersDone = true;
  paintMarks();
  paintControls();
}

export function chapterAt(t) {
  const list = P.playing && P.playing.chapters;
  return list ? list.find((c) => t >= c.start && t < c.end) : null;
}

export function paintMarks() {
  const el = $('#st-marks');
  const d = video.duration;
  const list = (P.playing && P.playing.chapters) || [];
  el.innerHTML =
    d && isFinite(d)
      ? list
          .filter((c) => c.start > 0.5 && c.start < d)
          .map((c) => `<span style="left:${(c.start / d) * 100}%"></span>`)
          .join('')
      : '';
}

/* Sin capítulos, Kai aprende por serie dónde saltaste el opening. */
export function introStats() {
  return state.shared.intros || {};
}
export function learnIntro(from, to) {
  if (!P.playing || P.playing.learned) return;
  const len = to - from;
  if (from > 360 || len < 40 || len > 150) return;
  P.playing.learned = true;
  const all = introStats();
  const key = P.playing.ctx.title;
  const st = all[key] || { starts: [], lens: [] };
  st.starts = [...st.starts, Math.round(from)].slice(-5);
  st.lens = [...st.lens, Math.round(len)].slice(-5);
  st.u = Date.now();
  all[key] = st;
  state.shared.intros = all;
  saveShared();
  state.dirty = true;
}
export function learnedIntro() {
  const st = P.playing && introStats()[P.playing.ctx.title];
  if (!st || !st.lens.length) return null;
  const len = median(st.lens);
  const recent = st.starts.slice(-3);
  const start = median(recent);
  const sure = recent.length >= 2 && recent.every((x) => Math.abs(x - start) <= 8);
  return { len, start, sure };
}

/** Qué ofrece el botón flotante en este momento: saltar intro, ir al siguiente o deshacer. */
export function skipOffer(t, d) {
  if (!P.playing || !d) return null;
  if (P.playing.undo && Date.now() < P.playing.undo.until) return { label: 'Volver a la intro', act: 'undo' };
  const ch = chapterAt(t);
  if (ch && ch === P.playing.intro && t < ch.end - 2) return { label: 'Saltar intro', to: ch.end, sure: true };
  if (ch && OUTRO.test(ch.title) && neighbor(1)) return { label: 'Siguiente capítulo', act: 'next' };
  if (!P.playing.chaptersDone) return null;
  if (P.playing.intro) return null; // con el opening marcado en el MP4 no hace falta adivinar
  if (d < 400 || t > 360) return null;
  const li = learnedIntro();
  if (li && li.sure) {
    if (t >= li.start - 3 && t < li.start + li.len - 3)
      return { label: 'Saltar intro', to: li.start + li.len, sure: true, learned: true };
    return null;
  }
  if (t < 3) return null;
  if (li) return { label: 'Saltar intro', to: t + li.len, guess: true };
  return { label: 'Saltar 85 s', to: t + 85, guess: true };
}

export function paintSkip(t, d) {
  const offer = skipOffer(t, d);
  P.playing && (P.playing.offer = offer);
  ui.skip.hidden = !offer;
  if (!offer) return;
  if (ui.skip.textContent !== offer.label) ui.skip.textContent = offer.label;
  ui.skip.classList.toggle('is-sticky', !!(offer.sure || offer.act));
  // saltar solo: únicamente cuando Kai sabe dónde está la intro
  if (offer.sure && state.settings.autoSkip && !P.playing.autoSkipped && !video.paused) {
    P.playing.autoSkipped = true;
    P.playing.undo = { at: t, until: Date.now() + 6000 };
    seekSure(Math.min(d - 1, offer.to));
    paintSkip(video.currentTime, d);
  }
}

/** Salta a un punto y comprueba que llegó: si el navegador se queda corto (aún no tenía esa parte), lo intenta otra vez. */
export function seekSure(to) {
  const tok = P.playing;
  let tries = 0;
  const check = () => {
    if (P.playing !== tok) return;
    if (video.currentTime < to - 1.5 && tries < 3) {
      tries++;
      video.currentTime = to;
      video.addEventListener('seeked', check, { once: true });
    }
  };
  video.currentTime = to;
  video.addEventListener('seeked', check, { once: true });
}

export function doSkip() {
  if (!P.playing) return;
  const o = skipOffer(video.currentTime, video.duration);
  if (!o) return;
  if (o.act === 'undo') {
    video.currentTime = P.playing.undo.at;
    P.playing.undo = null;
    P.playing.autoSkipped = true;
  } else if (o.act === 'next') playNext();
  else {
    const from = video.currentTime;
    P.playing.autoSkipped = true;
    seekSure(Math.min(video.duration - 1, o.to));
    if (o.guess) learnIntro(from, o.to);
  }
  paintControls();
}
