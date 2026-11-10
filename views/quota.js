// @ts-check
/*
 * views/quota.js — el aviso de la transferencia de MEGA (en Ajustes, y la marca del botón de perfil).
 */

import { fmtSize, fmtWait } from '../lib/util.js';
import { quotaUntil, proQuota, xferUsed } from '../models/quota.js';

/** @param {boolean} [long] la versión larga es para Ajustes */
export function quotaText(long = false) {
  const until = quotaUntil();
  if (until) return `Límite de MEGA alcanzado. Se renueva en ${fmtWait(Math.ceil((until - Date.now()) / 60000))}.`;
  const pro = proQuota();
  if (pro) return `Transferencia de MEGA: ${fmtSize(pro.used)} de ${fmtSize(pro.total)}.`;
  const used = xferUsed();
  if (!used) return long ? 'Kai no ha usado transferencia de MEGA en las últimas 6 horas.' : '';
  return long
    ? `Kai usó ${fmtSize(used)} de transferencia de MEGA en las últimas 6 horas. MEGA gratis no publica un límite fijo; si se acaba, se renueva solo.`
    : `MEGA: ${fmtSize(used)} en 6 h`;
}

/** La marca de límite alcanzado en el botón de perfil (body.quota-hit). */
export function paintQuota() {
  document.body.classList.toggle('quota-hit', !!quotaUntil());
  // el texto de Ajustes, si está a la vista, se pone al día sin tener que volver a entrar
  const line = document.getElementById('quota-text');
  if (line) line.textContent = quotaText(true);
}
