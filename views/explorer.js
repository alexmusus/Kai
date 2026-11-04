/*
 * views/explorer.js — Explorar MEGA: las carpetas y videos de toda la cuenta, también fuera de la biblioteca.
 */

import { state, index, knownEps } from '../models/store.js';
import { app, header } from './components.js';
import { visibleChildren } from '../models/mega.js';
import { nodePath, isPlayable, makeEpisode } from '../models/library.js';
import { sortEpisodes } from '../models/naming.js';
import { esc, plural, fmtSize } from '../lib/util.js';
import { ICON } from './icons.js';
import { episodeRow } from './episodes.js';
import { isSubtitleName } from '../models/naming.js';

export function renderExplorer(arg) {
  const st = state.storage;
  if (!st) {
    app.innerHTML =
      header('Explorar') +
      `<main><section class="empty">
      <p class="dim">${navigator.onLine ? 'Conectando con MEGA…' : 'Explorar necesita conexión. Lo que descargaste está en Descargados.'}</p>
      ${navigator.onLine ? '' : '<a class="btn" href="#/descargas">Ver descargados</a>'}</section></main>`;
    return;
  }
  let node = (arg && st.files[arg]) || st.root;
  if (!node.directory) node = node.parent || st.root;
  const crumbs = [];
  for (let n = node; n; n = n.parent) crumbs.unshift(n);
  const kids = visibleChildren(node).filter((c) => !c.name.startsWith('.'));
  const folders = kids.filter((c) => c.directory).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  const here = nodePath(node);
  const videos = sortEpisodes(kids.filter(isPlayable).map((f) => index.byId.get(f.nodeId)?.ep || makeEpisode(f, here)));
  videos.forEach((v) => {
    if (!index.byId.has(v.id)) knownEps.set(v.id, v);
  });
  const others = kids
    .filter((c) => !c.directory && !isPlayable(c))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  const isRoot = node === st.root;
  const isLibrary = state.library && state.library.rootId === node.nodeId;

  app.innerHTML =
    header('Explorar') +
    `<main class="explorer">
    <nav class="crumbs" aria-label="Ubicación">${crumbs
      .map((n, i) =>
        i === crumbs.length - 1
          ? `<span aria-current="page">${esc(n === st.root ? 'Mi MEGA' : n.name)}</span>`
          : `<a href="#/explorar/${encodeURIComponent(n.nodeId)}">${esc(n === st.root ? 'Mi MEGA' : n.name)}</a>`,
      )
      .join('<span class="crumb-sep" aria-hidden="true">/</span>')}</nav>
    ${
      !isRoot
        ? `<div class="explorer-actions">${
            isLibrary
              ? '<p class="dim">Esta es tu carpeta de series.</p>'
              : `<button class="btn" data-act="set-root" data-id="${esc(node.nodeId)}">Usar como carpeta de series</button>`
          }</div>`
        : ''
    }
    ${!kids.length ? '<p class="empty dim">Carpeta vacía.</p>' : ''}
    ${
      folders.length
        ? `<ul class="files">${folders
            .map((f) => {
              const n = visibleChildren(f).filter((c) => !c.name.startsWith('.')).length;
              return `<li><a class="file-row" href="#/explorar/${encodeURIComponent(f.nodeId)}">
        <span class="file-icon">${ICON.folder}</span>
        <span class="file-text"><span class="file-name">${esc(f.name)}</span><span class="file-meta">${plural(n, 'elemento', 'elementos')}</span></span>
      </a></li>`;
            })
            .join('')}</ul>`
        : ''
    }
    ${videos.length ? `<ol class="episodes">${videos.map((ep) => episodeRow(ep)).join('')}</ol>` : ''}
    ${
      others.length
        ? `<ul class="files is-dim">${others
            .map(
              (f) => `<li class="file-row">
        <span class="file-icon">${ICON.file}</span>
        <span class="file-text"><span class="file-name">${esc(f.name)}</span><span class="file-meta">${isSubtitleName(f.name) ? 'Subtítulos, ' : ''}${fmtSize(f.size || 0)}</span></span>
      </li>`,
            )
            .join('')}</ul>`
        : ''
    }
  </main>`;
}
