import { defineConfig } from '@playwright/test';

// Kai se sirve tal cual (sin compilar) con un servidor de archivos cualquiera.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  // el reproductor depende de tiempos reales: en GitHub, un reintento antes de dar por malo un recorrido
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8123',
    channel: process.env.CI ? undefined : 'chrome',
    serviceWorkers: 'block',
    locale: 'es-GT',
    timezoneId: 'America/Guatemala',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'pc', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'iphone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: 'python3 -m http.server 8123 --bind 127.0.0.1 --directory ..',
    url: 'http://127.0.0.1:8123/index.html',
    reuseExistingServer: !process.env.CI,
  },
});
