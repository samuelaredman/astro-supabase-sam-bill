/**
 * The group Stats tab's "compare with" menu, and its games list's filters,
 * sort and "Show more".
 *
 * Picking someone re-fetches the tab from /groups/[id]/compare — the same
 * loader and component the page rendered — and swaps it into #compare-panel, so
 * the markup can't drift from the first paint. The pick rides in the URL
 * (?with=), so a comparison is a link someone can share.
 *
 * The games list swaps on its own, from /groups/[id]/compare?part=games, with
 * its filter, sort and length in the URL too (?gf= / ?gs= / ?gn=).
 *
 * The listeners are delegated from document and registered once, because the
 * menu and the list are replaced on each swap.
 */

const PANEL_ID = "compare-panel";

function panel(): HTMLElement | null {
  return document.getElementById(PANEL_ID);
}

/** Latest request wins: an earlier, slower response must not overwrite it. */
let requestSeq = 0;

/** The settings the Stats tab's fragment route reads, from a page URL. */
function fragmentQuery(pageUrl: URL, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams(extra);
  for (const key of ["with", "gf", "gs", "gn"]) {
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
  for (const key of ["tab", "with", "gf", "gs", "gn"]) {
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
    // A new sort starts the list again from one page
    const sort = target?.closest<HTMLSelectElement>("[data-gv-sort]");
    if (sort && panel()?.contains(sort)) {
      const url = new URL(window.location.href);
      if (sort.value === "gap") url.searchParams.delete("gs");
      else url.searchParams.set("gs", sort.value);
      url.searchParams.delete("gn");
      void showGames(url);
    }
  });

  // Filter chips and "Show more" are real links; take them over to swap in place
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[data-gv-games-link]");
    if (!link || !panel()?.contains(link)) return;
    event.preventDefault();
    void showGames(new URL(link.href));
  });
}

initGroupCompare();
