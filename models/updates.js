// @ts-check
/*
 * models/updates.js — versiones nuevas de Kai. El service worker se instala solo cuando cambia; al activarse toma el
 * control de la página (controllerchange) y desde ahí basta con recargar.
 */

import { sleep } from '../lib/util.js';

/** @type {ServiceWorkerRegistration | null | undefined} */
let swReg = null;
let ready = false;

/** ¿Ya se instaló una versión nueva (falta recargar)? */
export const isUpdateReady = () => ready;
/** El service worker nuevo tomó el control. */
export function markUpdateReady() {
  ready = true;
}
/** @param {ServiceWorkerRegistration} r */
export function setRegistration(r) {
  swReg = r;
}

/** La versión instalada ("Kai 38", y "· entrega 3" si es una prueba posterior a la primera), o '' si no hay service
 * worker o no responde en 2 s. @returns {Promise<string>} */
export function swVersion() {
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (!sw) return Promise.resolve('');
  return new Promise((res) => {
    const done = (/** @type {MessageEvent} */ e) => {
      if (e.data && e.data.type === 'version') {
        navigator.serviceWorker.removeEventListener('message', done);
        const { version: v, entrega: n } = e.data;
        // las de antes mandaban "kai-v52"
        res(typeof v === 'number' ? `Kai ${v}${n > 1 ? ` · entrega ${n}` : ''}` : String(v).replace('kai-v', 'Kai '));
      }
    };
    navigator.serviceWorker.addEventListener('message', done);
    sw.postMessage({ type: 'version' });
    setTimeout(() => res(''), 2000);
  });
}

/**
 * Pregunta si hay una versión nueva. Si la hay, espera hasta 10 s a que se instale y tome el control.
 * @returns {Promise<boolean>} si encontró una (aunque todavía no esté lista)
 */
export async function findUpdate() {
  let found = false;
  try {
    if (!swReg && navigator.serviceWorker) swReg = await navigator.serviceWorker.getRegistration();
    if (swReg) {
      await swReg.update();
      found = !!(swReg.installing || swReg.waiting);
      for (let i = 0; i < 40 && found && !ready; i++) await sleep(250);
    }
  } catch {
    /* sin conexión */
  }
  return found;
}
