// @ts-check
/*
 * models/fichas-sync.js — conseguir las fichas que faltan y compartirlas:
 *  - ensureMeta busca en AniList (o TMDB para Cine) lo que no tiene ficha, de a una y sin pasar el límite de AniList.
 *  - translateMissing traduce las sinopsis al español donde el navegador puede (Chrome de computadora).
 *  - syncFichas y syncSynopses juntan lo de aquí con .kai-fichas.json y .kai-sinopsis.json en MEGA, así los demás
 *    dispositivos no vuelven a buscar ni traducir. Si el archivo no se puede leer, no se toca (nunca se pisa).
 *
 * Avisos: "meta-changed" (con las vistas donde se nota: hay que redibujar si estás en una) y "sync-needed".
 */

import { isBareSpecial, hasOwnTitle, SPECIAL_RE, seasonOrdinal, isSpecialSeason } from './naming.js';
import { isCollection, collectionItems, itemMetaKey, isCine } from './collections.js';
import { state, SYN_FILE, FICHAS_FILE } from './store.js';
import {
  scoresByIds,
  tmdbFindMovie,
  findMovie,
  toMeta,
  findTitle,
  findSeason,
  translateToSpanish,
  findForSeries,
  sideStoriesOf,
  canTranslate,
} from './meta-api.js';
import { sleep, LS } from '../lib/util.js';
import { emit } from '../lib/events.js';
import { filesNamed, readJson, writeJson } from './mega.js';
import {
  usesSeasonMeta,
  isFranchise,
  saveMeta,
  flushMetaNow,
  tmdbKey,
  ownSeasonMeta,
  seasonLabel,
  metaFor,
  isMainSeason,
} from './fichas.js';

const DAY = 86400000;
/** Lo encontrado dura 30 días; lo que no se encontró se vuelve a buscar al día siguiente. @param {any} c */
const isFresh = (c) => {
  const age = Date.now() - ((c && c.at) || 0);
  return c.none ? age < DAY : age < 30 * DAY;
};
/** Ficha nueva (o la marca de "no se encontró"), con la versión de cómo se buscó. @param {any} m @param {object} mark */
const newMeta = (m, mark) => (m ? { ...toMeta(m), ...mark } : { none: true, id: 0, ...mark, at: Date.now() });
/** Traduce la sinopsis en segundo plano y avisa cuando está. @param {any} meta @param {string[]} views */
function translateLater(meta, views) {
  translateToSpanish(meta.synopsis).then((es) => {
    if (!es) return;
    meta.synopsisEs = es;
    saveMeta();
    emit('meta-changed', views);
  });
}

/** Lo que se busca en AniList para una temporada, o null si usa la ficha de la serie. */
export function seasonQuery(s, se) {
  if (isBareSpecial(s, se)) return { ovaOf: s.seasons.indexOf(se) };
  if (hasOwnTitle(se)) {
    const t = se.title;
    const kind = /\b(pel[ií]culas?|movies?|films?|gekijouban)\b/i.test(t) ? 'movie' : SPECIAL_RE.test(t) ? 'ova' : 'tv';
    // "(Película)", "[OVA]"… solo dicen el tipo: no se buscan
    const name = t
      .replace(/[([][^)\]]*[)\]]/g, (x) => (SPECIAL_RE.test(x) ? ' ' : x))
      .replace(/\s+/g, ' ')
      .trim();
    return { name: name || t, kind };
  }
  const n = seasonOrdinal(s, se);
  return n != null && n > 1 && !isSpecialSeason(se) ? { series: s.name, n } : null;
}

