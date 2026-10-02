/**
 * The group Feed tab: its filters, its "Load more", and the vote on the day's
 * disagreement.
 *
 * Filtering and paging re-fetch /groups/[id]/feed — the same loader and
 * components the page rendered — rather than building cards in JS, so the
 * markup can't drift from the first paint. Voting is the exception: the API
 * returns the new counts and the card is already carrying the elements to put
 * them in, so it updates in place instead of re-rendering the feed under
 * someone who has scrolled.
 *
 * Every listener is delegated from document and registered once, because the
 * controls are replaced on each swap.
 */
import { votePercents } from "../utils/groupFeed";

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

/** Take a side in the day's disagreement. */
async function vote(button: HTMLElement) {
  const card = button.closest<HTMLElement>("[data-dd-root]");
  const votedFor = button.dataset.ddVote;
  const groupId = card?.dataset.ddGroup;
  if (!card || !votedFor || !groupId || card.dataset.ddBusy === "1") return;

  card.dataset.ddBusy = "1";
  const error = card.querySelector<HTMLElement>("[data-dd-error]");
  if (error) error.hidden = true;
  try {
    const res = await fetch("/api/groups/disagreement/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: groupId, voted_for: votedFor }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) throw new Error(data?.error ?? String(res.status));
    card.dataset.ddVoted = data.voted_for;
    paintVote(card, data);
  } catch {
    if (error) error.hidden = false;
  } finally {
    card.dataset.ddBusy = "";
  }
}

function paintVote(
  card: HTMLElement,
  data: { voted_for: string; high: { profile_id: string; votes: number }; low: { profile_id: string; votes: number } }
) {
  const pct = votePercents(data.high.votes, data.low.votes);
  const share: Record<string, { votes: number; pct: number }> = {
    [data.high.profile_id]: { votes: data.high.votes, pct: pct.high },
    [data.low.profile_id]: { votes: data.low.votes, pct: pct.low },
  };

  for (const result of card.querySelectorAll<HTMLElement>("[data-dd-result]")) {
    const side = share[result.dataset.ddResult ?? ""];
    if (!side) continue;
    result.hidden = false;
    const bar = result.querySelector<HTMLElement>("[data-dd-bar]");
    if (bar) bar.style.width = `${side.pct}%`;
    const pctEl = result.querySelector<HTMLElement>("[data-dd-pct]");
    if (pctEl) pctEl.textContent = String(side.pct);
    const votesEl = result.querySelector<HTMLElement>("[data-dd-votes]");
    if (votesEl) votesEl.textContent = String(side.votes);
  }

  for (const btn of card.querySelectorAll<HTMLElement>("[data-dd-vote]")) {
    const on = btn.dataset.ddVote === data.voted_for;
    btn.classList.toggle("dd-vote-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? "You're with them" : `Side with @${btn.dataset.ddUsername ?? ""}`;
    btn.closest<HTMLElement>(".dd-side")?.classList.toggle("dd-side-mine", on);
  }

  const prompt = card.querySelector<HTMLElement>("[data-dd-prompt]");
  if (prompt) prompt.hidden = true;
  const tallied = card.querySelector<HTMLElement>("[data-dd-tallied]");
  if (tallied) tallied.hidden = false;
  const total = card.querySelector<HTMLElement>("[data-dd-total]");
  if (total) total.textContent = String(data.high.votes + data.low.votes);
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
    if (moreBtn) { void loadMore(moreBtn); return; }

    const voteBtn = target.closest<HTMLElement>("[data-dd-vote]");
    if (voteBtn) void vote(voteBtn);
  });
}

initGroupFeed();
