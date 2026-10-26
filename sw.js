/*
 * Service worker de Kai.
 *  1. Guarda la app para que abra sin conexión.
 *  2. Sirve /__stream: pide a MEGA solo el rango que el reproductor necesita,
 *     lo descifra en el dispositivo y lo entrega como video normal (con adelantar/retroceder).
 */
importScripts('core.js');

const VERSION = 'kai-v5';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'subs.js', 'meta.js', 'core.js',
  'vendor/mega.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-512.png',
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
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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

async function staleWhileRevalidate(req, e) {
  const cache = await caches.open(VERSION);
  const key = req.mode === 'navigate' ? 'index.html' : req;
  const hit = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
  const update = fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') cache.put(key, res.clone());
    return res;
  }).catch(() => null);
  if (hit) {
    e.waitUntil(update);
    return hit;
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

async function stream(req, url) {
  const src = url.searchParams.get('u');
  const key = url.searchParams.get('k');
  const size = Number(url.searchParams.get('s'));
  const type = url.searchParams.get('t') || 'video/mp4';
  if (!src || !key || !size) return new Response('Faltan datos', { status: 400 });

  const { start, end, partial } = parseRange(req.headers.get('range'), size);
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }

  const fk = await MegaCore.fileKey(key);
  const ctrl = new AbortController();
  let pos = start;
  let chunk = 256 * 1024;

  // Lee por pedazos que crecen hasta 4 MB; si el reproductor salta a otro punto,
  // cancela este flujo y abre uno nuevo en la posición pedida.
  const body = new ReadableStream({
    async pull(c) {
      if (pos > end) { c.close(); return; }
      const last = Math.min(end, pos + chunk - 1);
      let tries = 0;
      for (;;) {
        try {
          const data = await MegaCore.readRange(src, fk, pos, last, ctrl.signal);
          reportBytes(data.length);
          c.enqueue(data);
          pos = last + 1;
          chunk = Math.min(chunk * 2, 4 * 1024 * 1024);
          if (pos > end) c.close();
          return;
        } catch (err) {
          if (ctrl.signal.aborted) return;
          if (err.code === 'QUOTA') reportQuota(err.timeLeft);
          if (err.code === 'HTTP' || err.code === 'QUOTA' || ++tries > 2) { c.error(err); return; }
          await new Promise((r) => setTimeout(r, 600 * tries));
        }
      }
    },
    cancel() { ctrl.abort(); },
  }, { highWaterMark: 2 });

  const headers = {
    'Content-Type': type,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };
  if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: partial ? 206 : 200, headers });
}
