/*
 * views/watch.js — El botón de descarga junto al video.
 */

import { state } from '../models/store.js';
import { ICON } from './icons.js';
import { esc } from '../lib/util.js';

export function watchDlButton(ep) {
  const t = state.dls[ep.id];
  const queued = state.queue.some((q) => q.ep.id === ep.id);
  const label = t
    ? `Descargando ${Math.round((t.loaded / t.total) * 100)}%`
    : queued
      ? 'En cola'
      : state.saved.has(ep.id)
        ? 'Descargado'
        : 'Descargar';
  const icon = t || queued ? ICON.queued : state.saved.has(ep.id) ? ICON.saved : ICON.down;
  return `<button class="btn ${state.saved.has(ep.id) ? 'is-saved' : ''}" data-act="w-dl" data-id="${esc(ep.id)}">${icon}<span>${label}</span></button>`;
}
