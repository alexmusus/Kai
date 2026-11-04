// @ts-check
/*
 * models/mp4.js — lo que Kai lee de adentro de un MP4 sin descargarlo entero (solo el índice, la caja moov, y los
 * pedacitos que hacen falta): el formato del video y del audio, el idioma del audio y los capítulos (para saltar
 * la intro).
 */

/** Limpia el texto de una muestra de una pista de texto (los títulos de capítulos vienen así). */
function cleanVttText(t) {
  return t
    .replace(/\{\\[^}]*\}/g, '') // {\an8} que vienen de ASS
    .replace(/<(?!\/?(i|b|u)\b)[^>]+>/gi, '') // deja solo <i>, <b>, <u>
    .replace(/\r/g, '')
    .trim();
}

/* ───────── MP4 ───────── */

const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u16 = (b, o) => (b[o] << 8) + b[o + 1];
const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

function* boxes(b, start, end) {
  let p = start;
  while (p + 8 <= end) {
    let size = u32(b, p);
    const type = fourcc(b, p + 4);
    let hdr = 8;
    if (size === 1) {
      size = u64(b, p + 8);
      hdr = 16;
    } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) return;
    yield { type, start: p + hdr, end: p + size };
    p += size;
  }
}
function child(b, box, type) {
  for (const c of boxes(b, box.start, box.end)) if (c.type === type) return c;
  return null;
}
function path(b, box, ...types) {
  let cur = box;
  for (const t of types) {
    cur = cur && child(b, cur, t);
  }
  return cur;
}

/** Busca la caja moov leyendo solo cabeceras. `read(inicio, finInclusivo)` → Uint8Array */
async function readMoov(read, size) {
  let pos = 0;
  for (let guard = 0; pos + 8 <= size && guard < 64; guard++) {
    const h = await read(pos, Math.min(size - 1, pos + 15));
    let boxSize = u32(h, 0);
    const type = fourcc(h, 4);
    if (boxSize === 1) boxSize = u64(h, 8);
    else if (boxSize === 0) boxSize = size - pos;
    if (type === 'moov') {
      if (boxSize > 64 * 1024 * 1024) return null;
      return read(pos, pos + boxSize - 1);
    }
    if (boxSize < 8) return null;
    pos += boxSize;
  }
  return null;
}

function lang3(packed) {
  if (!packed || packed === 0x7fff) return 'und';
  return String.fromCharCode(((packed >> 10) & 31) + 0x60, ((packed >> 5) & 31) + 0x60, (packed & 31) + 0x60);
}

function sampleTable(b, stbl) {
  const stsz = child(b, stbl, 'stsz');
  const stco = child(b, stbl, 'stco');
  const co64 = child(b, stbl, 'co64');
  const stsc = child(b, stbl, 'stsc');
  const stts = child(b, stbl, 'stts');
  if (!stsz || !(stco || co64) || !stsc || !stts) return [];

  const fixed = u32(b, stsz.start + 4);
  const count = u32(b, stsz.start + 8);
  const sizes = new Array(count);
  for (let i = 0; i < count; i++) sizes[i] = fixed || u32(b, stsz.start + 12 + i * 4);

  const chunks = [];
  if (stco) {
    const n = u32(b, stco.start + 4);
    for (let i = 0; i < n; i++) chunks.push(u32(b, stco.start + 8 + i * 4));
  } else {
    const box = /** @type {NonNullable<typeof co64>} */ (co64); // sin stco, hay co64 (se revisó arriba)
    const n = u32(b, box.start + 4);
    for (let i = 0; i < n; i++) chunks.push(u64(b, box.start + 8 + i * 8));
  }

  const sc = [];
  const nsc = u32(b, stsc.start + 4);
  for (let i = 0; i < nsc; i++) sc.push([u32(b, stsc.start + 8 + i * 12), u32(b, stsc.start + 12 + i * 12)]);

  const durs = [];
  const nts = u32(b, stts.start + 4);
  for (let i = 0; i < nts; i++) {
    const c = u32(b, stts.start + 8 + i * 8);
    const d = u32(b, stts.start + 12 + i * 8);
    for (let k = 0; k < c && durs.length < count; k++) durs.push(d);
  }

  const out = [];
  let s = 0;
  let t = 0;
  for (let ci = 0; ci < chunks.length && s < count; ci++) {
    let per = 0;
    for (let k = sc.length - 1; k >= 0; k--)
      if (ci + 1 >= sc[k][0]) {
        per = sc[k][1];
        break;
      }
    let off = chunks[ci];
    for (let k = 0; k < per && s < count; k++, s++) {
      out.push({ off, size: sizes[s], t, d: durs[s] || 0 });
      off += sizes[s];
      t += durs[s] || 0;
    }
  }
  return out;
}

