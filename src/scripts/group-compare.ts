/**
 * The group Stats tab's "compare with" menu.
 *
 * Picking someone re-fetches the tab from /groups/[id]/compare — the same
 * loader and component the page rendered — and swaps it into #compare-panel, so
 * the markup can't drift from the first paint. The pick rides in the URL
 * (?with=), so a comparison is a link someone can share.
 *
 * The listener is delegated from document and registered once, because the
 * menu itself is replaced on each swap.
 */

const PANEL_ID = "compare-panel";

function panel(): HTMLElement | null {
  return document.getElementById(PANEL_ID);
}

/** Latest request wins: an earlier, slower response must not overwrite it. */
let requestSeq = 0;

async function compareWith(select: HTMLSelectElement) {
  const host = panel();
  const groupId = host?.querySelector<HTMLElement>("[data-gv-group]")?.dataset.gvGroup;
  if (!host || !groupId) return;
  const withId = select.value;
  // What was on screen, to put the menu back if the swap fails
  const previous = [...select.options].find((o) => o.defaultSelected)?.value ?? "";

  // Keep the address bar shareable, without filling up the back button
  const pageUrl = new URL(window.location.href);
  pageUrl.searchParams.set("tab", "compare");
  if (withId) pageUrl.searchParams.set("with", withId);
  else pageUrl.searchParams.delete("with");
  history.replaceState(null, "", pageUrl);

  const seq = ++requestSeq;
  host.classList.add("gv-busy");
  let ok = false;
  try {
    const params = withId ? `?with=${encodeURIComponent(withId)}` : "";
    const res = await fetch(`/groups/${groupId}/compare${params}`, { headers: { Accept: "text/html" } });
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

export function initGroupCompare() {
  if ((window as any).__gvInit) return;
  (window as any).__gvInit = true;

  document.addEventListener("change", (event) => {
    const select = (event.target as HTMLElement | null)?.closest<HTMLSelectElement>("[data-gv-with]");
    if (!select || !panel()?.contains(select)) return;
    void compareWith(select);
  });
}

initGroupCompare();
