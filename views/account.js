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

export function avatarHTML(p, cls = '') {
  const h = p.hue ?? hue(p.name);
  return `<span class="avatar ${cls}" style="--h:${h}" aria-hidden="true">${esc([...p.name.trim()][0] || '?').toUpperCase()}</span>`;
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
