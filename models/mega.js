/*
 * models/mega.js — la cuenta de MEGA: el árbol de carpetas y lo que hace falta para leer archivos.
 */

import { Storage } from '../vendor/mega.js';

/** Cifrado de MEGA (core.js, cargado antes que los módulos; lo comparte el service worker). */
export const C = window.MegaCore;

// megajs no conserva el atributo "fa" (miniaturas); lo guardamos al importar cada nodo.
const importFile = Storage.prototype._importFile;
Storage.prototype._importFile = function (f) {
  const file = importFile.call(this, f);
  if (file && f && f.fa) file.fa = f.fa;
  return file;
};

/* MEGA a veces entrega primero una foto vieja de tus carpetas y enseguida manda los cambios que faltan
 * (por eso al tocar Actualizar se veía unos segundos One Piece y otras series de hace meses). Antes de usar
 * el árbol nuevo se espera a que esos cambios dejen de llegar: 2.5 s sin novedades (máximo 20 s). */
export function settleTree(st) {
  return new Promise((resolve) => {
    let quiet;
    const evs = ['add', 'delete', 'move', 'update'];
    const done = () => { clearTimeout(quiet); clearTimeout(cap); evs.forEach((ev) => st.removeListener(ev, bump)); resolve(); };
    const bump = () => { clearTimeout(quiet); quiet = setTimeout(done, 2500); };
    const cap = setTimeout(done, 20000);
    evs.forEach((ev) => st.on(ev, bump));
    bump();
  });
}

export const urlCache = new Map();
export const goneNodes = new Set(); // borrados por nosotros; megajs los quita del árbol cuando MEGA lo confirma