function trackId(b, trak) {
  const tkhd = child(b, trak, 'tkhd');
  if (!tkhd) return 0;
  return b[tkhd.start] === 1 ? u32(b, tkhd.start + 20) : u32(b, tkhd.start + 12);
}

/** Capítulos estilo Nero (caja chpl): [{ t, title }] */
function neroChapters(b, root) {
  const chpl = path(b, root, 'udta', 'chpl');
  if (!chpl) return null;
  const n = b[chpl.start + 8];
  const out = [];
  let p = chpl.start + 9;
  for (let i = 0; i < n && p + 9 <= chpl.end; i++) {
    const t = u64(b, p) / 1e7;
    const len = b[p + 8];
    const title = new TextDecoder().decode(b.subarray(p + 9, p + 9 + len)).trim();
    out.push({ t, title });
    p += 9 + len;
  }
  return out.length ? out : null;
}

/**
 * Lee el índice de un MP4: los capítulos (de la caja chpl, o la pista de texto que los trae: "Intro", "Parte A"…) y
 * el idioma del primer audio (sirve para saber si está doblado).
 */
export async function mp4Info(read, size) {
  const moov = await readMoov(read, size);
  if (!moov) return { chapters: null, chapterTrack: null, audioLang: '' };
  const root = { start: 8, end: moov.length };
  const chapterIds = new Set();
  for (const trak of boxes(moov, root.start, root.end)) {
    if (trak.type !== 'trak') continue;
    const chap = path(moov, trak, 'tref', 'chap');
    if (chap) for (let p = chap.start; p + 4 <= chap.end; p += 4) chapterIds.add(u32(moov, p));
  }
  let chapterTrack = null;
  let audioLang = '';
  for (const trak of boxes(moov, root.start, root.end)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(moov, trak, 'mdia');
    const hdlr = mdia && child(moov, mdia, 'hdlr');
    const mdhd = mdia && child(moov, mdia, 'mdhd');
    if (!hdlr || !mdhd) continue;
    const v = moov[mdhd.start];
    const handler = fourcc(moov, hdlr.start + 8);
    if (handler === 'soun') {
      if (!audioLang) audioLang = lang3(v === 1 ? u16(moov, mdhd.start + 32) : u16(moov, mdhd.start + 20));
      continue;
    }
    if (chapterTrack || !chapterIds.has(trackId(moov, trak))) continue;
    if (!['text', 'sbtl', 'subt'].includes(handler)) continue;
    const stbl = path(moov, mdia, 'minf', 'stbl');
    const stsd = stbl && child(moov, stbl, 'stsd');
    if (!stsd) continue;
    const codec = fourcc(moov, stsd.start + 12);
    if (!['tx3g', 'wvtt', 'text'].includes(codec)) continue;
    const timescale = v === 1 ? u32(moov, mdhd.start + 20) : u32(moov, mdhd.start + 12);
    chapterTrack = { codec, timescale: timescale || 1000, samples: sampleTable(moov, stbl).filter((s) => s.size > 2) };
  }
  return { chapters: neroChapters(moov, root), chapterTrack, audioLang };
}

/** Formato real del video y del audio, leído del encabezado del MP4 (para explicar por qué no se reproduce). */
export async function mp4Formats(read, size) {
  const moov = await readMoov(read, size);
  if (!moov) return null;
  /** @type {{ video: any, audio: any }} */
  const out = { video: null, audio: null };
  for (const trak of boxes(moov, 8, moov.length)) {
    if (trak.type !== 'trak') continue;
    const mdia = child(moov, trak, 'mdia');
    const hdlr = mdia && child(moov, mdia, 'hdlr');
    const stsd = mdia && path(moov, mdia, 'minf', 'stbl', 'stsd');
    if (!hdlr || !stsd) continue;
    const handler = fourcc(moov, hdlr.start + 8);
    const entry = stsd.start + 8; // versión/banderas (4) y número de entradas (4)
    const entryEnd = Math.min(stsd.end, entry + u32(moov, entry));
    const codec = fourcc(moov, entry + 4);
    const find = (type, from) => {
      for (const c of boxes(moov, from, entryEnd)) if (c.type === type) return c;
      return null;
    };
    if (handler === 'vide' && !out.video) {
      const v = { codec, bits: 8, profile: 0 };
      const kids = entry + 8 + 78; // la entrada de video tiene 78 bytes fijos antes de sus cajas
      if (/^avc[13]$/.test(codec)) {
        const c = find('avcC', kids);
        if (c) {
          v.profile = moov[c.start + 1];
          if ([110, 122, 244].includes(v.profile)) v.bits = 10;
        }
      } else if (/^(hev1|hvc1)$/.test(codec)) {
        const c = find('hvcC', kids);
        if (c) {
          v.profile = moov[c.start + 1] & 0x1f;
          v.bits = (moov[c.start + 17] & 7) + 8;
        }
      } else if (codec === 'av01') {
        const c = find('av1C', kids);
        if (c) v.bits = moov[c.start + 2] & 0x40 ? (moov[c.start + 2] & 0x20 ? 12 : 10) : 8;
      }
      out.video = v;
    } else if (handler === 'soun' && !out.audio) {
      out.audio = { codec };
    }
  }
  return out;
}