let metaRunning = false;
/** ¿Ya tiene ficha guardada (encontrada o no) todo lo que se busca de esta serie? */
export function hasAllMeta(s) {
  if (isCollection(s)) return collectionItems(s).every((it) => state.meta[itemMetaKey(s, it.key)]);
  const seasonsOk =
    !usesSeasonMeta(s) || s.seasons.every((se) => !seasonQuery(s, se) || state.meta[itemMetaKey(s, se.name)]);
  return seasonsOk && (isFranchise(s) || !!state.meta[s.name]);
}
export async function ensureMeta() {
  if (metaRunning || !navigator.onLine || !state.library || !state.library.series) return;
  metaRunning = true;
  let changed = false;
  try {
    // antes de buscar nada, lo que otros dispositivos ya encontraron (si MEGA no responde, se busca igual)
    if (!fichasPulled && state.storage) {
      try {
        await syncFichas(state.storage.root, false);
      } catch (err) {
        console.warn('fichas', err);
        fichasPulled = true;
      }
    }
    // 1) las fichas guardadas antes de la v29 no traían la nota: se pide solo la nota, todas juntas (1–2 pedidos),
    //    en vez de volver a buscar cada serie y película (eso agotaba el límite de AniList y dejaba otras sin ficha)
    const old = Object.values(state.meta).filter(
      (m) => m && !m.none && typeof m.id === 'number' && m.src !== 'TMDB' && ((m.sv && m.sv < 6) || (m.mv && m.mv < 5)),
    );
    if (old.length) {
      try {
        const sc = await scoresByIds([...new Set(old.map((m) => m.id))]);
        for (const m of old) {
          if (m.id in sc) m.score = sc[m.id];
          if (m.sv) m.sv = 6;
          if (m.mv) m.mv = 5;
        }
        changed = true;
        saveMeta();
      } catch (err) {
        console.warn('anilist notas', err);
      }
    }
    // 2) primero lo que todavía no tiene ficha (p. ej. temporadas recién organizadas), después el resto
    const order = [...state.library.series].sort((a, b) => Number(hasAllMeta(a)) - Number(hasAllMeta(b)));
    for (const s of order) {
      if (isCine(s)) {
        // Cine: cada película en TMDB (sin clave no se busca nada)
        const key = tmdbKey();
        if (!key) continue;
        for (const it of collectionItems(s)) {
          const k = itemMetaKey(s, it.key);
          const c = state.meta[k];
          if (c && c.tm === 1 && c.key === key.slice(-6) && isFresh(c)) continue;
          let m = null;
          try {
            if (it.query) m = await tmdbFindMovie(it.query, key);
          } catch (err) {
            console.warn('tmdb', err);
            break;
          }
          state.meta[k] = m
            ? { ...m, tm: 1, key: key.slice(-6) }
            : { none: true, id: 0, tm: 1, key: key.slice(-6), at: Date.now() };
          changed = true;
          saveMeta();
          await sleep(250);
        }
        continue;
      }
      if (isCollection(s)) {
        // cada película por separado; la carpeta no se busca
        let failed = false;
        for (const it of collectionItems(s)) {
          const k = itemMetaKey(s, it.key);
          const c = state.meta[k];
          if (c && c.mv === 5 && isFresh(c)) continue;
          let m = null;
          try {
            if (it.query) m = await findMovie(it.query, () => sleep(400));
          } catch (err) {
            console.warn('anilist', err);
            failed = true;
            break;
          }
          state.meta[k] = newMeta(m, { mv: 5 });
          changed = true;
          saveMeta();
          await sleep(400);
        }
        if (failed) break;
        continue;
      }
      if (usesSeasonMeta(s)) {
        // cada temporada con su ficha (sm: 1); lo encontrado dura 30 días, lo no encontrado se reintenta al día siguiente
        let failed = false;
        for (const se of s.seasons) {
          const q = seasonQuery(s, se);
          if (!q || q.ovaOf != null) continue; // las OVAs a secas, al final (necesitan la ficha de la temporada de antes)
          const k = itemMetaKey(s, se.name);
          const c = state.meta[k];
          // las que dicen número de temporada o "Serie - Subtítulo" se buscan de nuevo una vez (v36 las encuentra mejor)
          const need = /\b(season|temporada)\b|\d(st|nd|rd|th)\b|\s[-–]\s/i.test(se.name) ? 2 : 1;
          if (c && (c.sm || 0) >= need && isFresh(c)) continue;
          let m = null;
          try {
            m = q.name ? await findTitle(q.name, q.kind, () => sleep(400)) : await findSeason(q.series, q.n);
          } catch (err) {
            console.warn('anilist', err);
            failed = true;
            break;
          }
          state.meta[k] = newMeta(m, { sm: 2 });
          if (m) translateLater(state.meta[k], ['home', 'serie']);
          changed = true;
          saveMeta();
          await sleep(400);
        }
        if (failed) break;
        if (!isFranchise(s)) {
          // "Fate": la carpeta de la serie no se busca
          const r = await seriesMetaStep(s);
          if (r === 'fail') break;
          if (r) changed = true;
        }
        const r2 = await ovaMetaStep(s);
        if (r2 === 'fail') break;
        if (r2) changed = true;
        continue;
      }
      const r = await seriesMetaStep(s);
      if (r === 'fail') break;
      if (r) changed = true;
    }
  } finally {
    metaRunning = false;
  }
  if (changed) {
    fichasDirty = true;
    emit('sync-needed');
  }
  if (changed) emit('meta-changed', ['home', 'serie', 'pelicula']);
  setTimeout(translateMissing, 1500);
}

