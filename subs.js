/*
 * subs.js — subtítulos y capítulos para Kai.
 *  - Pistas de texto incrustadas en MP4 (mov_text/tx3g y WebVTT), leídas por rangos:
 *    solo se descarga el índice del archivo (moov) y los pedacitos de texto, no el video.
 *  - Archivos sueltos: .srt, .vtt, .ass/.ssa.
 */

const SUB_EXT = /\.(srt|vtt|ass|ssa)$/i;
export const isSubtitleName = (name) => SUB_EXT.test(name || '');

/* ───────── nombres de idioma ───────── */

const LANGS = {
  spa: 'Español', es: 'Español', esp: 'Español', eng: 'Inglés', en: 'Inglés', jpn: 'Japonés', ja: 'Japonés',
  por: 'Portugués', pt: 'Portugués', fre: 'Francés', fra: 'Francés', fr: 'Francés', ger: 'Alemán', deu: 'Alemán',
  de: 'Alemán', ita: 'Italiano', it: 'Italiano', kor: 'Coreano', ko: 'Coreano', chi: 'Chino', zho: 'Chino', zh: 'Chino',
};
export function langName(code) {
  if (!code) return '';
  return LANGS[String(code).toLowerCase()] || '';
}

/* ───────── texto de archivos sueltos ───────── */

function ts(h, m, s, frac) {
  const f = frac ? Number('0.' + frac) : 0;
  return Number(h || 0) * 3600 + Number(m) * 60 + Number(s) + f;
}

function cleanVttText(t) {
  return t
    .replace(/\{\\[^}]*\}/g, '')                    // {\an8} que vienen de ASS
    .replace(/<(?!\/?(i|b|u)\b)[^>]+>/gi, '')       // deja solo <i>, <b>, <u>
    .replace(/\r/g, '')
    .trim();
}

/** SRT y WebVTT → [[inicio, fin, texto]] */
export function parseSrtVtt(text) {
  const out = [];
  const blocks = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const re = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;
  for (const b of blocks) {
    const lines = b.split('\n');
    const i = lines.findIndex((l) => re.test(l));
    if (i < 0) continue;
    const m = re.exec(lines[i]);
    const start = ts(m[1], m[2], m[3], m[4].padEnd(3, '0'));
    const end = ts(m[5], m[6], m[7], m[8].padEnd(3, '0'));
    const body = cleanVttText(lines.slice(i + 1).join('\n'));
    if (body && end > start) out.push([start, end, body]);
  }
  return out;
}

