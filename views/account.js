/*
 * views/account.js — entrar a MEGA y elegir perfil. Los formularios no hacen nada por su cuenta: avisan "login" y
 * "profile-create" y el controlador decide.
 */

import { $, esc, hue } from '../lib/util.js';
import { emit } from '../lib/events.js';
import { state, visibleProfiles } from '../models/store.js';
import { app } from './components.js';

/** La pantalla para entrar a MEGA. Al enviar, avisa "login" con { email, password, code, needCode }. */
export function renderLogin(message = '', needCode = false, email = '') {
  app.innerHTML = `<main class="login">
    <div class="login-mark" aria-hidden="true"><img class="login-icon" src="icon-192.png" alt=""></div>
    <h1 class="login-title">Kai</h1>
    <p class="login-lead">Tus series de MEGA, donde te quedaste, en cualquier pantalla.</p>
    <form id="login" class="form" autocomplete="on">
      <label>Correo de MEGA<input name="email" type="email" required autocomplete="username" value="${esc(email)}"></label>
      <label>Contraseña<input name="password" type="password" required autocomplete="current-password"></label>
      ${needCode ? '<label>Código de verificación<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="one-time-code"></label>' : ''}
      ${message ? `<p class="form-error" role="alert">${esc(message)}</p>` : ''}
      <button class="btn btn-lamp" type="submit">Entrar</button>
      <p class="form-note">Tu contraseña va directo a MEGA y no se guarda. En este dispositivo solo queda la sesión.</p>
    </form>
  </main>`;
  $('#login').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    const code = f.get('code');
    emit('login', {
      email: f.get('email').toString().trim(),
      password: f.get('password').toString(),
      code: code && code.toString(),
      needCode,
    });
  });
}

/* Los dibujos que un perfil puede elegir en lugar de su inicial (Ajustes → Tu avatar). Se guardan por nombre en el
 * perfil (`avatar`), dentro de lo compartido: se ven igual en todos los dispositivos. */
const draw = (/** @type {string} */ d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
export const AVATARS = {
  gato: { label: 'Gato', svg: draw('M5 11V4l5 3.5h4L19 4v7a7 7 0 0 1-14 0z M9.5 12.5h.01 M14.5 12.5h.01') },
  estrella: {
    label: 'Estrella',
    svg: draw('M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z'),
  },
  luna: { label: 'Luna', svg: draw('M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z') },
  rayo: { label: 'Rayo', svg: draw('M13 3L5 13.5h6L10 21l8-10.5h-6z') },
  hoja: { label: 'Hoja', svg: draw('M5 19c0-8 5-13 14-14 0 9-5 14-14 14z M5 19l8-8') },
  corazon: { label: 'Corazón', svg: draw('M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z') },
  llama: {
    label: 'Llama',
    svg: draw('M12 21a6 6 0 0 1-6-6c0-3 2-4.5 3-7 .5 2 2 2.5 2 0 0-2-1-3.5-1-5 4 2 8 6 8 12a6 6 0 0 1-6 6z'),
  },
  gota: { label: 'Gota', svg: draw('M12 3.5s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z') },
  nota: {
    label: 'Nota',
    svg: draw('M9 18V6l10-2v12 M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z'),
  },
  fantasma: {
    label: 'Fantasma',
    svg: draw('M6 20V11a6 6 0 0 1 12 0v9l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5z M10 11h.01 M14 11h.01'),
  },
};

/** El avatar de un perfil: su dibujo si eligió uno, o su inicial. `as` deja ver cómo quedaría otro dibujo. */
export function avatarHTML(p, cls = '', as = p.avatar) {
  const h = p.hue ?? hue(p.name);
  const pic = as && Object.hasOwn(AVATARS, as) ? AVATARS[as].svg : '';
  return `<span class="avatar ${cls}${pic ? ' has-pic' : ''}" style="--h:${h}" aria-hidden="true">${pic || esc([...p.name.trim()][0] || '?').toUpperCase()}</span>`;
}

export function renderProfiles(editing = false, adding = false) {
  const list = visibleProfiles();
  // solo se ofrece crear perfil cuando Kai pudo confirmar en MEGA cuáles existen
  const blocked = !state.sharedLoaded;
  const failed = blocked && (state.sharedError || !navigator.onLine);
  const waiting = blocked && !failed;
  const first = !list.length;
  app.innerHTML = `<main class="profiles">
    <div class="profiles-inner">
      <h1 class="profiles-title">${first && !blocked ? 'Crea tu perfil' : '¿Quién está viendo?'}</h1>
      ${first && !blocked ? '<p class="profiles-lead">Cada perfil guarda su propio progreso y aparece en todos tus dispositivos.</p>' : ''}
      ${waiting && first ? '<p class="profiles-lead">Buscando perfiles en tu MEGA…</p>' : ''}
      ${
        failed
          ? `<p class="profiles-lead">${navigator.onLine ? 'No pude leer tus perfiles en MEGA.' : 'Conéctate a internet para cargar tus perfiles.'}</p>
        ${navigator.onLine && state.sharedErrorMsg && state.sharedErrorMsg !== 'MFA' ? `<p class="profiles-why">${esc(state.sharedErrorMsg)}${/límite de transferencia/i.test(state.sharedErrorMsg) ? ' MEGA cuenta ese límite por conexión: con datos móviles u otra red suele funcionar de inmediato.' : ''}</p>` : ''}
        ${navigator.onLine && list.length ? '<p class="profiles-why">Puedes entrar con tu perfil igual: tu progreso se junta con el de MEGA en cuanto se pueda leer.</p>' : ''}
        ${navigator.onLine ? '<button class="btn btn-lamp" data-act="profiles-retry">Reintentar</button>' : ''}`
          : ''
      }
      <ul class="profile-grid">
        ${list
          .map(
            (
              p,
            ) => `<li><button class="profile-tile ${editing ? 'is-editing' : ''}" data-act="${editing ? 'profile-delete' : 'profile-pick'}" data-id="${esc(p.id)}">
          ${avatarHTML(p, 'avatar-xl')}<span class="profile-name">${esc(p.name)}</span>${editing ? '<span class="profile-remove">Quitar</span>' : ''}
        </button></li>`,
          )
          .join('')}
        ${
          !editing && !blocked
            ? `<li>${
                adding || first
                  ? `<form class="profile-new" id="profile-new">
            <input name="name" maxlength="20" placeholder="Nombre" required autocomplete="off" aria-label="Nombre del perfil">
            <button class="btn btn-lamp" type="submit">Crear</button>
          </form>`
                  : `<button class="profile-tile is-add" data-act="profile-add"><span class="avatar avatar-xl avatar-add" aria-hidden="true">+</span><span class="profile-name">Agregar</span></button>`
              }</li>`
            : ''
        }
      </ul>
      ${list.length && !blocked ? `<button class="btn" data-act="${editing ? 'profiles-done' : 'profiles-edit'}">${editing ? 'Listo' : 'Editar perfiles'}</button>` : ''}
    </div>
  </main>`;
  const form = $('#profile-new');
  if (form) {
    form.name.focus();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      if (!name) return;
      const btn = form.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Revisando…';
      emit('profile-create', name);
    });
  }
}
