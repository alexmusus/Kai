/*
 * controllers/player/state.js — lo que el reproductor recuerda mientras funciona. Un solo objeto que comparten
 * sus partes (motor, controles, gestos, capítulos e intros), en vez de variables sueltas.
 */

export const P = {
  /** @type {any} lo que se está reproduciendo: { ep, ctx, source, chapters, intro, … }, o null */
  playing: null,
  /** velocidad elegida */
  speed: 1,
  /** @type {ReturnType<typeof setTimeout> | undefined} para esconder los controles */
  idleTimer: undefined,
  /** @type {ReturnType<typeof setTimeout> | undefined} cuenta atrás para el siguiente capítulo */
  nextTimer: undefined,
  /** arrastrando la línea de tiempo */
  seeking: false,
  /** @type {AbortController | null} lectura de capítulos del MP4 en curso */
  chapCtrl: null,
  /** el último error del flujo de video que avisó el service worker */
  lastStreamError: '',
  /** @type {number | null} a dónde se está saltando con ± (el video llega un momento después) */
  jumpTo: null,
  /** @type {number | null} desde dónde se adelantó (para "volver a la intro") */
  seekFrom: null,
  /* toques en el video (doble toque a los lados para ±10 s) */
  lastTap: 0,
  lastTapSide: '',
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  tapTimer: undefined,
  lastTouchEnd: 0,
  /** @type {any} gesto táctil en curso */
  touch: null,
};
