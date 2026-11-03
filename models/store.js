// @ts-check
/*
 * models/store.js — el estado de Kai que comparten todas las partes: biblioteca, perfil, progreso, fichas,
 * ajustes y descargas, y el índice de capítulos. Se carga de localStorage al abrir.
 */

import { LS } from '../lib/util.js';

/** @typedef {import('./types.js').Library} Library */
/** @typedef {import('./types.js').LibraryIndex} LibraryIndex */
/** @typedef {import('./types.js').ProgressMap} ProgressMap */
/** @typedef {import('./types.js').Profile} Profile */

/**
 * @typedef {object} Settings
 * @property {string} root        carpeta de la biblioteca en MEGA
 * @property {boolean} autoplay
 * @property {boolean} autoSkip
 * @property {'auto' | 'light' | 'dark'} theme
 * @property {string} [tone]      tono del modo claro
 * @property {string} [darkTone]  tono del modo oscuro
 * @property {boolean} [cat]      el gatito (false = apagado)
 */

/** Tonos del modo claro (el color de fondo sirve para la barra del sistema). */
export const DARK_TONES = { negro: { label: 'Negro', bg: '#0d0e12' }, gris: { label: 'Gris Culero', bg: '#4d4d4d' } };
export const TONES = {
  blanco: { label: 'Blanco', bg: '#eef0f4' },
  gris: { label: 'Gris', bg: '#c6c8cb' },
  celeste: { label: 'Celeste', bg: '#d9e5f0' },
  arena: { label: 'Arena', bg: '#e6e0d5' },
};
/** @type {Settings} */
export const DEFAULTS = { root: 'Anime', autoplay: true, autoSkip: true, theme: 'auto' };
export const FICHAS_FILE = '.kai-fichas.json'; // fichas de AniList/TMDB ya encontradas (así los demás no las buscan)
export const SYN_FILE = '.kai-sinopsis.json'; // sinopsis traducidas al español (se comparten entre dispositivos)
export const SHARED_FILE = '.kai-compartido.json'; // perfiles, intros aprendidas e imágenes elegidas
export const profileFile = (id) => `.kai-progreso-${id}.json`; // progreso de cada perfil
export const LEGACY_PROGRESS = ['.kai-progreso.json', '.yoru-progreso.json'];

/**
 * Todo lo que Kai tiene en memoria. Es un solo objeto compartido: las partes leen y cambian sus campos.
 * @type {{
 *   syn: Record<string, { es: string, u: number }>, synDirty: boolean,
 *   storage: any, connecting: boolean,
 *   library: Library | null, profile: Profile | null,
 *   shared: { profiles: Profile[], intros: Record<string, any>, picks: Record<string, any>, legacyBy: any, keys?: any },
 *   sharedLoaded: boolean, sharedError: boolean,
 *   meta: Record<string, any>,
 *   progress: ProgressMap, dirty: boolean,
 *   settings: Settings & Record<string, any>,
 *   saved: Set<string>, dlMeta: Map<string, any>, dls: Record<string, any>, queue: any[],
 *   error: any, syncState: string,
 * }}
 */
export const state = {
  syn: LS.get('syn', {}) || {}, // sinopsis en español por id de AniList: { es, u }
  synDirty: false,
  storage: null,
  connecting: false,
  library: LS.get('library', null),
  profile: LS.get('profile', null),
  shared: { profiles: [], intros: {}, picks: {}, legacyBy: null, ...LS.get('shared', {}) },
  sharedLoaded: LS.get('sharedLoaded', false),
  sharedError: false,
  meta: LS.get('meta', {}),
  progress: {},
  dirty: false,
  settings: { ...DEFAULTS, ...LS.get('settings', {}) },
  saved: new Set(), // descargados completos
  dlMeta: new Map(), // id -> metadatos guardados de la descarga
  dls: {}, // descargas en curso: id -> { loaded, total, ctrl }
  queue: [], // descargas en espera: [{ ep, title }]
  error: null,
  syncState: 'idle',
};

/** Índice de la biblioteca: capítulos por id y por ruta, y las versiones en el otro idioma de cada uno.
 *  Es un solo objeto que todos comparten; al rearmarlo se cambia su contenido con setIndex. */
/** @type {LibraryIndex} */
export const index = { byId: new Map(), byPath: new Map(), twins: new Map() };
/** @param {LibraryIndex} x */
export function setIndex(x) {
  index.byId = x.byId;
  index.byPath = x.byPath;
  index.twins = x.twins;
}
export const knownEps = new Map(); // capítulos vistos fuera de la biblioteca (explorar, descargados)

// nada descargado se borra solo: se quita a mano desde Descargados (pedido de Alex, v11)
delete state.settings.autoRemoveLocal;

export function saveSettings() {
  LS.set('settings', state.settings);
}

export const pkey = (k) => `p.${state.profile ? state.profile.id : '_'}.${k}`;

export function saveProgressLocal() {
  if (!state.profile) return;
  LS.set(pkey('progress'), state.progress);
  LS.set(pkey('dirty'), state.dirty);
}
export function saveShared() {
  LS.set('shared', state.shared);
}
export const visibleProfiles = () => state.shared.profiles.filter((p) => !p.deleted);
