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
