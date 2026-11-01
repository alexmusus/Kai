// Lo que el navegador tiene y TypeScript no conoce: core.js (script clásico) se cuelga de window.
interface Window { MegaCore: any }
