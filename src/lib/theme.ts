/** The saved appearance choice, per device. No saved value means "follow the system". */
export const THEME_STORAGE_KEY = "ucl_hiking_theme";

export type ThemeChoice = "system" | "light" | "dark";

/**
 * Runs in <head> before first paint so a saved theme never flashes the other one.
 * Only "light" and "dark" are applied; anything else leaves the system setting in charge.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
