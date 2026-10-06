/**
 * The group Stats tab's "compare with" menu, and its games list's filter and
 * sort menus and "Show more".
 *
 * Picking someone re-fetches the tab from /groups/[id]/compare — the same
 * loader and component the page rendered — and swaps it into #compare-panel, so
 * the markup can't drift from the first paint. The pick rides in the URL
 * (?with=), so a comparison is a link someone can share.
 *
 * The games list swaps on its own, from /groups/[id]/compare?part=games, with
 * its filter, genre, sort and length in the URL too (?gf= / ?gg= / ?gs= / ?gn=).
 *
 * The listeners are delegated from document and registered once, because the
 * menu and the list are replaced on each swap.
 */

import {
  colorProperties,
  customColors,
  DEFAULT_VERSUS_COLORS,
  parseStoredColors,
  presetColors,
  VERSUS_COLOR_PRESETS,
  VERSUS_COLORS_KEY,
  type StoredVersusColors,
} from "../utils/versusColors";

const PANEL_ID = "compare-panel";

function panel(): HTMLElement | null {
  return document.getElementById(PANEL_ID);
}

/** Latest request wins: an earlier, slower response must not overwrite it. */
let requestSeq = 0;

/** The settings the Stats tab's fragment route reads, from a page URL. */
function fragmentQuery(pageUrl: URL, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams(extra);
  for (const key of ["with", "gf", "gg", "gs", "gn"]) {
    const value = pageUrl.searchParams.get(key);
    if (value) q.set(key, value);
  }
  const str = q.toString();
  return str ? `?${str}` : "";
}

async function compareWith(select: HTMLSelectElement) {
  const host = panel();
  const groupId = host?.querySelector<HTMLElement>("[data-gv-group]")?.dataset.gvGroup;
  if (!host || !groupId) return;
  const withId = select.value;
  // What was on screen, to put the menu back if the swap fails
  const previous = [...select.options].find((o) => o.defaultSelected)?.value ?? "";

  // Keep the address bar shareable, without filling up the back button. The
  // games list keeps its filter and sort, but starts again from one page.
  const pageUrl = new URL(window.location.href);
  pageUrl.searchParams.set("tab", "compare");
  if (withId) pageUrl.searchParams.set("with", withId);
  else pageUrl.searchParams.delete("with");
  pageUrl.searchParams.delete("gn");
  history.replaceState(null, "", pageUrl);

  const seq = ++requestSeq;
  host.classList.add("gv-busy");
  let ok = false;
  try {
    const res = await fetch(`/groups/${groupId}/compare${fragmentQuery(pageUrl)}`, { headers: { Accept: "text/html" } });
    if (seq !== requestSeq) return;
    if (res.ok) {
      host.innerHTML = await res.text();
      syncColorControls();
      ok = true;
    }
  } catch {
    // Keep the comparison that's on screen rather than blanking it
  } finally {
    if (seq === requestSeq) {
      host.classList.remove("gv-busy");
      if (!ok) {
        select.value = previous;
        const error = host.querySelector<HTMLElement>("[data-gv-error]");
        if (error) error.hidden = false;
      }
    }
  }
}

let gamesSeq = 0;

/**
 * Show the games list for another filter, sort or length: re-fetch just the
 * list from /groups/[id]/compare?part=games and swap it in place. `pageUrl` is
 * the view's address, which the address bar takes on.
 */
async function showGames(pageUrl: URL) {
  const host = panel();
  const groupId = host?.querySelector<HTMLElement>("[data-gv-group]")?.dataset.gvGroup;
  const list = host?.querySelector<HTMLElement>("[data-gv-games]");
  if (!host || !groupId || !list) return;
  // Keep the page's own params (and path), take the list's from the link
  const next = new URL(window.location.href);
  for (const key of ["tab", "with", "gf", "gg", "gs", "gn"]) {
    const value = pageUrl.searchParams.get(key);
    if (value) next.searchParams.set(key, value);
    else next.searchParams.delete(key);
  }
  history.replaceState(null, "", next);

  const seq = ++gamesSeq;
  list.classList.add("gv-busy");
  try {
    const res = await fetch(`/groups/${groupId}/compare${fragmentQuery(next, { part: "games" })}`, {
      headers: { Accept: "text/html" },
    });
    if (seq !== gamesSeq) return;
    if (res.ok) {
      list.outerHTML = await res.text();
      return;
    }
  } catch {
    // Fall through: keep what's on screen
  }
  if (seq !== gamesSeq) return;
  list.classList.remove("gv-busy");
  const error = host.querySelector<HTMLElement>("[data-gv-error]");
  if (error) error.hidden = false;
}

