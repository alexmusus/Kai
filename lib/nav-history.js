// @ts-check
/*
 * lib/nav-history.js — la copia que Kai lleva del historial del navegador, para "volver" e "Inicio".
 *
 * Cada entrada queda marcada con su posición (en history.state). Al llegar a una entrada marcada se sabe exactamente
 * dónde se está, sea atrás o adelante; una sin marca es una página nueva. Así la copia nunca se desfasa del historial
 * real, aunque se navegue hacia adelante a la misma página de antes (Inicio → Ajustes → Serie → Ajustes).
 * Lo anterior a una recarga no se conoce: ahí "volver" no salta y usa su destino de respaldo.
 */

/**
 * @param {string} first la dirección con la que abrió la página
 * @param {number} [firstPos] su posición, si ya estaba marcada (tras recargar)
 */
export function createNavHistory(first, firstPos = 0) {
  /** @type {(string | undefined)[]} */
  const entries = [];
  let pos = firstPos;
  entries[pos] = first;
  return {
    get pos() {
      return pos;
    },
    get current() {
      return entries[pos];
    },
    /**
     * Se llegó a una dirección.
     * @param {string} hash
     * @param {number | null} markedPos la posición marcada de esa entrada, o null si es nueva
     * @param {boolean} replacing si reemplazó a la actual (location.replace) en vez de agregarse
     * @returns {{ pos: number, back: boolean }} su posición (para marcarla) y si fue hacia atrás
     */
    arrive(hash, markedPos, replacing) {
      const prev = pos;
      if (markedPos != null) pos = markedPos;
      else {
        if (!replacing) pos += 1;
        entries.length = pos; // lo que estaba adelante ya no existe
      }
      entries[pos] = hash;
      return { pos, back: pos < prev };
    },
    /**
     * Cuántos pasos hay que retroceder (número negativo) hasta la entrada anterior más cercana que cumpla,
     * o 0 si no hay ninguna conocida.
     * @param {(hash: string) => boolean} match
     */
    stepsBackTo(match) {
      for (let i = pos - 1; i >= 0; i--) {
        const h = entries[i];
        if (h === undefined) return 0;
        if (match(h)) return i - pos;
      }
      return 0;
    },
  };
}
