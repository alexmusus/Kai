/*
 * views/icons.js — íconos SVG de la interfaz.
 */

export const ICON = {
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  top: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6 11.5l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
  saved: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20h14"/><path d="M7.5 11l3 3 6-6.5"/></svg>',
  queued:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.5"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true" class="solid"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause:
    '<svg viewBox="0 0 24 24" aria-hidden="true" class="solid"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15"/></svg>',
  folder:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true" class="solid"><path d="M6 5.5v13l9-6.5zM16.5 5.5H19v13h-2.5z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true" class="solid"><path d="M18 5.5v13l-9-6.5zM5 5.5h2.5v13H5z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2 1.2M17.8 15.3l2 1.2M4.2 16.5l2-1.2M17.8 8.7l2-1.2"/></svg>',
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.2L12 4.5l8 6.7V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5H9v5.5H5.5A1.5 1.5 0 0 1 4 19z"/></svg>',
  image:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 3.5 3 3-2.5 4.5 4"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  later: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16l-5-3.6L7 20z"/></svg>',
  laterOn: '<svg viewBox="0 0 24 24" aria-hidden="true" class="solid"><path d="M7 4h10v16l-5-3.6L7 20z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5M9 20.5h6"/></svg>',
  film: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4.5" width="16" height="15" rx="2.5"/><path d="M8 4.5v15M16 4.5v15M4 9h4M4 15h4M16 9h4M16 15h4"/></svg>',
  spark:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l1.8 4.7L18.5 10.5l-4.7 1.8L12 17l-1.8-4.7L5.5 10.5l4.7-1.8z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/></svg>',
  shuffle:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3.5c2 0 3.2 1 4.3 2.6l1.4 2.2c1 1.6 2.3 2.7 4.3 2.7H20M4 17h3.5c1.4 0 2.4-.5 3.2-1.4M13.3 8.4c.8-.9 1.8-1.4 3.2-1.4H20M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5"/></svg>',
  live: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8"/></svg>',
  chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>',
};
