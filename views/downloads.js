/*
 * views/downloads.js — Descargados: lo guardado en este dispositivo, agrupado por serie, con el espacio que ocupa.
 */

import { app, header } from './components.js';
import { refreshSaved, getDir, dirPermission } from '../models/downloads.js';
import { index, knownEps, state } from '../models/store.js';
import { route } from '../lib/route.js';
import { titleFor } from '../models/context.js';
import { fmtSize, plural, esc } from '../lib/util.js';
import { sortEpisodes } from '../models/naming.js';
import { episodeRow } from './episodes.js';
import { paintSync } from './dock.js';
import { hydrateThumbs } from './thumbs.js';

export async function renderDownloads() {
  if (!app.querySelector('main.downloads')) app.innerHTML = header('Descargados') + '<main class="downloads"></main>';
  const metas = [...(await refreshSaved()).values()].filter((m) => m.ep || index.byId.get(m.id));
  if (route().view !== 'descargas') return;
  for (const m of metas) if (!m.ep) m.ep = index.byId.get(m.id).ep;
  metas.forEach((m) => {
    if (!index.byId.has(m.id)) knownEps.set(m.id, m.ep);
  });
  const groups = new Map();
  for (const m of metas) {
    const t = m.title || titleFor(m.ep) || 'Otros';
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(m.ep);
  }
  const total = metas.filter((m) => m.done).reduce((a, m) => a + (m.size || 0), 0);
  const folderN = metas.filter((m) => m.done && m.where === 'folder').length;
  const dir = await getDir();
  const perm = dir ? await dirPermission(dir) : '';
  let free = '';
  try {
    const est = await navigator.storage.estimate();
    if (est.quota) free = `, quedan ${fmtSize(Math.max(0, est.quota - est.usage))} disponibles`;
  } catch {
    /* nada */
  }
  if (route().view !== 'descargas') return;
  app.innerHTML =
    header('Descargados') +
    `<main class="downloads">
    ${metas.length ? `<p class="dim downloads-sum">${plural(state.saved.size, 'capítulo', 'capítulos')} en este dispositivo, ${fmtSize(total)}${folderN ? ` (${folderN === state.saved.size ? 'todos' : folderN} en tu carpeta${dir ? ` «${esc(dir.name)}»` : ''})` : ''}${free}.</p>` : ''}
    ${dir && perm === 'prompt' ? '<p class="downloads-sum"><button class="btn btn-lamp" data-act="dir-grant">Permitir acceso a tu carpeta de descargas</button></p>' : ''}
    ${
      !metas.length
        ? `<section class="empty"><p>No hay capítulos descargados.</p>
      <p class="dim">Toca la flecha junto a un capítulo para verlo sin conexión.</p></section>`
        : ''
    }
    ${[...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'es'))
      .map(
        ([t, eps]) => `<section class="block">
      <h3 class="group-title">${esc(t)}</h3>
      <ol class="episodes">${sortEpisodes(eps)
        .map((ep) => episodeRow(ep))
        .join('')}</ol>
    </section>`,
      )
      .join('')}
    ${metas.length ? '<button class="btn btn-quiet" data-act="clear-dl">Quitar todas las descargas</button>' : ''}
  </main>`;
  paintSync();
  hydrateThumbs(app);
}
