/*
 * controllers/downloads.js — las acciones de descargas que necesitan la pantalla: elegir la carpeta (el selector del
 * navegador y su permiso), dejar de usarla (con confirmación) y guardar una copia aparte del capítulo.
 */

import * as dl from '../models/downloads.js';
import { titleFor } from '../models/context.js';
import { dirAccess, useFolder, flushFolder, forgetFolder, localBlob } from '../models/downloads.js';
import { toast } from '../views/toast.js';
import { askConfirm } from '../views/sheet.js';
import { route } from '../lib/route.js';
import { renderSettings } from '../views/settings.js';

/** Pone un capítulo en la cola de descargas (con el nombre de su serie para agruparlo en Descargados). */
export function queueDownload(ep, title) {
  dl.queueDownload(ep, title || titleFor(ep));
}
export function downloadAndWait(ep, title) {
  return dl.downloadAndWait(ep, title || titleFor(ep));
}

/** Elegir la carpeta de descargas (Chrome y Edge): el selector del navegador y el permiso. */
export async function pickFolder() {
  let d;
  try {
    d = await window.showDirectoryPicker({ id: 'kai-descargas', mode: 'readwrite', startIn: 'videos' });
  } catch {
    return;
  } // canceló
  if (!(await dirAccess(d, true))) {
    toast('Kai necesita permiso para guardar en esa carpeta.');
    return;
  }
  await useFolder(d);
  toast(`Las descargas se guardarán en «${d.name}».`);
  if (route().view === 'ajustes') renderSettings();
  flushFolder();
}
export async function dropFolder() {
  const ok = await askConfirm('¿Dejar de usar la carpeta?', {
    detail:
      'Las descargas nuevas se guardarán dentro de la app. Lo que ya está en la carpeta se queda ahí y Kai lo sigue usando.',
    ok: 'Dejar de usarla',
  });
  if (!ok) return;
  forgetFolder();
  if (route().view === 'ajustes') renderSettings();
}

/** Copia aparte del capítulo (Safari, iPhone, Firefox): el navegador la guarda en Descargas o en Archivos. */
export async function exportCopy(ep) {
  const blob = await localBlob(ep, true).catch(() => null);
  if (!blob) {
    toast('Primero descarga el capítulo.');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = ep.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
