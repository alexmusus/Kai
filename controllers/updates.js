/*
 * Actualizaciones de Kai. El service worker se instala solo cuando cambia; al activarse toma el control de la página
 * (controllerchange). Ahí Kai avisa que hay versión nueva y basta con recargar.
 */
import { $ } from '../lib/util.js';
import { isUpdateReady, markUpdateReady, setRegistration, findUpdate } from '../models/updates.js';
import { toast } from '../views/toast.js';
import { savePosition } from './player/engine.js';

const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function setCheckButton(text, disabled = false) {
  const btn = $('#check-update');
  if (!btn) return;
  btn.disabled = disabled;
  btn.querySelector('span').textContent = text;
}

function showUpdateNotice() {
  markUpdateReady();
  setCheckButton('Actualizar ahora');
  if ($('#update-notice')) return;
  const el = document.createElement('div');
  el.id = 'update-notice';
  el.className = 'update-notice';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>Hay una versión nueva de Kai.</span><button class="update-btn" data-act="apply-update">Actualizar</button><button class="update-x" data-act="dismiss-update" aria-label="Más tarde">${CLOSE_ICON}</button>`;
  document.body.appendChild(el);
}

/** Recarga con la versión nueva, guardando antes dónde va el capítulo. */
export function applyUpdate() {
  savePosition(true);
  location.reload();
}

/** El botón "Buscar actualización" de Ajustes. */
export async function checkUpdate() {
  if (isUpdateReady()) return applyUpdate();
  setCheckButton('Buscando…', true);
  const found = await findUpdate();
  setCheckButton(isUpdateReady() ? 'Actualizar ahora' : 'Buscar actualización');
  if (isUpdateReady()) return;
  if (!navigator.onLine) toast('Necesitas conexión para buscar actualizaciones.');
  else toast(found ? 'Descargando la versión nueva…' : 'Ya tienes la última versión.');
}

/** Registra el service worker y avisa cuando una versión nueva toma el control. Se llama una vez, al arrancar. */
export function initUpdates() {
  if (!('serviceWorker' in navigator)) return;
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true; // primera instalación: no hay nada que avisar
      return;
    }
    showUpdateNotice();
  });
  navigator.serviceWorker
    .register('sw.js')
    .then((r) => setRegistration(r))
    .catch((e) => console.warn('sw', e));
}
