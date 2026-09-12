/**
 * The group Stats tab's controls: the member picker, the sort and the "any pick
 * / all picks" mode.
 *
 * Changing any of them re-fetches the tab from /groups/[id]/compare — the same
 * loader and component the page rendered — and swaps it into #compare-panel, so
 * the markup can't drift from the first paint. The chosen members ride in the
 * URL (?with=), so a comparison is a link someone can share.
 *
 * Every listener is delegated from document and registered once, because the
 * controls themselves are replaced on each swap.
 */
import { COMPARE_MAX_MEMBERS } from "../utils/groupCompare";

const PANEL_ID = "compare-panel";

interface CompareState {
  groupId: string;
  selected: string[];
  sort: string;
  mode: string;
}

function panel(): HTMLElement | null {
  return document.getElementById(PANEL_ID);
}

function root(): HTMLElement | null {
  return panel()?.querySelector<HTMLElement>(".gc-root") ?? null;
}

/**
 * The state the server last rendered, off the root's data attributes, rather
 * than off which chips look selected — the picker is ordered by review count,
 * and the order members were picked in is what gives each one its colour.
 */
function readState(): CompareState | null {
  const el = root();
  if (!el) return null;
  return {
    groupId: el.dataset.gcGroup ?? "",
    selected: (el.dataset.gcSelected ?? "").split(",").filter(Boolean),
    sort: el.dataset.gcSortValue ?? "",
    mode: el.dataset.gcModeValue ?? "any",
  };
}

/**
 * Repaint the chips from the state that is actually on screen. A chip is painted
 * the moment it's clicked so the picker feels immediate; if the re-fetch then
 * fails, that paint is a lie — the chip would read as picked next to a
 * comparison that doesn't include them.
 */
function syncChips() {
  const host = panel();
  const selected = new Set(readState()?.selected ?? []);
  for (const chip of host?.querySelectorAll<HTMLElement>("[data-gc-toggle]") ?? []) {
    const on = selected.has(chip.dataset.gcToggle ?? "");
    chip.classList.toggle("gc-chip-on", on);
    chip.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

function showError(show: boolean) {
  const el = panel()?.querySelector<HTMLElement>("[data-gc-error]");
  if (el) el.hidden = !show;
}

/** Latest request wins: an earlier, slower response must not overwrite it. */
let requestSeq = 0;

async function render(next: CompareState) {
  const host = panel();
  if (!host) return;

  const params = new URLSearchParams({ sort: next.sort, mode: next.mode });
  if (next.selected.length > 0) params.set("with", next.selected.join(","));

  // Keep the address bar shareable, without filling up the back button
  const pageUrl = new URL(window.location.href);
  pageUrl.searchParams.set("tab", "compare");
  for (const [key, value] of params) pageUrl.searchParams.set(key, value);
  if (next.selected.length === 0) pageUrl.searchParams.delete("with");
  history.replaceState(null, "", pageUrl);

  const seq = ++requestSeq;
  host.classList.add("gc-busy");
  showError(false);
  // Preserve what the viewer had typed into the member filter across the swap
  const search = host.querySelector<HTMLInputElement>("[data-gc-search]");
  const query = search?.value ?? "";

  let ok = false;
  try {
    const res = await fetch(`/groups/${next.groupId}/compare?${params}`, {
      headers: { Accept: "text/html" },
    });
    if (seq !== requestSeq) return;
    if (res.ok) {
      host.innerHTML = await res.text();
      ok = true;
      if (query) {
        const input = host.querySelector<HTMLInputElement>("[data-gc-search]");
        if (input) {
          input.value = query;
          filterPicker(query);
        }
      }
    }
  } catch {
    // Keep the comparison that's on screen rather than blanking it
  } finally {
    if (seq === requestSeq) {
      host.classList.remove("gc-busy");
      // On failure the old comparison is still rendered, so put the chips back
      // to match it instead of leaving the click's optimistic paint behind
      if (!ok) {
        syncChips();
        showError(true);
      }
    }
  }
}

function filterPicker(query: string) {
  const host = panel();
  if (!host) return;
  const needle = query.trim().toLowerCase();
  let shown = 0;
  for (const chip of host.querySelectorAll<HTMLElement>("[data-gc-toggle]")) {
    const match = !needle || (chip.dataset.gcUsername ?? "").toLowerCase().includes(needle);
    chip.hidden = !match;
    if (match) shown++;
  }
  const empty = host.querySelector<HTMLElement>("[data-gc-picker-empty]");
  if (empty) empty.hidden = shown > 0;
}

let hintTimer: number | undefined;
function flashHint() {
  const hint = panel()?.querySelector<HTMLElement>("[data-gc-hint]");
  if (!hint) return;
  hint.hidden = false;
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => { hint.hidden = true; }, 2600);
}

export function initGroupCompare() {
  if ((window as any).__gcInit) return;
  (window as any).__gcInit = true;

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target || !panel()?.contains(target)) return;

    const chip = target.closest<HTMLElement>("[data-gc-toggle]");
    if (chip) {
      const state = readState();
      const id = chip.dataset.gcToggle;
      if (!state || !id) return;
      const at = state.selected.indexOf(id);
      if (at >= 0) {
        state.selected.splice(at, 1);
      } else if (state.selected.length >= COMPARE_MAX_MEMBERS) {
        flashHint();
        return;
      } else {
        state.selected.push(id);
      }
      // Paint the chip immediately; the swap confirms it a moment later
      chip.classList.toggle("gc-chip-on", at < 0);
      chip.setAttribute("aria-pressed", at < 0 ? "true" : "false");
      void render(state);
      return;
    }

    const modeBtn = target.closest<HTMLElement>("[data-gc-mode]");
    if (modeBtn) {
      const state = readState();
      const mode = modeBtn.dataset.gcMode;
      if (!state || !mode || mode === state.mode) return;
      void render({ ...state, mode });
    }
  });

  document.addEventListener("change", (event) => {
    const select = (event.target as HTMLElement | null)?.closest<HTMLSelectElement>("[data-gc-sort]");
    if (!select || !panel()?.contains(select)) return;
    const state = readState();
    if (!state) return;
    void render({ ...state, sort: select.value });
  });

  document.addEventListener("input", (event) => {
    const input = (event.target as HTMLElement | null)?.closest<HTMLInputElement>("[data-gc-search]");
    if (!input || !panel()?.contains(input)) return;
    filterPicker(input.value);
  });
}

initGroupCompare();
