/*
 * Service worker de Kai.
 *  1. Guarda la app para que abra sin conexión.
 *  2. Sirve /__stream: pide a MEGA solo el rango que el reproductor necesita,
 *     lo descifra en el dispositivo y lo entrega como video normal (con adelantar/retroceder).
 */
importScripts('core.js');

const VERSION = 'kai-v28';
const SHELL = [
  './', 'styles.css', 'app.js', 'subs.js', 'meta.js', 'core.js',
  'vendor/mega.js', 'manifest.webmanifest', 'icon-32.png', 'icon-180.png', 'icon-192.png', 'icon-512.png',
  'gato/sentado.webp', 'gato/sentado-cierra.webp', 'gato/echado.webp',
];
const FONT_CACHE = 'kai-fonts';
const ART_CACHE = 'kai-art';

// Avisa a la app cuántos bytes se bajaron de MEGA, para mostrar el uso de transferencia.
let pendingBytes = 0;
let bytesTimer = null;
function reportBytes(n) {
  pendingBytes += n;
  if (bytesTimer) return;
  bytesTimer = setTimeout(async () => {
    const n2 = pendingBytes;
    pendingBytes = 0;
    bytesTimer = null;
    const list = await self.clients.matchAll({ type: 'window' });
    if (list[0]) list[0].postMessage({ type: 'mega-bytes', n: n2 });
  }, 2000);
}
async function reportQuota(timeLeft) {
  for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'mega-quota', timeLeft });
}

self.addEventListener('install', (e) => {
  // 'reload' evita que el navegador entregue archivos viejos de su propia caché
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(SHELL.map(async (u) => {
      const res = await fetch(new Request(u, { cache: 'reload' }));
      if (!res.ok) throw new Error('No se pudo guardar ' + u);
      await c.put(u, await clean(res));
    }));
    await self.skipWaiting();
  })());
});

// la app pregunta qué versión está instalada (Ajustes)
self.addEventListener('message', (e) => {
  if ((e.data || {}).type === 'version' && e.source) e.source.postMessage({ type: 'version', version: VERSION });
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k !== VERSION && k !== FONT_CACHE && k !== ART_CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  if (url.origin === location.origin && url.pathname.endsWith('/__stream')) {
    e.respondWith(stream(req, url));
    return;
  }
  if (req.method !== 'GET') return;

  // imágenes de AniList: se guardan para verlas sin conexión
  if (url.hostname.endsWith('anilist.co') && req.destination === 'image') {
    e.respondWith(cacheFirst(req, ART_CACHE));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }
  if (url.origin === location.origin) {
    e.respondWith(staleWhileRevalidate(req, e));
  }
  // Todo lo demás (API y servidores de MEGA) pasa directo a la red.
});

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  } catch (err) {
    return new Response('', { status: 504 });
  }
}

/* Una respuesta que llegó tras una redirección no se puede entregar como página: Safari la rechaza
 * ("Response served by service worker has redirections"). Cloudflare Pages redirige /index.html → /,
 * así que se guarda y se entrega siempre una copia limpia. */