/** Versión liviana de mp4Formats para mostrar el códec en las tarjetas: busca el moov leyendo solo
 * cabeceras y baja como mucho sus primeros `limit` bytes. El video casi siempre es la primera pista,
 * así que aparece aunque el resto (tablas grandes, audio) no alcance a bajar. */
export async function mp4QuickFormats(read, size, limit = 256 * 1024) {
  let pos = 0;
  let moovPos = -1;
  let moovSize = 0;
  for (let guard = 0; pos + 8 <= size && guard < 64; guard++) {
    const h = await read(pos, Math.min(size - 1, pos + 15));
    let boxSize = u32(h, 0);
    const type = fourcc(h, 4);
    if (boxSize === 1) boxSize = u64(h, 8);
    else if (boxSize === 0) boxSize = size - pos;
    if (type === 'moov') {
      moovPos = pos;
      moovSize = boxSize;
      break;
    }
    if (boxSize < 8) break;
    pos += boxSize;
  }
  if (moovPos < 0) return null;
  const b = await read(moovPos, moovPos + Math.min(moovSize, limit) - 1);
  /** @type {{ video: any, audio: any }} */
  const out = { video: null, audio: null };
  // recorre cajas sin exigir que quepan completas en lo que se bajó
  const walk = (start, end, depth) => {
    let p = start;
    while (p + 8 <= end && p + 8 <= b.length) {
      let sz = u32(b, p);
      const type = fourcc(b, p + 4);
      let hdr = 8;
      if (sz === 1) {
        sz = u64(b, p + 8);
        hdr = 16;
      } else if (sz === 0) sz = end - p;
      if (sz < hdr) return;
      const box = { type, start: p + hdr, end: Math.min(p + sz, end, b.length) };
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type) && depth < 6) {
        if (type === 'trak') cur = { handler: '' };
        walk(box.start, box.end, depth + 1);
      } else if (type === 'hdlr' && cur && box.start + 12 <= b.length) {
        cur.handler = fourcc(b, box.start + 8);
      } else if (type === 'stsd' && cur && box.start + 16 <= b.length) {
        const entry = box.start + 8;
        const codec = fourcc(b, entry + 4);
        if (cur.handler === 'vide' && !out.video) {
          const v = { codec, bits: 8, profile: 0 };
          const kids = entry + 8 + 78;
          const find = (t) => {
            for (let q = kids; q + 8 <= Math.min(box.end, b.length);) {
              const n = u32(b, q);
              if (fourcc(b, q + 4) === t) return q + 8;
              if (n < 8) break;
              q += n;
            }
            return -1;
          };
          if (/^avc[13]$/.test(codec)) {
            const c = find('avcC');
            if (c > 0) {
              v.profile = b[c + 1];
              if ([110, 122, 244].includes(v.profile)) v.bits = 10;
            }
          } else if (/^(hev1|hvc1)$/.test(codec)) {
            const c = find('hvcC');
            if (c > 0) {
              v.profile = b[c + 1] & 0x1f;
              v.bits = (b[c + 17] & 7) + 8;
            }
          } else if (codec === 'av01') {
            const c = find('av1C');
            if (c > 0) v.bits = b[c + 2] & 0x40 ? (b[c + 2] & 0x20 ? 12 : 10) : 8;
          }
          out.video = v;
        } else if (cur.handler === 'soun' && !out.audio) out.audio = { codec };
      }
      if (p + sz <= p) return;
      p += sz;
    }
  };
  let cur = null;
  walk(8, b.length, 0);
  return out.video || out.audio ? out : null;
}