/** Ficha de la serie (con el nombre de la carpeta). Devuelve true si cambió, 'fail' si AniList falló. */
async function seriesMetaStep(s) {
  const cur = state.meta[s.name];
  // sv: 6 = buscada solo con el nombre de la carpeta, con la nota de AniList (las de antes se vuelven a buscar una vez)
  const stale = !cur || !isFresh(cur) || (!cur.none && cur.v !== 2) || cur.sv !== 6;
  if (!stale) return false;
  try {
    const m = await findForSeries([s.name], s.name);
    state.meta[s.name] = newMeta(m, { sv: 6 });
    if (m) translateLater(state.meta[s.name], ['home', 'serie', 'pelicula']);
    saveMeta();
  } catch (err) {
    console.warn('anilist', err);
    return 'fail';
  }
  await sleep(400);
  return true;
}

/** OVAs a secas ("OVA", "Serie OVA"): entre las OVAs y especiales de la temporada de antes (o, si no hay, de las otras),
 *  sin repetir la que ya tiene otra carpeta; si alguna tiene los mismos capítulos que la carpeta, esa. */
async function ovaMetaStep(s) {
  let changed = false;
  for (const se of s.seasons) {
    const q = seasonQuery(s, se);
    if (!q || q.ovaOf == null) continue;
    const k = itemMetaKey(s, se.name);
    const c = state.meta[k];
    if (c && (c.sm || 0) >= 3 && isFresh(c)) continue;
    const ki = q.ovaOf;
    const idOf = (x) => {
      const m = ownSeasonMeta(s, x) || (seasonLabel(s, x) === 'Temporada 1' && !isFranchise(s) ? metaFor(s) : null);
      return m && typeof m.id === 'number' && m.id ? m.id : 0;
    };
    const bases = [...s.seasons.slice(0, ki).reverse(), ...s.seasons.slice(ki + 1)]
      .filter((x) => isMainSeason(s, x))
      .map(idOf)
      .filter(Boolean);
    const used = new Set(
      s.seasons
        .filter((x) => x !== se)
        .map((x) => ownSeasonMeta(s, x))
        .filter(Boolean)
        .map((m) => m.id),
    );
    let m = null;
    try {
      for (const id of [...new Set(bases)]) {
        const list = (await sideStoriesOf(id)).filter((x) => !used.has(x.id));
        if (list.length) {
          m = list.find((x) => x.episodes === se.episodes.length) || list[0];
          break;
        }
        await sleep(400);
      }
    } catch (err) {
      console.warn('anilist', err);
      return 'fail';
    }
    state.meta[k] = newMeta(m, { sm: 3 });
    if (m) translateLater(state.meta[k], ['home', 'serie']);
    changed = true;
    saveMeta();
    await sleep(400);
  }
  return changed;
}

/* ── sinopsis en español compartidas ──
 * Solo Chrome de computadora trae traductor. Donde lo hay, Kai traduce en segundo plano, de una en una, las sinopsis
 * que falten y las guarda en MEGA (.kai-sinopsis.json); los demás dispositivos las leen de ahí ya traducidas. */
