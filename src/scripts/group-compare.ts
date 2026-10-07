/**
 * The group Stats tab's searchable "compare with" picker, and its games list's
 * search, menus and "Show more".
 *
 * Picking someone re-fetches the tab from /groups/[id]/compare — the same
 * loader and component the page rendered — and swaps it into #compare-panel, so
 * the markup can't drift from the first paint. The pick rides in the URL
 * (?with=), so a comparison is a link someone can share.
 *
 * The games list swaps on its own, from /groups/[id]/compare?part=games, with
 * its search, filter, genre, sort and length in the URL too
 * (?gq= / ?gf= / ?gg= / ?gs= / ?gn=).
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
  for (const key of ["with", "sc", "gg", "gq", "gf", "gs", "gn"]) {
    const value = pageUrl.searchParams.get(key);
    if (value) q.set(key, value);
  }
  const str = q.toString();
  return str ? `?${str}` : "";
}

/** Compare with someone else (a member's id, or "" for the community). */
function compareWith(withId: string) {
  // The games list keeps its filters and sort, but starts again from one page
  const pageUrl = new URL(window.location.href);
  pageUrl.searchParams.set("tab", "compare");
  if (withId) pageUrl.searchParams.set("with", withId);
  else pageUrl.searchParams.delete("with");
  pageUrl.searchParams.delete("gn");
  return refreshTab(pageUrl);
}

/**
 * Show the whole tab for another view (who you compare with, the tab-wide
 * scope or genre): re-fetch it from /groups/[id]/compare and swap it in. The
 * address bar takes on the view, so it stays shareable without filling up the
 * back button. `jump` scrolls to the games list once it's in.
 */