/** Capítulos del MP4: [{ start, end, title }] o []. */
export async function mp4Chapters(info, read, duration) {
  let list = info.chapters;
  if (!list && info.chapterTrack) {
    list = [];
    await loadTrackCues(info.chapterTrack, read, { parallel: 2, onCue: (t, e, title) => list.push({ t, title }) });
  }
  if (!list || !list.length) return [];
  list.sort((a, b) => a.t - b.t);
  return list.map((c, i) => ({
    start: c.t,
    end: i + 1 < list.length ? list[i + 1].t : duration || Infinity,
    title: c.title,
  }));
}

/* ───────── cuál capítulo es el opening ───────── */

const INTRO_RE = /^\s*(intro|opening|op\b|apertura|avance inicial)/i;
export const OUTRO_RE = /^\s*(ending|ed\b|outro|cr[eé]ditos|credits|cierre)/i;
const OPENING_RE = /^\s*(opening|op\b|apertura)/i;

/** El capítulo que es el opening, o null. Algunos MP4 llaman "Intro" o "Avance inicial" al pedacito de
 * anime que va antes del opening, así que no basta el nombre: un opening dura más o menos 1 a 2½ minutos.
 * Se prefiere el que se llama Opening/OP/Apertura; si hay varios, el de duración más cercana a 1:30. */
export function pickIntro(chapters) {
  const fits = (c) => {
    const len = c.end - c.start;
    return isFinite(len) && len >= 45 && len <= 150;
  };
  const named = (chapters || []).filter((c) => INTRO_RE.test(c.title || ''));
  if (!named.length) return null;
  const rank = (c) => (OPENING_RE.test(c.title) ? 0 : 1) * 1000 + Math.abs(c.end - c.start - 90);
  const ok = named.filter(fits).sort((a, b) => rank(a) - rank(b));
  if (ok.length) return ok[0];
  // ninguno dura lo que un opening: solo se confía si se llama Opening/OP/Apertura (puede venir pegado a otra parte)
  return named.find((c) => OPENING_RE.test(c.title) && isFinite(c.end - c.start)) || null;
}

/** Texto de una muestra de una pista de texto. */
function decodeSample(codec, bytes) {
  if (codec === 'wvtt') {
    const texts = [];
    for (const b of boxes(bytes, 0, bytes.length)) {
      if (b.type !== 'vttc') continue;
      const payl = child(bytes, b, 'payl');
      if (payl) texts.push(new TextDecoder().decode(bytes.subarray(payl.start, payl.end)));
    }
    return cleanVttText(texts.join('\n'));
  }
  const len = u16(bytes, 0);
  const body = bytes.subarray(2, 2 + len);
  const text =
    body[0] === 0xfe && body[1] === 0xff
      ? new TextDecoder('utf-16be').decode(body.subarray(2))
      : new TextDecoder().decode(body);
  return cleanVttText(text.replace(/\r\n?/g, '\n'));
}

/**
 * Descarga las muestras de una pista de texto (las cercanas a `near` primero) y entrega cada una apenas llega
 * mediante onCue(inicio, fin, texto).
 * @param {any} track
 * @param {(start: number, end: number) => Promise<Uint8Array>} read
 * @param {{ near?: number, parallel?: number, onCue: (start: number, end: number, text: string) => void, signal?: AbortSignal }} opts
 */
async function loadTrackCues(track, read, { near = 0, parallel = 6, onCue, signal }) {
  const ts = track.timescale;
  const groups = [];
  for (const s of track.samples) {
    const g = groups[groups.length - 1];
    if (g && s.off >= g.end && s.off - g.end < 16 * 1024 && s.off + s.size - g.start < 512 * 1024) {
      g.items.push(s);
      g.end = s.off + s.size;
    } else {
      groups.push({ start: s.off, end: s.off + s.size, items: [s], t: s.t / ts });
    }
  }
  groups.sort((a, b) => Math.abs(a.t - near) - Math.abs(b.t - near));
  let i = 0;
  const worker = async () => {
    while (i < groups.length) {
      if (signal && signal.aborted) return;
      const g = groups[i++];
      let data;
      for (let tries = 0; ; tries++) {
        try {
          data = await read(g.start, g.end - 1);
          break;
        } catch (err) {
          if ((signal && signal.aborted) || tries >= 2) throw err;
        }
      }
      for (const s of g.items) {
        const text = decodeSample(track.codec, data.subarray(s.off - g.start, s.off - g.start + s.size));
        if (text) onCue(s.t / ts, (s.t + s.d) / ts, text);
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
}
