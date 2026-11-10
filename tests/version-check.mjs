// Revisa que un cambio en la app venga con VERSION o ENTREGA nuevas en sw.js.
// Kai sale de la caché sin preguntar al servidor: si la app cambia y sw.js no, nadie recibe el cambio.
// Uso: node tests/version-check.mjs <commit base>   (GitHub Actions le pasa la base del PR o el push anterior)
import { execFileSync } from 'node:child_process';

const base = process.argv[2];
if (!base || /^0+$/.test(base)) {
  console.log('Sin base con qué comparar: no se revisa.');
  process.exit(0);
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

// lo que no se publica como parte de la app (o no cambia lo que corre en el teléfono)
const OUTSIDE = [/^tests\//, /^docs\//, /^\.github\//, /^README\.md$/, /^\.gitignore$/];
const changed = git('diff', '--name-only', `${base}...HEAD`)
  .split('\n')
  .filter(Boolean)
  .filter((f) => !OUTSIDE.some((re) => re.test(f)));

if (!changed.length) {
  console.log('No cambió nada de la app.');
  process.exit(0);
}

/** VERSION y ENTREGA de sw.js en un commit. */
function versionAt(ref) {
  let src = '';
  try {
    src = git('show', `${ref}:sw.js`);
  } catch {
    return null;
  }
  const num = (name) => (src.match(new RegExp(`const ${name} = (\\d+);`)) || [])[1];
  const assets = [...((src.match(/const ASSETS = \[([\s\S]*?)\];/) || [])[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return { version: num('VERSION'), entrega: num('ENTREGA'), assetsV: num('ASSETS_V'), assets };
}
const before = versionAt(git('merge-base', base, 'HEAD').trim());
const now = versionAt('HEAD');

if (before && now && before.version === now.version && before.entrega === now.entrega) {
  console.error(
    `Cambió la app (${changed.slice(0, 8).join(', ')}${changed.length > 8 ? '…' : ''}) pero sw.js sigue en ` +
      `Kai ${now.version}.${now.entrega}.\n` +
      'Sube ENTREGA en sw.js (o VERSION si va a main): si no, los teléfonos siguen con la versión de su caché.',
  );
  process.exit(1);
}
// lo que va en la caché aparte (sw.js, ASSETS) no se vuelve a bajar si no sube ASSETS_V
const assetsChanged = now ? changed.filter((f) => now.assets.includes(f)) : [];
if (assetsChanged.length && before && before.assetsV && before.assetsV === now.assetsV) {
  console.error(
    `Cambió ${assetsChanged.join(', ')} pero ASSETS_V sigue en ${now.assetsV}.\n` +
      'Sube ASSETS_V en sw.js: si no, los teléfonos siguen con la copia que ya tienen guardada.',
  );
  process.exit(1);
}
console.log(`Bien: la app cambió y la versión pasó de ${before ? `${before.version}.${before.entrega}` : '—'} a ${now ? `${now.version}.${now.entrega}` : '—'}.`);
