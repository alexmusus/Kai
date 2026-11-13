/*
 * Biblioteca de prueba: lo que Kai tendría guardado en el navegador después de leer MEGA.
 * Se siembra en localStorage y Kai abre sin conexión (navigator.onLine = false), así no toca MEGA ni AniList.
 */

const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'; // 32 bytes cualquiera (no se descifra nada)
export const NOW = Date.UTC(2026, 9, 31, 18, 0, 0); // 31 oct 2026, 12:00 en Guatemala

let nid = 0;
const ep = (folder, file, n, ts = NOW - 86400e3 * 10) => ({
  id: 'n' + (++nid).toString().padStart(4, '0'),
  name: file,
  path: `${folder}/${file}`,
  ep: n,
  size: 250e6,
  key: KEY,
  fa: null,
  mime: 'video/mp4',
  ts,
});
const season = (num, title, name, eps) => ({ num, title, name, episodes: eps });
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// póster y banner como imágenes en línea (nada de internet), de un color por serie
const art = (hue, w, h, text) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="hsl(${hue},45%,35%)"/>` +
  `<text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="${Math.round(h / 8)}" text-anchor="middle">${text}</text></svg>`);
const meta = (id, title, hue, extra = {}) => ({
  id, v: 2, title, romaji: title, native: '', synopsis: `Sinopsis de ${title}. Un texto de prueba con varias frases para ver cómo se acomoda.`,
  banner: art(hue, 1600, 400, title), cover: art(hue, 460, 650, title), color: '', year: 2015, episodes: 13,
  format: 'Serie', genres: ['Comedia', 'Romance', 'Drama'], score: 80, at: NOW, ...extra,
});

export function buildFixture() {
  nid = 0;
  const yah = 'Yahari Ore no Seishun Love Comedy wa Machigatteiru.';
  const yb = `Anime/${yah}`;
  const s1 = `1. ${yah}`;
  const s3 = `3. ${yah} Zoku`;
  const yahari = {
    name: yah, folderId: 'f1', added: NOW - 86400e3 * 2,
    seasons: [
      season(1, yah, s1, range(1, 13).map((n) => ep(`${yb}/${s1}`, `1_${n}_SUB.mp4`, n))),
      season(2, 'OVA', '2. OVA', [ep(`${yb}/2. OVA`, '2_1_SUB.mp4', 1)]),
      // Zoku con las dos versiones: Sub y Doblado
      season(3, `${yah} Zoku`, s3, range(1, 4).flatMap((n) => [ep(`${yb}/${s3}`, `3_${n}_SUB.mp4`, n), ep(`${yb}/${s3}`, `3_${n}_DUB.mp4`, n, NOW - 86400e3 * 2)])),
      season(4, 'OVA', '4. OVA', [ep(`${yb}/4. OVA`, '4_1_SUB.mp4', 1)]),
    ],
  };
  const dor = {
    name: 'Dorohedoro', folderId: 'f2', added: NOW - 86400e3 * 20,
    seasons: [season(null, '', '', range(1, 12).map((n) => ep('Anime/Dorohedoro', `9_${n}_SUB.mp4`, n, NOW - 86400e3 * 20)))],
  };
  const pel = {
    name: 'Peliculas', folderId: 'f3', added: NOW - 86400e3 * 5,
    seasons: [
      season(null, 'Kimi no Na wa', 'Kimi no Na wa', [ep('Anime/Peliculas/Kimi no Na wa', 'Kimi no Na wa_SUB.mp4', null)]),
      season(null, 'Koe no Katachi', 'Koe no Katachi', [ep('Anime/Peliculas/Koe no Katachi', 'Koe no Katachi_SUB.mp4', null)]),
    ],
  };
  const cine = {
    name: 'Cine', folderId: 'f4', added: NOW - 86400e3 * 5,
    // Cine va aparte de Anime: en la carpeta Cine de la raíz de MEGA
    seasons: [
      season(null, 'El gigante de hierro (1999)', 'El gigante de hierro (1999)', [ep('Cine/El gigante de hierro (1999)', 'El gigante de hierro.mp4', null)]),
      season(null, 'Pollitos en fuga (2000)', 'Pollitos en fuga (2000)', [ep('Cine/Pollitos en fuga (2000)', 'Pollitos en fuga_DOB.mp4', null)]),
      season(null, 'Pollitos en fuga 2 (2023)', 'Pollitos en fuga 2 (2023)', [ep('Cine/Pollitos en fuga 2 (2023)', 'Pollitos en fuga 2.mp4', null)]),
    ],
  };
  // Studio: música en vivo; el primero con su descripción (.txt con el mismo nombre)
  const qd = ep('Anime/Studio', 'Juan Gabriel - Querida (Bellas Artes, 1990).mp4', null);
  qd.note = { id: 'txt1', key: KEY, size: 40 };
  const studio = {
    name: 'Studio', folderId: 'f5', added: NOW - 86400e3 * 5,
    seasons: [season(null, '', '', [qd, ep('Anime/Studio', 'Rocío Dúrcal - Amor eterno.mp4', null)])],
  };
  const library = { root: 'Anime', rootId: 'root', v: 2, series: [dor, pel, cine, studio, yahari].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })), updated: NOW };

  const metaMap = {
    Dorohedoro: { ...meta(105228, 'Dorohedoro', 20, { year: 2020, genres: ['Acción', 'Comedia', 'Fantasía'], score: 82 }), sv: 6 },
    [`${yah}/${s1}`]: { ...meta(14813, 'Yahari Ore no Seishun Love Comedy wa Machigatteiru.', 210, { year: 2013 }), sm: 1 },
    [`${yah}/2. OVA`]: { ...meta(18753, 'Yahari Ore no Seishun Love Comedy wa Machigatteiru. OVA', 190, { year: 2013, format: 'OVA', episodes: 1 }), sm: 3 },
    [`${yah}/${s3}`]: { ...meta(20698, 'Yahari Ore no Seishun Love Comedy wa Machigatteiru. Zoku', 230, { year: 2015 }), sm: 1 },
    [`${yah}/4. OVA`]: { ...meta(21769, 'Yahari Ore no Seishun Love Comedy wa Machigatteiru. Zoku OVA', 250, { year: 2015, format: 'OVA', episodes: 1 }), sm: 3 },
    'Peliculas/Kimi no Na wa': { ...meta(21519, 'Your Name.', 300, { year: 2016, format: 'Película', episodes: 1, score: 85 }), mv: 5 },
    'Peliculas/Koe no Katachi': { ...meta(20954, 'A Silent Voice', 330, { year: 2016, format: 'Película', episodes: 1, score: 88 }), mv: 5 },
    'Cine/El gigante de hierro (1999)': { ...meta('tmdb:10386', 'El gigante de hierro', 40, { year: 1999, format: 'Película', src: 'TMDB', tm: 2, genres: ['Animación', 'Ciencia ficción', 'Familia'], saga: 'El gigante de hierro: Colección', stop: false }) }, // una sola de su saga: no cuenta
    'Cine/Pollitos en fuga (2000)': { ...meta('tmdb:7443', 'Pollitos en fuga', 60, { year: 2000, format: 'Película', src: 'TMDB', tm: 2, genres: ['Animación', 'Comedia', 'Familia'], saga: 'Pollitos en fuga: Colección', stop: true }) },
    'Cine/Pollitos en fuga 2 (2023)': { ...meta('tmdb:520758', 'Pollitos en fuga: El origen de los nuggets', 80, { year: 2023, format: 'Película', src: 'TMDB', tm: 3, genres: ['Animación', 'Comedia', 'Aventura'], saga: 'Pollitos en fuga: Colección', stop: true }) },
  };
  const yahariMeta = metaMap[`${yah}/${s1}`];
  metaMap[yah] = { ...yahariMeta, sv: 6 };

  const profile = { id: 'pA', name: 'Alex' };
  const s1eps = yahari.seasons[0].episodes;
  const progress = {};
  for (const e of s1eps.slice(0, 5)) progress[e.path] = { t: 1400, d: 1420, u: NOW - 86400e3 * 3, w: 1 };
  progress[s1eps[5].path] = { t: 600, d: 1420, u: NOW - 3600e3 };
  progress[dor.seasons[0].episodes[2].path] = { t: 300, d: 1440, u: NOW - 86400e3 };

  const ls = {
    session: { options: { email: 'prueba@example.com' } },
    profile,
    shared: { profiles: [profile, { id: 'pB', name: 'Diego' }], intros: {}, picks: {}, legacyBy: null },
    sharedLoaded: true,
    library,
    meta: metaMap,
    settings: { root: 'Anime', autoplay: true, autoSkip: true, theme: 'dark', cat: false },
    'p.pA.progress': progress,
    'p.pA.dirty': false,
    // todo lo de la biblioteca ya es conocido: sin burbujas de "nuevo" que cambien entre corridas
  };
  return { ls, library, yah };
}
