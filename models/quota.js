// @ts-check
/*
 * models/quota.js — la transferencia de MEGA: cuánto bajó Kai en las últimas horas, hasta cuándo dura el límite
 * si se alcanzó, y la cuota de la cuenta Pro. Avisa con el evento "quota" cada vez que algo cambia.
 */

import { LS } from '../lib/util.js';
import { emit } from '../lib/events.js';
import { state } from './store.js';

const KEY_LOG = 'xfer'; //   [[minuto (ms), bytes], …] de las últimas horas
const KEY_LIMIT = 'quota'; // { until: ms } cuando MEGA dice que se acabó la transferencia
const KEY_PRO = 'pro'; //    { used, total } de una cuenta Pro
const WINDOW_MS = 6 * 3600 * 1000;

/** @returns {[number, number][]} lo bajado por minuto en las últimas 6 horas */
export function xferLog() {
  return LS.get(KEY_LOG, []).filter((/** @type {[number, number]} */ x) => Date.now() - x[0] < WINDOW_MS);
}

/** Bytes bajados de MEGA en las últimas 6 horas. */
export const xferUsed = () => xferLog().reduce((a, x) => a + x[1], 0);

/** Suma bytes bajados de MEGA (los cuenta por minuto). @param {number} n */
export function countBytes(n) {
  if (!n) return;
  const log = xferLog();
  const minute = Math.floor(Date.now() / 60000) * 60000;
  const last = log[log.length - 1];
  if (last && last[0] === minute) last[1] += n;
  else log.push([minute, n]);
  LS.set(KEY_LOG, log);
  emit('quota');
}

/** MEGA avisó que se acabó la transferencia y cuántos segundos faltan para que se renueve. @param {number} seconds */
export function noteQuota(seconds) {
  if (!seconds || seconds <= 0) return;
  LS.set(KEY_LIMIT, { until: Date.now() + seconds * 1000 });
  emit('quota');
}

/** Hasta cuándo dura el límite (ms), o 0 si no hay límite ahora. */
export function quotaUntil() {
  const q = LS.get(KEY_LIMIT, null);
  return q && q.until > Date.now() ? q.until : 0;
}

/** Cuota de la cuenta Pro, si es Pro. @returns {{ used: number, total: number } | null} */
export const proQuota = () => LS.get(KEY_PRO, null);

let askedAt = 0;
/**
 * Pregunta a MEGA el tipo de cuenta y cuánto se ha usado de la transferencia Pro. Se pregunta al abrir Kai, después
 * de cada sincronización y al entrar a Ajustes (antes solo al abrir: en una pestaña que nunca se cierra el número se
 * quedaba fijo), pero no más de una vez por minuto salvo que se pida con `force`.
 * @param {boolean} [force]
 */
export async function refreshAccountInfo(force = false) {
  if (!state.storage || (!force && Date.now() - askedAt < 60000)) return;
  askedAt = Date.now();
  try {
    const r = await state.storage.api.request({ a: 'uq', xfer: 1, pro: 1 });
    if (r && r.utype > 0 && r.mxfer) LS.set(KEY_PRO, { used: r.caxfer || 0, total: r.mxfer });
    else LS.del(KEY_PRO);
    emit('quota');
  } catch {
    /* sin conexión o sin sesión: queda lo que se sabía */
  }
}
