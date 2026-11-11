/*
 * views/dock.js — lo que muestra el botón flotante: el estado de la sincronización (ruedita, puntito verde),
 * el puntito de novedades y cuántos capítulos hay descargados.
 */

import { $ } from '../lib/util.js';
import { state } from '../models/store.js';
import { hasUnreadNews } from '../models/news.js';

/** El estado de sincronización vive en el botón flotante: ruedita azul mientras sincroniza, puntito verde si está al día. */
const SYNC_LABEL = { offline: 'sin conexión', syncing: 'sincronizando', pending: 'por sincronizar', ok: 'al día' };
export function paintSync() {
  const d = $('#dock');
  if (!d) return;
  const offline = !navigator.onLine;
  const pending = state.dirty || state.syncState === 'error';
  const st = offline ? 'offline' : state.syncState === 'syncing' ? 'syncing' : pending ? 'pending' : 'ok';
  d.dataset.sync = st;
  document.documentElement.dataset.sync = st; // también para el avatar de arriba (Bloques, teléfono)
  const btn = d.querySelector('.dock-btn');
  if (btn && btn.dataset.name)
    btn.setAttribute(
      'aria-label',
      `Menú (${btn.dataset.name}), ${SYNC_LABEL[st]}${hasUnreadNews() ? ', hay novedades' : ''}`,
    );
}

export function paintDrawerCount() {
  const el = $('#dock-count');
  if (el) el.textContent = state.saved.size ? String(state.saved.size) : '';
}

export function paintNewsDot() {
  const btn = $('#dock .dock-btn');
  if (btn) btn.classList.toggle('has-news', hasUnreadNews());
  // las novedades se miran en Ajustes: su pestaña lleva el puntito
  const tab = $('#dock .dock-tab[data-tab="ajustes"]');
  if (tab) tab.classList.toggle('has-news', hasUnreadNews());
}