async function clean(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function staleWhileRevalidate(req, e) {
  const cache = await caches.open(VERSION);
  const key = req.mode === 'navigate' ? './' : req;
  const hit = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
  const update = fetch(req).then(async (res) => {
    if (res.ok && res.type === 'basic') {
      res = await clean(res);
      cache.put(key, res.clone());
    }
    return res;
  }).catch(() => null);
  if (hit) {
    e.waitUntil(update);
    return clean(hit);
  }
  const res = await update;
  return res || new Response('Sin conexión', { status: 503 });
}

function parseRange(header, size) {
  let start = 0;
  let end = size - 1;
  const m = header && /bytes=(\d*)-(\d*)/.exec(header);
  if (m) {
    if (m[1] === '') {
      start = Math.max(0, size - Number(m[2]));
    } else {
      start = Number(m[1]);
      if (m[2] !== '') end = Math.min(Number(m[2]), size - 1);
    }
  }
  return { start, end, partial: !!m };
}

/* ── video por rangos ──
 * El archivo se maneja en bloques de 1 MB:
 *  - cada bloque se pide a MEGA una sola vez y queda en memoria (lo más reciente, hasta un límite),
 *    así retroceder o volver a una parte ya vista no gasta cuota ni espera;
 *  - se piden hasta 3 bloques a la vez (MEGA limita la velocidad por conexión);
 *  - cada bloque se descifra y se entrega mientras llega, sin esperar a tenerlo completo. */
const BLOCK = 1024 * 1024;
const PARALLEL = 3;
const AHEAD = 4; // bloques que se piden por adelantado
const MEM_LIMIT = ((self.navigator && self.navigator.deviceMemory) || 8) <= 4 ? 64 * BLOCK : 160 * BLOCK;
const files = new Map(); // clave del archivo -> { url, fk, size, blocks: Map, active }
let memUsed = 0;
let useTick = 0;

function megaError(status, headers) {
  const e = new Error(status === 509 ? 'Límite de transferencia de MEGA alcanzado' : 'MEGA respondió ' + status);
  // 408, 429 y 5xx son tropiezos pasajeros del servidor de MEGA: se reintentan.
  // 403, 404 o 410 casi siempre es un enlace caducado: lo resuelve la app pidiendo uno nuevo.
  e.code = status === 509 ? 'QUOTA' : (status === 408 || status === 429 || status >= 500) ? 'BUSY' : 'HTTP';
  e.status = status;
  const tl = headers && headers.get('x-mega-time-left');
  if (tl) e.timeLeft = +tl;
  return e;
}

async function fileFor(key, url, size, id = '') {
  let f = files.get(key);
  if (!f) {
    f = { key, url, given: url, id, size, fk: await MegaCore.fileKey(key), blocks: new Map(), active: 0, queue: [], renewing: null };
    files.set(key, f);
  }
  if (id) f.id = id;
  // El reproductor repite en cada pedido la dirección con la que empezó. Si ya se renovó aquí,
  // no se vuelve a la vieja; solo se adopta una dirección que la app mande de verdad nueva.
  if (url && url !== f.given) { f.given = url; f.url = url; }
  return f;
}

/** Le cuenta a la app el último error al pedir video, para mostrarlo si la reproducción falla. */
function tellError(err) {
  const msg = (err && (err.status ? 'MEGA ' + err.status : err.message)) || 'error';
  self.clients.matchAll({ type: 'window' }).then((l) => l.forEach((c) => c.postMessage({ type: 'stream-error', msg }))).catch(() => {});
}

/** El enlace de MEGA caducó: se le pide uno nuevo a la app (una sola vez a la vez por archivo). */
function renewUrl(f) {
  if (!f.id) return Promise.resolve(false);
  if (!f.renewing) {
    f.renewing = (async () => {
      const list = await self.clients.matchAll({ type: 'window' });
      for (const c of list) {
        const url = await new Promise((resolve) => {
          const ch = new MessageChannel();
          const t = setTimeout(() => resolve(''), 8000);
          ch.port1.onmessage = (e) => { clearTimeout(t); resolve((e.data && e.data.url) || ''); };
          c.postMessage({ type: 'need-url', id: f.id }, [ch.port2]);
        });
        if (url) { f.url = url; return true; }
      }
      return false;
    })().finally(() => { setTimeout(() => { f.renewing = null; }, 15000); });
  }
  return f.renewing;
}

class Block {
  constructor(f, i) {
    this.f = f;
    this.i = i;
    this.start = i * BLOCK;
    this.len = Math.min(BLOCK, f.size - this.start);
    this.buf = new Uint8Array(this.len);
    this.filled = 0;
    this.done = false;
    this.err = null;
    this.users = 0;
    this.started = false;
    this.ctrl = null;
    this.idle = null; // temporizador para pausar un bloque que nadie está esperando
    this.waiters = [];
    this.used = ++useTick;
    memUsed += this.len;
  }
  notify() { const w = this.waiters; this.waiters = []; w.forEach((r) => r()); }
  wait() { return new Promise((r) => this.waiters.push(r)); }
}

function getBlock(f, i, urgent = false) {
  let b = f.blocks.get(i);
  if (b && b.err) { memUsed -= b.len; b = null; }
  if (!b) {
    b = new Block(f, i);
    f.blocks.set(i, b);
    f.queue.push(b);
  }
  b.used = ++useTick;
  clearTimeout(b.idle);
  if (!b.done && !b.started && !f.queue.includes(b)) f.queue.push(b); // un bloque pausado sigue donde quedó
  if (urgent && !b.started) { f.queue = f.queue.filter((x) => x !== b); startBlock(b); } // lo que se está viendo no hace fila
  else pump(f);
  return b;
}
function pump(f) {
  while (f.active < PARALLEL && f.queue.length) startBlock(f.queue.shift());
}
function startBlock(b) {
  if (b.started || b.done) return;
  b.started = true;
  b.ctrl = new AbortController();
  b.f.active++;
  runBlock(b, b.ctrl).finally(() => {
    b.f.active--;
    b.started = false;
    // si lo pausaron justo cuando alguien volvió a pedirlo, sigue
    if (!b.done && !b.err && b.users && !b.f.queue.includes(b)) b.f.queue.unshift(b);
    pump(b.f);
  });
}

async function runBlock(b, ctrl) {
  const f = b.f;
  let tries = 0;
  while (b.filled < b.len) {
    try {
      const from = b.start + b.filled;
      const r = await fetch(f.url + '/' + from + '-' + (b.start + b.len - 1), { signal: ctrl.signal, cache: 'no-store' });
      if (!r.ok) throw megaError(r.status, r.headers);
      const reader = r.body.getReader();
      let pend = new Uint8Array(0);
      const flush = async (all) => {
        const n = all ? pend.length : pend.length - (pend.length % 16);
        if (!n) return;
        const dec = await MegaCore.decryptAt(f.fk, pend.subarray(0, n), b.start + b.filled);
        b.buf.set(dec, b.filled);
        b.filled += n;
        pend = pend.slice(n);
        b.notify();
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (ctrl.signal.aborted) break;
        reportBytes(value.length);
        const next = new Uint8Array(pend.length + value.length);
        next.set(pend); next.set(value, pend.length);
        pend = next;
        if (pend.length >= 64 * 1024) await flush(false);
      }
      if (ctrl.signal.aborted) { await flush(false); return; } // pausado: se guarda lo que llegó (alineado a 16)
      await flush(true);
      if (b.filled < b.len) throw new Error('Respuesta incompleta');
    } catch (err) {
      if (ctrl.signal.aborted) return;
      if (err.code === 'QUOTA') reportQuota(err.timeLeft);
      // enlace caducado: se pide uno nuevo a la app y se sigue desde donde iba, sin cortar el video
      if (err.code === 'HTTP' && !b.renewed) {
        b.renewed = true;
        if (await renewUrl(f)) continue;
      }
      // cortes de red y tropiezos del servidor: hasta 6 intentos con espera creciente (≈ 20 s en total)
      if (err.code === 'HTTP' || err.code === 'QUOTA' || ++tries > 6) { b.err = err; b.notify(); tellError(err); return; }
      await new Promise((r) => setTimeout(r, Math.min(6000, 500 * 2 ** (tries - 1))));
    }
  }
  b.done = true;
  b.notify();
  trimMemory();
}

/* Chrome a veces cancela un pedido y abre otro casi igual: un bloque que nadie espera
 * se pausa tras un momento (para no gastar cuota) y conserva lo que ya bajó. */
function release(b) {
  b.users = Math.max(0, b.users - 1);
  if (b.users || b.done) return;
  clearTimeout(b.idle);
  b.idle = setTimeout(() => {
    if (b.users || b.done) return;
    b.f.queue = b.f.queue.filter((x) => x !== b);
    if (b.started && b.ctrl) b.ctrl.abort();
  }, 2500);
}

/** Libera los bloques usados hace más tiempo cuando la memoria pasa del límite. */
function trimMemory() {
  if (memUsed <= MEM_LIMIT) return;
  const all = [];
  for (const f of files.values()) for (const b of f.blocks.values()) if (!b.users && !b.started) all.push(b);
  all.sort((a, b) => a.used - b.used);
  for (const b of all) {
    if (memUsed <= MEM_LIMIT * 0.85) break;
    b.f.blocks.delete(b.i);
    memUsed -= b.len;
  }
  for (const [k, f] of files) if (!f.blocks.size && !f.active) files.delete(k);
}

async function stream(req, url) {
  const src = url.searchParams.get('u');
  const key = url.searchParams.get('k');
  const size = Number(url.searchParams.get('s'));
  const type = url.searchParams.get('t') || 'video/mp4';
  const id = url.searchParams.get('i') || '';
  if (!src || !key || !size) return new Response('Faltan datos', { status: 400 });

  const { start, end, partial } = parseRange(req.headers.get('range'), size);
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }

  const f = await fileFor(key, src, size, id);
  let pos = start;
  const held = new Map(); // bloques que este flujo está usando

  const hold = (i, urgent) => {
    if (held.has(i)) { if (urgent) getBlock(f, i, true); return held.get(i); }
    const b = getBlock(f, i, urgent);
    b.users++;
    held.set(i, b);
    return b;
  };
  const drop = (b) => { if (held.get(b.i) === b) { held.delete(b.i); release(b); } };

  const body = new ReadableStream({
    async pull(c) {
      if (pos > end) { c.close(); return; }
      const i = Math.floor(pos / BLOCK);
      const last = Math.floor(end / BLOCK);
      let b = hold(i, true);
      for (let k = i + 1; k <= Math.min(last, i + AHEAD); k++) hold(k, false);
      // el bloque se descarta si falló antes y se vuelve a intentar una vez
      while (b.filled <= pos - b.start && !b.done && !b.err) await b.wait();
      if (b.err) {
        drop(b);
        b = hold(i, true);
        while (b.filled <= pos - b.start && !b.done && !b.err) await b.wait();
        if (b.err) { c.error(b.err); return; }
      }
      const from = pos - b.start;
      const to = Math.min(b.filled, end - b.start + 1);
      c.enqueue(b.buf.slice(from, to));
      pos = b.start + to;
      if (pos >= b.start + b.len) drop(b);
      if (pos > end) c.close();
    },
    cancel() { for (const b of [...held.values()]) drop(b); },
  }, { highWaterMark: 4 });

  const headers = {
    'Content-Type': type,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };
  if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: partial ? 206 : 200, headers });
}

/* Precarga: la app pide bajar en silencio el inicio del siguiente capítulo. */
self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type !== 'prefetch' || !d.u || !d.k || !d.s) return;
  e.waitUntil((async () => {
    const f = await fileFor(d.k, d.u, Number(d.s), d.i || '');
    const n = Math.min(Math.ceil(f.size / BLOCK), d.blocks || 2);
    const list = [];
    for (let i = 0; i < n; i++) list.push(getBlock(f, i));
    await Promise.all(list.map(async (b) => { while (!b.done && !b.err) await b.wait(); }));
  })());
});