// ── Side colours ──
// The pick lives in localStorage and on <html> as --gv-pick-*, which outlive
// every swap of the tab. CompareTab's inline script applies it before paint;
// this keeps the picker's controls in step and handles changes.

function storedColors(): StoredVersusColors | null {
  try {
    return parseStoredColors(localStorage.getItem(VERSUS_COLORS_KEY));
  } catch {
    return null;
  }
}

function currentColors(): StoredVersusColors {
  return storedColors() ?? presetColors(DEFAULT_VERSUS_COLORS);
}

function applyColors(c: StoredVersusColors | null) {
  const root = document.documentElement.style;
  for (const name of Object.keys(colorProperties(presetColors(DEFAULT_VERSUS_COLORS)))) root.removeProperty(name);
  if (c) for (const [name, value] of Object.entries(colorProperties(c))) root.setProperty(name, value);
  try {
    if (c) localStorage.setItem(VERSUS_COLORS_KEY, JSON.stringify(c));
    else localStorage.removeItem(VERSUS_COLORS_KEY);
  } catch {
    // Private mode and the like: the colours still apply for this visit
  }
  syncColorControls();
}

/** Mark the chosen preset and show the colours in use in the custom pickers. */
function syncColorControls() {
  const c = currentColors();
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const host = panel();
  host?.querySelectorAll<HTMLElement>("[data-gv-preset]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.gvPreset === c.preset));
  });
  host?.querySelectorAll<HTMLInputElement>("[data-gv-color]").forEach((input) => {
    const side = input.dataset.gvColor === "r" ? "r" : "l";
    input.value = dark ? (side === "l" ? c.ld ?? c.l : c.rd ?? c.r) : c[side];
  });
}

export function initGroupCompare() {
  if ((window as any).__gvInit) return;
  (window as any).__gvInit = true;

  document.addEventListener("change", (event) => {
    const target = event.target as HTMLElement | null;
    const select = target?.closest<HTMLSelectElement>("[data-gv-with]");
    if (select && panel()?.contains(select)) {
      void compareWith(select);
      return;
    }
    // A new filter, genre or sort starts the list again from one page
    const menu = target?.closest<HTMLSelectElement>("[data-gv-filter], [data-gv-genre], [data-gv-sort]");
    if (menu && panel()?.contains(menu)) {
      const [param, fallback] = menu.matches("[data-gv-filter]") ? ["gf", "all"]
        : menu.matches("[data-gv-genre]") ? ["gg", ""]
        : ["gs", "gap"];
      const url = new URL(window.location.href);
      if (menu.value === fallback) url.searchParams.delete(param);
      else url.searchParams.set(param, menu.value);
      url.searchParams.delete("gn");
      void showGames(url);
    }
  });

  // A custom colour, live as the picker moves
  document.addEventListener("input", (event) => {
    const input = (event.target as HTMLElement | null)?.closest<HTMLInputElement>("[data-gv-color]");
    if (!input || !panel()?.contains(input)) return;
    // Keep the other side as it looks now, in this theme's shade
    const c = currentColors();
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const shown = dark ? { ...c, l: c.ld ?? c.l, r: c.rd ?? c.r } : c;
    applyColors(customColors(shown, input.dataset.gvColor === "r" ? "r" : "l", input.value));
  });

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const host = panel();
    const preset = target?.closest<HTMLElement>("[data-gv-preset]");
    if (preset && host?.contains(preset)) {
      const p = VERSUS_COLOR_PRESETS.find((x) => x.id === preset.dataset.gvPreset);
      // The default is no stored pick at all, so the page's own colours apply
      if (p) applyColors(p.id === DEFAULT_VERSUS_COLORS.id ? null : presetColors(p));
      return;
    }
    if (target?.closest("[data-gv-colors-reset]") && host?.contains(target)) {
      applyColors(null);
      return;
    }
    // Clicking anywhere else closes the picker
    host?.querySelectorAll<HTMLDetailsElement>("details[data-gv-colors][open]").forEach((d) => {
      if (!d.contains(target)) d.open = false;
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    panel()?.querySelectorAll<HTMLDetailsElement>("details[data-gv-colors][open]").forEach((d) => {
      d.open = false;
      d.querySelector("summary")?.focus();
    });
  });
  syncColorControls();

  // "Show more" is a real link; take it over to swap in place
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[data-gv-games-link]");
    if (!link || !panel()?.contains(link)) return;
    event.preventDefault();
    void showGames(new URL(link.href));
  });
}

initGroupCompare();