async function refreshTab(pageUrl: URL, jump = false) {
  const host = panel();
  const groupId = host?.querySelector<HTMLElement>("[data-gv-group]")?.dataset.gvGroup;
  if (!host || !groupId) return;
  const next = new URL(window.location.href);
  for (const key of ["tab", "with", "sc", "gg", "gq", "gf", "gs", "gn"]) {
    const value = pageUrl.searchParams.get(key);
    if (value) next.searchParams.set(key, value);
    else next.searchParams.delete(key);
  }
  next.hash = "";
  history.replaceState(null, "", next);

  const seq = ++requestSeq;
  host.classList.add("gv-busy");
  let ok = false;
  try {
    const res = await fetch(`/groups/${groupId}/compare${fragmentQuery(next)}`, { headers: { Accept: "text/html" } });
    if (seq !== requestSeq) return;
    if (res.ok) {
      host.innerHTML = await res.text();
      syncColorControls();
      ok = true;
      if (jump) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        document.getElementById("gv-games")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }
    }
  } catch {
    // Keep the comparison that's on screen rather than blanking it
  } finally {
    if (seq === requestSeq) {
      host.classList.remove("gv-busy");
      if (!ok) {
        // The picker still shows who's on screen, since only a successful swap changes it
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
  for (const key of ["tab", "with", "sc", "gg", "gq", "gf", "gs", "gn"]) {
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
      const html = await res.text();
      if (seq !== gamesSeq) return;
      // Someone typing in the search box keeps their place, and anything typed
      // since this request went out (the next one is on its way)
      const current = host.querySelector<HTMLElement>("[data-gv-games]");
      const box = document.activeElement as HTMLInputElement | null;
      const typing = box?.matches?.("[data-gv-search]") && current?.contains(box) ? box : null;
      (current ?? list).outerHTML = html;
      const next = host.querySelector<HTMLInputElement>("[data-gv-search]");
      if (typing && next) {
        next.value = typing.value;
        next.focus();
        next.setSelectionRange(typing.selectionStart, typing.selectionEnd);
      }
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

// ── "Compare with" picker ──
// A button opening a searchable list. Typing filters the listed members at
// once, then asks /groups/[id]/compare?part=members&q= so anyone in the group
// can be found, not just the members listed at first. A leading @ is ignored.

function picker(): HTMLElement | null {
  return panel()?.querySelector<HTMLElement>("[data-gv-picker]") ?? null;
}

function setPickerOpen(open: boolean, focusToggle = false) {
  const root = picker();
  const pop = root?.querySelector<HTMLElement>("[data-gv-pick-pop]");
  const toggle = root?.querySelector<HTMLElement>("[data-gv-pick-toggle]");
  if (!root || !pop || !toggle) return;
  pop.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  if (open) root.querySelector<HTMLInputElement>("[data-gv-pick-search]")?.focus();
  else if (focusToggle) toggle.focus();
}

const memberQuery = (raw: string) => raw.trim().replace(/^@+/, "").trim().toLowerCase();

/** Hide listed members whose name doesn't contain the query. */
function filterPickerLocally(q: string) {
  picker()?.querySelectorAll<HTMLElement>(".gv-pick-opt[data-gv-name]").forEach((opt) => {
    opt.hidden = !!q && !(opt.dataset.gvName ?? "").includes(q);
  });
}

let pickSeq = 0;
let pickTimer: ReturnType<typeof setTimeout> | undefined;

async function searchMembers(raw: string) {
  const host = panel();
  const groupId = host?.querySelector<HTMLElement>("[data-gv-group]")?.dataset.gvGroup;
  const list = picker()?.querySelector<HTMLElement>("[data-gv-pick-list]");
  if (!host || !groupId || !list) return;
  const seq = ++pickSeq;
  const q = new URLSearchParams({ part: "members" });
  const withId = new URL(window.location.href).searchParams.get("with");
  if (withId) q.set("with", withId);
  if (memberQuery(raw)) q.set("q", memberQuery(raw));
  try {
    const res = await fetch(`/groups/${groupId}/compare?${q}`, { headers: { Accept: "text/html" } });
    if (seq !== pickSeq || !res.ok) return;
    const html = await res.text();
    if (seq !== pickSeq) return;
    list.innerHTML = html;
  } catch {
    // Keep the locally filtered list
  }
}

/** The options someone can move to with the arrow keys. */
function visibleOptions(): HTMLElement[] {
  return [...(picker()?.querySelectorAll<HTMLElement>(".gv-pick-opt") ?? [])].filter((o) => !o.hidden);
}

export function initGroupCompare() {
  if ((window as any).__gvInit) return;
  (window as any).__gvInit = true;

  document.addEventListener("change", (event) => {
    const target = event.target as HTMLElement | null;
    // The tab-wide scope and genre change every number on the tab
    const wide = target?.closest<HTMLSelectElement>("[data-gv-scope], [data-gv-genre]");
    if (wide && panel()?.contains(wide)) {
      const [param, fallback] = wide.matches("[data-gv-scope]") ? ["sc", "all"] : ["gg", ""];
      const url = new URL(window.location.href);
      if (wide.value === fallback) url.searchParams.delete(param);
      else url.searchParams.set(param, wide.value);
      url.searchParams.delete("gn");
      // "Only you / only them" only exists under every game
      if (param === "sc" && wide.value !== "all") url.searchParams.delete("gf");
      void refreshTab(url);
      return;
    }
    // A new list filter or sort starts the list again from one page
    const menu = target?.closest<HTMLSelectElement>("[data-gv-filter], [data-gv-sort]");
    if (menu && panel()?.contains(menu)) {
      const [param, fallback] = menu.matches("[data-gv-filter]") ? ["gf", "all"] : ["gs", "gap"];
      const url = new URL(window.location.href);
      if (menu.value === fallback) url.searchParams.delete(param);
      else url.searchParams.set(param, menu.value);
      url.searchParams.delete("gn");
      void showGames(url);
    }
  });

  // The "compare with" picker
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const root = picker();
    if (!root) return;
    if (target?.closest("[data-gv-pick-toggle]") && root.contains(target)) {
      const pop = root.querySelector<HTMLElement>("[data-gv-pick-pop]");
      setPickerOpen(!!pop?.hidden);
      return;
    }
    const opt = target?.closest<HTMLElement>(".gv-pick-opt");
    if (opt && root.contains(opt)) {
      setPickerOpen(false, true);
      const id = opt.dataset.gvWithId ?? "";
      const current = new URL(window.location.href).searchParams.get("with") ?? "";
      if (id !== current) void compareWith(id);
      return;
    }
    if (!root.contains(target)) setPickerOpen(false);
  });
  document.addEventListener("input", (event) => {
    const box = (event.target as HTMLElement | null)?.closest<HTMLInputElement>("[data-gv-pick-search]");
    if (!box || !picker()?.contains(box)) return;
    filterPickerLocally(memberQuery(box.value));
    clearTimeout(pickTimer);
    pickTimer = setTimeout(() => void searchMembers(box.value), 200);
  });
  document.addEventListener("keydown", (event) => {
    const root = picker();
    const target = event.target as HTMLElement | null;
    if (!root || !target || !root.contains(target)) return;
    const pop = root.querySelector<HTMLElement>("[data-gv-pick-pop]");
    if (!pop || pop.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setPickerOpen(false, true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const opts = visibleOptions();
    if (opts.length === 0) return;
    const at = opts.indexOf(target);
    const next = event.key === "ArrowDown"
      ? opts[at < 0 ? 0 : Math.min(at + 1, opts.length - 1)]
      : at <= 0 ? root.querySelector<HTMLElement>("[data-gv-pick-search]") : opts[at - 1];
    next?.focus();
  });

  // Searching: as you type, once you pause
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const search = (value: string) => {
    clearTimeout(searchTimer);
    const url = new URL(window.location.href);
    const q = value.trim();
    if (q) url.searchParams.set("gq", q);
    else url.searchParams.delete("gq");
    url.searchParams.delete("gn");
    if (url.searchParams.get("gq") === new URL(window.location.href).searchParams.get("gq")) return;
    void showGames(url);
  };
  document.addEventListener("input", (event) => {
    const box = (event.target as HTMLElement | null)?.closest<HTMLInputElement>("[data-gv-search]");
    if (!box || !panel()?.contains(box)) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => search(box.value), 300);
  });
  // Enter in the picker's search picks the first match
  document.addEventListener("keydown", (event) => {
    const box = (event.target as HTMLElement | null)?.closest<HTMLInputElement>("[data-gv-pick-search]");
    if (!box || event.key !== "Enter" || !picker()?.contains(box)) return;
    event.preventDefault();
    const first = visibleOptions().find((o) => o.dataset.gvName) ?? visibleOptions()[0];
    first?.click();
  });
  document.addEventListener("submit", (event) => {
    const form = (event.target as HTMLElement | null)?.closest<HTMLFormElement>("[data-gv-search-form]");
    if (!form || !panel()?.contains(form)) return;
    event.preventDefault();
    search(form.querySelector<HTMLInputElement>("[data-gv-search]")?.value ?? "");
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

  // "Show more", the shared-games / within-a-point numbers and "Clear filters" are real links; take them over to swap in place
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    // The shared-games / within-a-point numbers and "Clear filters" change the whole tab
    const tabLink = target?.closest<HTMLAnchorElement>("a[data-gv-tab-link]");
    if (tabLink && panel()?.contains(tabLink)) {
      event.preventDefault();
      void refreshTab(new URL(tabLink.href), tabLink.hasAttribute("data-gv-jump"));
      return;
    }
    const link = target?.closest<HTMLAnchorElement>("a[data-gv-games-link]");
    if (!link || !panel()?.contains(link)) return;
    event.preventDefault();
    void showGames(new URL(link.href));
  });
}

initGroupCompare();
