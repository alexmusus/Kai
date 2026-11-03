# Pruebas de Kai

Kai se publica tal cual (sin compilar). Esta carpeta solo sirve para revisar que nada se rompa; Cloudflare no la usa.

```zsh
cd tests
npm install                         # una vez
npx playwright install chromium     # una vez (o usa tu Chrome: ya está configurado)
npm run check                       # todo: revisión, pruebas unitarias y recorridos
```

- `npm run lint`: ESLint, sobre todo nombres sin definir o sin importar entre módulos.
- `npm test`: pruebas unitarias (Vitest) de los modelos: nombres de archivos y temporadas, biblioteca, Sub/Doblado, progreso al renombrar carpetas.
- `npm run e2e`: recorridos con Playwright en tamaño PC y iPhone, con una biblioteca simulada y sin conexión (no toca MEGA ni AniList). Con `KAI_SHOTS=carpeta npm run e2e` guarda una captura de cada pantalla.

GitHub Actions corre todo en cada push.
