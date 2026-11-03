// @ts-check
/*
 * lib/util.js — utilidades sin pantalla: localStorage con prefijo kai., texto seguro para HTML, tiempos y tamaños.
 */

/** @param {string} s @param {ParentNode} [el] @returns {any} */
export const $ = (s, el = document) => el.querySelector(s);

const PREFIX = 'kai.';
/** Copias que se pueden volver a traer de MEGA o de internet: se sueltan, en este orden, si no hay espacio. */
const SPARE_KEYS = [['discover'], ['syn', 'synSig'], ['meta', 'fichasSig']];

/** @param {string} k */
function removeRaw(k) {
  try {
    localStorage.removeItem(PREFIX + k);
  } catch {
    /* localStorage bloqueado (modo privado): no hay nada que quitar */
  }
}

/**
 * localStorage con prefijo "kai." y JSON. Nunca lanza: si no se puede leer devuelve el valor por omisión, y si no se
 * puede guardar devuelve false (antes fallaba sin avisar: por ejemplo, las burbujas de "nuevos" volvían al reabrir Kai).
 */
export const LS = {
  /** se tuvo que soltar alguna copia para que algo cupiera (se muestra en Ajustes) */
  freed: false,
  /** algo no se pudo guardar ni soltando copias */
  full: false,
  /**
   * @template T
   * @param {string} k
   * @param {T} [d]
   * @returns {T | any}
   */
  get(k, d) {
    try {
      const v = localStorage.getItem(PREFIX + k);
      return v ? JSON.parse(v) : d;
    } catch {
      return d;
    }
  },
  /** @param {string} k @param {unknown} v @returns {boolean} si se guardó */
  set(k, v) {
    const str = JSON.stringify(v);
    for (const spare of [null, ...SPARE_KEYS]) {
      if (spare) {
        if (spare.includes(k)) continue;
        spare.forEach(removeRaw);
      }
      try {
        localStorage.setItem(PREFIX + k, str);
        if (spare) LS.freed = true;
        return true;
      } catch {
        /* sin espacio: sigue soltando copias */
      }
    }
    LS.full = true;
    return false;
  },
  /** @param {string} k */
  del(k) {
    removeRaw(k);
  },
};

// La app se llamaba Yoru: se conserva la sesión y el progreso guardados con ese nombre.
try {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('yoru.')) continue;
    const old = localStorage.getItem(k);
    if (old !== null && localStorage.getItem(PREFIX + k.slice(5)) === null)
      localStorage.setItem(PREFIX + k.slice(5), old);
    localStorage.removeItem(k);
  }
} catch {
  /* localStorage bloqueado: no hay nada que migrar */
}

/** @type {Record<string, string>} */
const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Texto seguro para meter en HTML (también en atributos). @param {unknown} s */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => HTML_ESC[c]);

/** @param {number} ms @returns {Promise<void>} */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @template {(...a: any[]) => void} F
 * @param {F} fn @param {number} ms
 * @returns {(...a: Parameters<F>) => void}
 */
export const debounce = (fn, ms) => {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

/** Segundos → "1:02:05" o "2:05". @param {number | null | undefined} s */
export function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Lo que falta de un capítulo: "quedan 12 min". @param {{ t?: number, d?: number }} p */
export function fmtLeft(p) {
  const left = Math.max(0, (p.d || 0) - (p.t || 0));
  const m = Math.round(left / 60);
  return m <= 1 ? 'casi al final' : `quedan ${m} min`;
}

/** Minutos → "2 h 5 min" o "45 min". @param {number} m */
export const fmtWait = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

/** @param {number} b bytes */
export function fmtSize(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return Math.round(b / 1e6) + ' MB';
  return Math.max(1, Math.round(b / 1e3)) + ' KB';
}

/** Un tono (0–359) fijo para cada texto: el color de cada perfil o serie sin imagen. @param {unknown} str */
export function hue(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return h;
}

/**
 * JSON con las claves ordenadas: dos objetos con el mismo contenido dan el mismo texto (para saber si algo cambió).
 * @param {unknown} v
 * @returns {string}
 */
export function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    const o = /** @type {Record<string, unknown>} */ (v);
    return (
      '{' +
      Object.keys(o)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stable(o[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(v);
}

/** "1 capítulo", "3 capítulos". @param {number} n @param {string} one @param {string} many */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
