// @ts-check
/*
 * models/types.js — la forma de los datos de Kai, para el chequeo de tipos (JSDoc).
 * No tiene código: ningún módulo lo importa al ejecutarse, solo los comentarios lo nombran.
 */

/** @typedef {'sub' | 'dob'} Lang */

/**
 * Subtítulo suelto (.srt/.vtt/.ass) junto a un capítulo.
 */

/**
 * Capítulo (un archivo de video en MEGA).
 * @typedef {object} Episode
 * @property {string} id       id del nodo de MEGA (no cambia al renombrar o mover)
 * @property {string} name     nombre del archivo ("472_5_SUB.mp4")
 * @property {string} path     ruta desde la raíz de MEGA; es la clave del progreso
 * @property {number | null} ep número de capítulo, si el nombre lo dice
 * @property {number} size
 * @property {string} key      clave del archivo (base64url)
 * @property {string | null} fa atributo de miniatura de MEGA
 * @property {string} mime
 * @property {number} ts       cuándo llegó a MEGA (segundos)
 * @property {SideFile} [art]  imagen con el mismo nombre (su miniatura)
 * @property {SideFile} [note] .txt con el mismo nombre (su descripción)
 * @property {Lang | null} [lang] idioma (lo pone buildIndex)
 */

/**
 * Temporada (una carpeta dentro de la serie; num null = capítulos sueltos en la carpeta de la serie).
 * @typedef {object} Season
 * @property {number | null} num   número del inicio de la carpeta: decide el orden
 * @property {string} title        el nombre sin el número
 * @property {string} name         nombre completo de la carpeta ('' para los sueltos)
 * @property {Episode[]} episodes  los que se muestran (un solo idioma por capítulo)
 * @property {Episode[]} [full]    todos, cuando hay capítulos en Sub y en Doblado
 * @property {Lang[] | null} [langs] idiomas, cuando hay capítulos en los dos
 */

/**
 * Serie (o colección: Peliculas, Cine).
 * @typedef {object} Series
 * @property {string} name
 * @property {string} folderId
 * @property {Season[]} seasons
 * @property {number} added    el capítulo más nuevo (segundos)
 * @property {Episode[]} [all]  los que se muestran de todas las temporadas (lo pone buildIndex)
 * @property {Episode[]} [full] todos los de todas las temporadas, en los dos idiomas (lo pone buildIndex)
 * @property {Lang[]} [langs]
 */

/**
 * @typedef {object} Library
 * @property {string} root    carpeta de la biblioteca ("Anime")
 * @property {string} rootId
 * @property {2} v
 * @property {Series[]} series
 * @property {number} updated
 */

/**
 * Dónde está cada capítulo: serie (si), temporada (ki) y puesto en la lista que se muestra (ei; -1 si está oculto).
 * @typedef {{ ep: Episode, si: number, ki: number, ei: number }} IndexEntry
 */

/**
 * @typedef {object} LibraryIndex
 * @property {Map<string, IndexEntry>} byId
 * @property {Map<string, IndexEntry>} byPath
 * @property {Map<string, string[]>} twins  ruta → rutas del mismo capítulo en el otro idioma
 */

/**
 * Progreso de un capítulo para un perfil.
 * @typedef {object} Progress
 * @property {number} [t] segundo donde se quedó
 * @property {number} [d] duración
 * @property {number} u   cuándo cambió (ms): en las fusiones gana el más reciente
 * @property {boolean} [on] solo en "@later/…": está en Más tarde
 * @property {boolean} [w] visto
 * @property {string} [p]   solo en "@now": ruta del capítulo que se está viendo
 * @property {string} [dev] solo en "@now": id del dispositivo
 * @property {string} [dn]  solo en "@now": nombre del dispositivo ("iPhone")
 */

/** @typedef {Record<string, Progress>} ProgressMap */

/** @typedef {{ id: string, key: string, size: number }} SideFile un archivo de MEGA que acompaña a un video */
/** @typedef {{ hold?: number, step?: number }} ProfilePrefs lo del reproductor que elige cada perfil */
/** @typedef {{ id: string, name: string, deleted?: boolean, u?: number, prefs?: ProfilePrefs }} Profile */

/**
 * Nodo del árbol de MEGA (megajs), solo lo que Kai usa.
 * @typedef {object} MegaNode
 * @property {string} name
 * @property {string} nodeId
 * @property {boolean} [directory]
 * @property {MegaNode[]} [children]
 * @property {MegaNode | null} [parent]
 * @property {ArrayLike<number>} [key]
 * @property {number} [size]
 * @property {number} [timestamp]
 * @property {string} [fa]
 */

export {};
