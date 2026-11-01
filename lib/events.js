// @ts-check
/*
 * lib/events.js — avisos entre partes de Kai. Un modelo avisa ("cambió la cuota", "terminó de sincronizar")
 * sin saber quién escucha; el controlador decide qué redibujar. Así los modelos no importan la pantalla.
 *
 * Los avisos son síncronos: emit() llama a cada oyente en el momento, en el orden en que se suscribieron.
 * Si un oyente falla, los demás igual se enteran (el error queda en la consola).
 */

/** @type {Map<string, Set<(payload?: any) => void>>} */
const listeners = new Map();

/**
 * Escucha un aviso. Devuelve la función para dejar de escuchar.
 * @param {string} name
 * @param {(payload?: any) => void} fn
 * @returns {() => void}
 */
export function on(name, fn) {
  let set = listeners.get(name);
  if (!set) listeners.set(name, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

/**
 * Avisa a todos los que escuchan.
 * @param {string} name
 * @param {any} [payload]
 */
export function emit(name, payload) {
  for (const fn of [...(listeners.get(name) || [])]) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`aviso "${name}"`, err);
    }
  }
}