export function saveSyn() {
  LS.set('syn', state.syn);
}
let synRunning = false;
export async function translateMissing() {
  if (synRunning || !canTranslate()) return;
  synRunning = true;
  let added = 0;
  try {
    const disc = LS.get('discover', {}) || {};
    const extra = Object.values(disc).flatMap((d) => (d && d.items) || []);
    for (const m of [...Object.values(state.meta), ...extra]) {
      if (!m || m.none || !m.id || m.src === 'TMDB') continue; // lo de TMDB ya viene en español
      if (state.syn[m.id]) continue;
      // lo que este navegador ya había traducido antes también se comparte
      let es = m.synopsisEs || null;
      if (!es && m.synopsis) {
        if (document.hidden) break;
        es = await translateToSpanish(m.synopsis);
        if (!es) break; // el traductor no está listo (se activa la primera vez con el botón "Traducir")
        await sleep(250);
      }
      if (!es) continue;
      state.syn[m.id] = { es, u: Date.now() };
      added++;
      if (added % 10 === 0) {
        saveSyn();
        state.synDirty = true;
      }
    }
  } finally {
    synRunning = false;
    if (added) {
      saveSyn();
      state.synDirty = true;
      emit('sync-needed');
      emit('meta-changed', ['home', 'serie', 'pelicula']);
    }
  }
}
/** Junta las traducciones de MEGA con las de aquí. Si el archivo no se puede leer, no se toca (nunca se pisa). */
export async function syncSynopses(home) {
  const nodes = filesNamed(home, SYN_FILE);
  const sig = nodes.map((n) => `${n.nodeId}:${n.size}:${n.timestamp || 0}`).join('|');
  /** @type {Record<string, any> | null} */
  let remote = {};
  const known = LS.get('synSig', '');
  if (sig && sig !== known) {
    for (const n of nodes) {
      const d = await readJson(n);
      if (d && d.items) remote = mergeSyn(remote, d.items);
    }
    const before = Object.keys(state.syn).length;
    state.syn = mergeSyn(state.syn, remote);
    saveSyn();
    LS.set('synSig', sig);
    if (Object.keys(state.syn).length !== before) emit('meta-changed', ['home', 'serie', 'pelicula']);
  } else if (sig) {
    remote = null; // sin cambios en MEGA desde la última vez
  }
  const needWrite =
    Object.keys(state.syn).length &&
    (state.synDirty ||
      nodes.length > 1 ||
      !nodes.length ||
      (remote && Object.keys(state.syn).some((k) => !remote[k] || state.syn[k].u > remote[k].u)));
  if (needWrite) {
    const fresh = await writeJson(home, SYN_FILE, { v: 1, app: 'kai', items: state.syn }, nodes);
    state.synDirty = false;
    // la firma del archivo recién subido: así este dispositivo no lo vuelve a descargar
    if (fresh && fresh.nodeId) LS.set('synSig', `${fresh.nodeId}:${fresh.size}:${fresh.timestamp || 0}`);
    else LS.del('synSig');
  }
}
/* ── fichas compartidas ──
 * Lo que un dispositivo encuentra en AniList (o TMDB) se guarda en MEGA (.kai-fichas.json): los demás dispositivos
 * y perfiles lo usan sin volver a buscar. Gana la ficha más reciente (marca "at"). Si el archivo no se puede leer,
 * no se toca (nunca se pisa). */
let fichasDirty = false;
let fichasPulled = false;
/** Al salir de la cuenta: las fichas se vuelven a leer de MEGA al entrar. */
export function resetFichas() {
  fichasPulled = false;
}
export async function syncFichas(home, write = true) {
  const nodes = filesNamed(home, FICHAS_FILE);
  const sig = nodes.map((n) => `${n.nodeId}:${n.size}:${n.timestamp || 0}`).join('|');
  let remote = null;
  if (sig && sig !== LS.get('fichasSig', '')) {
    remote = {};
    for (const n of nodes) {
      const d = await readJson(n);
      if (d && d.items) remote = mergeFichas(remote, d.items);
    }
    const before = JSON.stringify(Object.keys(state.meta).map((k) => [k, (state.meta[k] || {}).at]));
    state.meta = mergeFichas(state.meta, remote);
    flushMetaNow();
    LS.set('fichasSig', sig);
    if (JSON.stringify(Object.keys(state.meta).map((k) => [k, (state.meta[k] || {}).at])) !== before)
      emit('meta-changed', ['home', 'serie', 'pelicula', 'catalogo']);
  }
  fichasPulled = true;
  if (!write) return;
  const newer =
    remote &&
    Object.keys(state.meta).some((k) => state.meta[k] && (!remote[k] || (state.meta[k].at || 0) > (remote[k].at || 0)));
  if (Object.keys(state.meta).length && (fichasDirty || nodes.length !== 1 || newer)) {
    fichasDirty = false;
    const fresh = await writeJson(home, FICHAS_FILE, { v: 1, app: 'kai', items: state.meta }, nodes);
    if (fresh && fresh.nodeId) LS.set('fichasSig', `${fresh.nodeId}:${fresh.size}:${fresh.timestamp || 0}`);
    else LS.del('fichasSig');
  }
}
export function mergeFichas(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {}))
    if (v && typeof v === 'object' && (!out[k] || (v.at || 0) > (out[k].at || 0))) out[k] = v;
  return out;
}

export function mergeSyn(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) if (v && v.es && (!out[k] || (v.u || 0) > (out[k].u || 0))) out[k] = v;
  return out;
}
