/*
 * Actualizaciones de Kai. El service worker se instala solo cuando cambia; al activarse toma el control de la página
 * (controllerchange). Ahí Kai avisa que hay versión nueva y basta con recargar; al volver a Kai sin nada en curso se
 * recarga sola.
 */
import { $, esc } from '../lib/util.js';
import { isUpdateReady, markUpdateReady, setRegistration, findUpdate, swInfo } from '../models/updates.js';
import { toast } from '../views/toast.js';
import { savePosition } from './player/engine.js';
import { P } from './player/state.js';
import { state } from '../models/store.js';

function setCheckButton(text, disabled = false) {
  const btn = $('#check-update');
  if (!btn) return;
  btn.disabled = disabled;
  btn.querySelector('span').textContent = text;
}

export function showUpdateNotice() {
  markUpdateReady();
  setCheckButton('Actualizar ahora');
  if ($('#update-notice')) return;
  const el = document.createElement('div');
  el.id = 'update-notice';
  el.className = 'update-notice';
  el.setAttribute('role', 'status');
  // solo avisa, y se queda hasta actualizar (no se puede cerrar: actualizar no cuesta nada, Kai vuelve al mismo
  // segundo del capítulo y la versión nueva ya está bajada). Al tocarla se abre con lo que cambió y el botón.
  el.innerHTML = `<button class="update-what" data-act="update-news" aria-expanded="false"><b>Versión nueva de Kai</b><span class="update-see">Toca para ver qué cambió</span></button><div class="update-more" hidden></div>`;
  document.body.appendChild(el);
}

/** Abre (o cierra) la burbuja con lo que cambió en la versión nueva y el botón para actualizar. */
export async function showUpdateNews() {
  const el = $('#update-notice');
  if (!el) return;
  const more = /** @type {HTMLElement} */ (el.querySelector('.update-more'));
  const btn = /** @type {HTMLElement} */ (el.querySelector('.update-what'));
  if (el.classList.contains('is-open')) {
    el.classList.remove('is-open');
    more.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    return;
  }
  const info = await swInfo();
  more.innerHTML = `<div class="update-scroll">${changesHTML(info.cambios)}</div><button class="update-btn" data-act="apply-update">Actualizar${info.label ? ` a ${esc(info.label)}` : ''}</button>`;
  more.hidden = false;
  el.classList.add('is-open');
  btn.setAttribute('aria-expanded', 'true');
  btn.querySelector('.update-see').textContent = 'Lo nuevo:';
}

/**
 * Lo que cambió, agrupado por sección. Cada cambio de sw.js empieza con su sección ("Catálogo: …"): todo lo de una
 * sección sale junto, en el orden en que aparece la primera vez. Lo que no trae sección va en "Otros".
 * @param {string[]} cambios
 */
export function changesHTML(cambios) {
  if (!cambios.length) return '<p class="update-list">Arreglos y mejoras pequeñas.</p>';
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const c of cambios) {
    const m = /^([^:.]{2,28}):\s+(.+)$/s.exec(c);
    const sec = m ? m[1] : 'Otros';
    const text = m ? m[2] : c;
    groups.set(sec, [...(groups.get(sec) || []), text.charAt(0).toUpperCase() + text.slice(1)]);
  }
  return [...groups]
    .map(
      ([sec, items]) =>
        `<section class="update-sec"><h4 class="update-sec-title">${esc(sec)}</h4><ul class="update-list">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`,
    )
    .join('');
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
  /* La versión nueva ya está bajada pero la página sigue con el código viejo hasta recargar. Al volver a Kai (de otra
   * app o pestaña) se recarga sola si no interrumpe nada: sin video y sin descargas en curso. Así ningún dispositivo
   * se queda semanas con una versión vieja (una anterior a Kai 41 mezclaba lo visto entre perfiles). */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !isUpdateReady()) return;
    if (P.playing || Object.keys(state.dls).length || state.queue.length) return;
    applyUpdate();
  });
  navigator.serviceWorker
    .register('sw.js')
    .then((r) => setRegistration(r))
    .catch((e) => console.warn('sw', e));
}
