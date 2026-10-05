/**
 * The group Feed tab: its filters and its "Load more".
 *
 * Filtering and paging re-fetch /groups/[id]/feed — the same loader and
 * components the page rendered — rather than building cards in JS, so the
 * markup can't drift from the first paint.
 *
 * Every listener is delegated from document and registered once, because the
 * controls are replaced on each swap.
 */
const PANEL_ID = "feed-panel";

function panel(): HTMLElement | null {
  return document.getElementById(PANEL_ID);
}

function root(): HTMLElement | null {
  return panel()?.querySelector<HTMLElement>("[data-gf-root]") ?? null;
}

function showFeedError(show: boolean) {
  const el = panel()?.querySelector<HTMLElement>("[data-gf-error]");
  if (el) el.hidden = !show;
}

/** Latest request wins: an earlier, slower response must not overwrite it. */
let requestSeq = 0;

/** Swap the whole tab — a filter change. */
async function applyFilter(filter: string) {
  const host = panel();
  const el = root();
  if (!host || !el) return;
  const groupId = el.dataset.gfGroup;
  if (!groupId) return;

  // Paint the pressed filter at once; the swap confirms it a moment later
  for (const btn of host.querySelectorAll<HTMLElement>("[data-gf-filter-btn]")) {
    const on = btn.dataset.gfFilterBtn === filter;
    btn.classList.toggle("gf-filter-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  const url = new URL(window.location.href);
  url.searchParams.set("tab", "feed");
  if (filter === "all") url.searchParams.delete("filter");
  else url.searchParams.set("filter", filter);
  history.replaceState(null, "", url);

  const seq = ++requestSeq;
  host.classList.add("gf-busy");
  showFeedError(false);
  try {
    const res = await fetch(`/groups/${groupId}/feed?filter=${encodeURIComponent(filter)}`, {
      headers: { Accept: "text/html" },
    });
    if (seq !== requestSeq) return;
    if (!res.ok) { showFeedError(true); return; }
    host.innerHTML = await res.text();
  } catch {
    if (seq === requestSeq) showFeedError(true);
  } finally {
    if (seq === requestSeq) host.classList.remove("gf-busy");
  }
}

/** Append the next page in place of the button that asked for it. */
async function loadMore(button: HTMLElement) {
  const el = root();
  const groupId = el?.dataset.gfGroup;
  const filter = el?.dataset.gfFilter ?? "all";
  const offset = button.dataset.gfMore;
  if (!groupId || !offset || button.dataset.gfLoading === "1") return;

  button.dataset.gfLoading = "1";
  const label = button.textContent;
  button.textContent = "Loading…";
  showFeedError(false);
  try {
    const res = await fetch(
      `/groups/${groupId}/feed?filter=${encodeURIComponent(filter)}&offset=${encodeURIComponent(offset)}`,
      { headers: { Accept: "text/html" } }
    );
    if (!res.ok) throw new Error(String(res.status));
    // The fragment carries the next button, so replacing this one keeps the chain
    button.outerHTML = await res.text();
  } catch {
    button.dataset.gfLoading = "";
    button.textContent = label;
    showFeedError(true);
  }
}

export function initGroupFeed() {
  if ((window as any).__gfInit) return;
  (window as any).__gfInit = true;

  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target || !panel()?.contains(target)) return;

    const filterBtn = target.closest<HTMLElement>("[data-gf-filter-btn]");
    if (filterBtn) {
      const filter = filterBtn.dataset.gfFilterBtn;
      if (filter && filter !== root()?.dataset.gfFilter) void applyFilter(filter);
      return;
    }

    const moreBtn = target.closest<HTMLElement>("[data-gf-more]");
    if (moreBtn) void loadMore(moreBtn);
  });
}

initGroupFeed();
