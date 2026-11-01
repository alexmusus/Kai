// @ts-check
/*
 * views/view-state.js — lo que la pantalla recuerda mientras navegas (no se guarda): qué serie está destacada, etc.
 * Es un solo objeto compartido entre vistas y controladores.
 */

export const viewState = {
  /** @type {number | null} la serie destacada en la portada (y la que estás mirando) */
  heroSi: null,
  /** la eligió quien usa Kai (mouse, teclado o entrando a ella); si no, la portada elige sola */
  heroUser: false,
  /** @type {{ si: number, ki: number, ids: Set<string> } | null} capítulos elegidos para descargar juntos */
  picking: null,
  /** ¿se está reproduciendo algo? (lo pone el reproductor) */
  isPlaying: () => false,
};