/** ASS/SSA → [[inicio, fin, texto]] (sin estilos: posición y colores se pierden) */
export function parseAss(text) {
  const out = [];
  let format = null;
  let inEvents = false;
  for (const raw of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\[events\]/i.test(line)) { inEvents = true; continue; }
    if (/^\[/.test(line)) { inEvents = false; continue; }
    if (!inEvents) continue;
    if (/^format\s*:/i.test(line)) {
      format = line.replace(/^format\s*:/i, '').split(',').map((s) => s.trim().toLowerCase());
      continue;
    }
    if (!/^dialogue\s*:/i.test(line) || !format) continue;
    const parts = line.replace(/^dialogue\s*:/i, '').split(',');
    const fields = parts.slice(0, format.length - 1).map((s) => s.trim());
    fields.push(parts.slice(format.length - 1).join(','));
    const get = (k) => fields[format.indexOf(k)];
    const tm = (s) => {
      const m = /(\d+):(\d{2}):(\d{2})[.](\d{1,3})/.exec(s || '');
      return m ? ts(m[1], m[2], m[3], m[4].padEnd(3, '0')) : NaN;
    };
    const start = tm(get('start'));
    const end = tm(get('end'));
    const body = (get('text') || '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N/gi, '\n')
      .replace(/\\h/g, ' ')
      .trim();
    if (body && end > start) out.push([start, end, body]);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

export function parseSubtitleFile(name, text) {
  return /\.(ass|ssa)$/i.test(name) ? parseAss(text) : parseSrtVtt(text);
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
    if (size === 1) { size = u64(b, p + 8); hdr = 16; } else if (size === 0) size = end - p;
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
  for (const t of types) { cur = cur && child(b, cur, t); }
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
  if (stco) { const n = u32(b, stco.start + 4); for (let i = 0; i < n; i++) chunks.push(u32(b, stco.start + 8 + i * 4)); }
  else { const n = u32(b, co64.start + 4); for (let i = 0; i < n; i++) chunks.push(u64(b, co64.start + 8 + i * 8)); }

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
    for (let k = sc.length - 1; k >= 0; k--) if (ci + 1 >= sc[k][0]) { per = sc[k][1]; break; }
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
 * Lee el índice de un MP4 y separa:
 *  - tracks: pistas de subtítulos
 *  - chapterTrack: pista de texto que en realidad son capítulos ("Intro", "Parte A"…)
 *  - chapters: capítulos ya leídos de la caja chpl, si existe
 */
export async function mp4Info(read, size) {
  const moov = await readMoov(read, size);
  if (!moov) return { tracks: [], chapters: null, chapterTrack: null };
  const root = { start: 8, end: moov.length };
  const chapterIds = new Set();
  for (const trak of boxes(moov, root.start, root.end)) {
    if (trak.type !== 'trak') continue;
    const chap = path(moov, trak, 'tref', 'chap');
    if (chap) for (let p = chap.start; p + 4 <= chap.end; p += 4) chapterIds.add(u32(moov, p));
  }
  const tracks = [];
  let chapterTrack = null;
  for (const trak of boxes(moov, root.start, root.end)) {
    if (trak.type !== 'trak') continue;
    const isChapters = chapterIds.has(trackId(moov, trak));
    const mdia = child(moov, trak, 'mdia');
    const hdlr = mdia && child(moov, mdia, 'hdlr');
    const mdhd = mdia && child(moov, mdia, 'mdhd');
    if (!hdlr || !mdhd) continue;
    const handler = fourcc(moov, hdlr.start + 8);
    if (!['text', 'sbtl', 'subt'].includes(handler)) continue;
    const stbl = path(moov, mdia, 'minf', 'stbl');
    const stsd = stbl && child(moov, stbl, 'stsd');
    if (!stsd) continue;
    const codec = fourcc(moov, stsd.start + 12);
    if (!['tx3g', 'wvtt', 'text'].includes(codec)) continue;
    const v = moov[mdhd.start];
    const timescale = v === 1 ? u32(moov, mdhd.start + 20) : u32(moov, mdhd.start + 12);
    const lang = lang3(v === 1 ? u16(moov, mdhd.start + 32) : u16(moov, mdhd.start + 20));
    let name = '';
    try {
      name = new TextDecoder().decode(moov.subarray(hdlr.start + 24, hdlr.end)).replace(/\0/g, '').trim();
    } catch { /* nada */ }
    if (/handler|core media|^text$|subtitle ?media/i.test(name)) name = '';
    const samples = sampleTable(moov, stbl).filter((s) => s.size > 2);
    const track = { codec, lang, name, timescale: timescale || 1000, samples };
    if (isChapters) chapterTrack = chapterTrack || track;
    else tracks.push(track);
  }
  return { tracks, chapters: neroChapters(moov, root), chapterTrack };
}

/** Solo las pistas de subtítulos (sin capítulos). */
export async function mp4TextTracks(read, size) {
  return (await mp4Info(read, size)).tracks;
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
  return list.map((c, i) => ({ start: c.t, end: i + 1 < list.length ? list[i + 1].t : (duration || Infinity), title: c.title }));
}

/** Texto de una muestra de subtítulo. */
export function decodeSample(codec, bytes) {
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
  const text = body[0] === 0xfe && body[1] === 0xff
    ? new TextDecoder('utf-16be').decode(body.subarray(2))
    : new TextDecoder().decode(body);
  return cleanVttText(text.replace(/\r\n?/g, '\n'));
}

/**
 * Descarga las muestras de una pista (las cercanas a `near` primero) y entrega
 * cada subtítulo apenas llega mediante onCue(inicio, fin, texto).
 */
export async function loadTrackCues(track, read, { near = 0, parallel = 6, onCue, signal } = {}) {
  const ts = track.timescale;
  const groups = [];
  for (const s of track.samples) {
    const g = groups[groups.length - 1];
    if (g && s.off >= g.end && s.off - g.end < 16 * 1024 && s.off + s.size - g.start < 512 * 1024) {
      g.items.push(s); g.end = s.off + s.size;
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
        try { data = await read(g.start, g.end - 1); break; } catch (err) {
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
