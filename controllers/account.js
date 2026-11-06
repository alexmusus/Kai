/*
 * controllers/account.js — entrar a MEGA, crear un perfil (sin duplicar uno que ya existe en otro dispositivo) y
 * elegir perfil.
 */
import { on } from '../lib/events.js';
import { login, megaMessage, connect } from '../models/mega.js';
import { viewState } from '../views/view-state.js';
import { refreshLibrary, sync, syncing } from './sync.js';
import { render, playerHooks } from './router.js';
import { renderLogin, renderProfiles } from '../views/account.js';
import { state, visibleProfiles } from '../models/store.js';
import { normName, addProfile, useProfile } from '../models/profiles.js';
import { toast } from '../views/toast.js';
import { $ } from '../lib/util.js';
import { readProfileItems, findCopies, groupCopies, dropFromProfile } from '../models/profile-copies.js';
import { copiesHTML } from '../views/settings.js';
import { askConfirm } from '../views/sheet.js';

on('login', async ({ email, password, code, needCode }) => {
  try {
    await login(email, password, code);
    viewState.loginNote = '';
    refreshLibrary(false);
    location.hash = '#/';
    render();
    sync();
  } catch (err) {
    const m = megaMessage(err);
    if (m === 'MFA') renderLogin('', true, email);
    else renderLogin(m, needCode, email);
  }
});

on('profile-create', (name) => createProfile(name));
async function createProfile(name) {
  // antes de crear, vuelve a mirar MEGA por si otro dispositivo ya creó perfiles
  if (navigator.onLine) {
    try {
      await connect();
      if (syncing) await syncing.catch(() => {});
      await sync();
    } catch {
      /* se revisa abajo */
    }
    if (!state.sharedLoaded || state.sharedError) {
      renderProfiles();
      return;
    }
  }
  const same = visibleProfiles().find((x) => normName(x.name) === normName(name));
  if (same) {
    toast(`Ya tenías el perfil ${same.name}; entraste con ese.`);
    selectProfile(same.id);
    return;
  }
  selectProfile(addProfile(name).id);
}

export function selectProfile(id) {
  const p = visibleProfiles().find((x) => x.id === id);
  if (!p) return;
  if (state.profile && state.profile.id !== id) {
    playerHooks.save();
    playerHooks.stop();
  }
  useProfile(p);
  location.hash = '#/';
  render();
  sync();
}

/* ── separar lo que se copió entre perfiles (Ajustes) ── */
/** @type {{ groups: import('../models/profile-copies.js').CopyGroup[], picks: Record<number, string> }} */
const copies = { groups: [], picks: {} };

/** Lee el progreso de todos los perfiles y muestra lo que está copiado. @param {HTMLButtonElement} btn */
export async function checkCopies(btn) {
  const box = $('#copies-list');
  if (!box) return;
  if (!state.storage || !state.library) {
    box.innerHTML = '<p class="dim">Necesitas conexión con MEGA para revisar.</p>';
    return;
  }
  btn.disabled = true;
  box.innerHTML = '<p class="dim">Revisando el progreso de cada perfil…</p>';
  try {
    await syncing; // que lo de este dispositivo ya esté en MEGA
    const home = state.storage.root;
    /** @type {Record<string, any>} */
    const byProfile = {};
    for (const p of visibleProfiles().filter((x) => !x.mergedInto))
      byProfile[p.id] = await readProfileItems(home, p.id);
    copies.groups = groupCopies(findCopies(byProfile), state.library);
    copies.picks = {};
    box.innerHTML = copiesHTML(copies.groups, copies.picks);
  } catch (err) {
    box.innerHTML = `<p class="dim">${megaMessage((err && err.cause) || err)}</p>`;
  } finally {
    btn.disabled = false;
  }
}

/** Elige de quién es un grupo. @param {HTMLElement} el */
export function pickCopy(el) {
  copies.picks[Number(el.dataset.g)] = el.dataset.v || '';
  const box = $('#copies-list');
  if (box) box.innerHTML = copiesHTML(copies.groups, copies.picks);
}

/** Quita cada grupo elegido de los perfiles que no son su dueño. */
export async function applyCopies() {
  if (!state.storage) return;
  /** @type {Map<string, string[]>} perfil → entradas que se le quitan */
  const drop = new Map();
  copies.groups.forEach((g, i) => {
    const owner = copies.picks[i];
    if (!owner) return;
    for (const pid of g.pids) if (pid !== owner) drop.set(pid, [...(drop.get(pid) || []), ...g.keys]);
  });
  if (!drop.size) return;
  const n = Object.values(copies.picks).filter(Boolean).length;
  const yes = await askConfirm(`¿Separar ${n === 1 ? 'esta serie' : `estas ${n} series`}?`, {
    detail: 'Se quita lo visto y Más tarde del perfil que no era, en todos los dispositivos.',
    ok: 'Separar',
  });
  if (!yes) return;
  const box = $('#copies-list');
  try {
    for (const [pid, keys] of drop) await dropFromProfile(state.storage.root, pid, keys);
    toast('Listo: cada perfil quedó con lo suyo.');
    copies.groups = copies.groups.filter((_, i) => !copies.picks[i]);
    copies.picks = {};
    if (box) box.innerHTML = copiesHTML(copies.groups, copies.picks);
    render();
  } catch (err) {
    toast(megaMessage((err && err.cause) || err));
  }
}
