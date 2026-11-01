/*
 * lib/util.js — utilidades sin pantalla: localStorage con prefijo kai., texto seguro para HTML, tiempos y tamaños.
 */

export const $ = (s, el = document) => el.querySelector(s);

export const LS = {
  get(k, d) { try { const v = localStorage.getItem('kai.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  // si el navegador se queda sin espacio, se sueltan copias que se pueden volver a traer de MEGA o de internet
  // (antes fallaba sin avisar: por ejemplo, las burbujas de "nuevos" volvían al reabrir Kai)
  set(k, v) {
    const str = JSON.stringify(v);
    for (const spare of [null, ['discover'], ['syn', 'synSig'], ['meta', 'fichasSig']]) {
      if (spare) { if (spare.includes(k)) continue; spare.forEach((x) => { try { localStorage.removeItem('kai.' + x); } catch { /* nada */ } }); }
      try { localStorage.setItem('kai.' + k, str); if (spare) LS.freed = true; return true; } catch { /* sigue liberando */ }
    }
    LS.full = true;
    return false;
  },
  del(k) { try { localStorage.removeItem('kai.' + k); } catch { /* nada */ } },
};

// La app se llamaba Yoru: se conserva la sesión y el progreso guardados con ese nombre.
try {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('yoru.') && localStorage.getItem('kai.' + k.slice(5)) === null) localStorage.setItem('kai.' + k.slice(5), localStorage.getItem(k));
    if (k.startsWith('yoru.')) localStorage.removeItem(k);
  }
} catch { /* nada */ }

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
export function fmtLeft(p) {
  const left = Math.max(0, (p.d || 0) - (p.t || 0));
  const m = Math.round(left / 60);
  return m <= 1 ? 'casi al final' : `quedan ${m} min`;
}
export function fmtSize(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return Math.round(b / 1e6) + ' MB';
  return Math.max(1, Math.round(b / 1e3)) + ' KB';
}
export function hue(str) {
  let h = 0;
  for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
