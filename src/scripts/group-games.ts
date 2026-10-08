/**
 * The group Games tab's feature form, editing / removing a featured game, and
 * members' written answers to its question (src/components/groups/GamesTab.astro).
 * Everything goes through /api/groups/featured-games/* or
 * /api/groups/polls/answer and reloads the page on success, which stays on
 * ?tab=games.
 *
 * The listeners are delegated from document and registered once; they do
 * nothing on pages without the tab.
 */

interface SearchResult {
  id: string;
  title: string;
  cover_img_url: string | null;
  year: number | null;
  source: "db" | "igdb";
  igdb_id?: number;
}

/** The game picked in the feature form: a Chekpoint game, or an IGDB result to import. */
let chosen: { gameId?: string; igdbId?: number; title: string } | null = null;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
/** The picked game's title: typing anything else in the box un-picks it. */
let chosenTitle = "";
let searchSeq = 0;

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function showError(el: Element | null, message: string) {
  if (!(el instanceof HTMLElement)) return;
  el.textContent = message;
  el.hidden = false;
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error ?? "Something went wrong. Please try again." };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

function groupId(): string | null {
  return document.querySelector<HTMLElement>(".gg[data-group-id]")?.dataset.groupId ?? null;
}

// ── Game search ────────────────────────────────────────────────────────────
// Looks and behaves like the Write a review composer's search
// (src/pages/index.astro): a dropdown of cover, title and year, with "Add to
// Chekpoint" on IGDB results, which the create route imports.

function closeResults() {
  byId("gg-search-results")?.classList.remove("open");
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function resultItem(game: SearchResult): HTMLElement {
  const item = el("div", "autocomplete-item");
  const cover = el("div", "autocomplete-item-cover");
  const coverUrl = game.cover_img_url ? game.cover_img_url.replace(/t_[a-z0-9_]+/, "t_cover_big") : null;
  if (coverUrl) {
    const img = document.createElement("img");
    img.src = coverUrl;
    img.alt = "";
    img.loading = "lazy";
    cover.appendChild(img);
  } else {
    cover.textContent = "🎮";
  }
  const info = el("div", "autocomplete-item-info");
  info.appendChild(el("div", "autocomplete-item-title", game.title));
  const meta: (string | number)[] = [];
  if (game.source === "igdb") meta.push("Add to Chekpoint");
  if (game.year) meta.push(game.year);
  if (meta.length) info.appendChild(el("div", "autocomplete-item-meta", meta.join(" · ")));
  item.append(cover, info);
  item.addEventListener("click", () => {
    const input = byId<HTMLInputElement>("gg-game-input");
    if (input) input.value = game.title;
    chosenTitle = game.title;
    chosen = game.source === "igdb"
      ? { igdbId: Number(game.igdb_id ?? game.id), title: game.title }
      : { gameId: game.id, title: game.title };
    closeResults();
  });
  return item;
}

async function searchGames(q: string) {
  const results = byId("gg-search-results");
  if (!results) return;
  const seq = ++searchSeq;
  let games: SearchResult[] = [];
  try {
    const res = await fetch(`/api/games/search?q=${encodeURIComponent(q)}`);
    if (res.ok) games = await res.json();
  } catch { /* shown as no games found */ }
  if (seq !== searchSeq) return; // a newer search is on its way
  results.replaceChildren(...(games.length
    ? games.map(resultItem)
    : [el("div", "autocomplete-empty", "No games found")]));
  results.classList.add("open");
}

// ── Poll fields ────────────────────────────────────────────────────────────

function addOptionInput(value = "") {
  const box = byId("gg-poll-options");
  if (!box || box.children.length >= 6) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "compose-input gg-input gg-poll-option";
  input.maxLength = Number(box.dataset.maxLength) || 80;
  input.placeholder = `Option ${box.children.length + 1}`;
  input.value = value;
  box.appendChild(input);
}

/** The question and any options; null when the creator didn't ask anything. */
function readPoll(): { question: string; options: string[] } | null {
  const question = byId<HTMLInputElement>("gg-poll-question")?.value.trim() ?? "";
  const options = Array.from(document.querySelectorAll<HTMLInputElement>(".gg-poll-option"))
    .map((i) => i.value.trim())
    .filter(Boolean);
  if (!question && options.length === 0) return null;
  return { question, options };
}

// ── Submit ─────────────────────────────────────────────────────────────────

async function submitFeature(form: HTMLFormElement) {
  const errEl = byId("gg-form-error");
  if (errEl) errEl.hidden = true;
  const group = groupId();
  if (!group) return;
  if (!chosen) return showError(errEl, "Pick a game from the search results.");
  const poll = readPoll();
  if (poll && !poll.question) return showError(errEl, "Write the question your options answer.");
  if (poll && poll.options.length === 1) return showError(errEl, "Add a second option, or remove it to only take written answers.");

  const submit = form.querySelector<HTMLButtonElement>("button[type=submit]");
  if (submit) submit.disabled = true;
  const result = await post("/api/groups/featured-games/create", {
    group_id: group,
    game_id: chosen.gameId,
    igdb_id: chosen.igdbId,
    youtube_url: byId<HTMLInputElement>("gg-video-input")?.value ?? "",
    note: byId<HTMLTextAreaElement>("gg-note-input")?.value ?? "",
    poll,
  });
  if (result.ok) return window.location.reload();
  if (submit) submit.disabled = false;
  showError(errEl, result.error ?? "Couldn't feature the game.");
}

async function submitEdit(form: HTMLFormElement) {
  const id = form.dataset.ggEdit;
  if (!id) return;
  const errEl = form.querySelector(".gg-error");
  if (errEl instanceof HTMLElement) errEl.hidden = true;
  const data = new FormData(form);
  const submit = form.querySelector<HTMLButtonElement>("button[type=submit]");
  if (submit) submit.disabled = true;
  const result = await post("/api/groups/featured-games/update", {
    id,
    youtube_url: String(data.get("youtube_url") ?? ""),
    note: String(data.get("note") ?? ""),
  });
  if (result.ok) return window.location.reload();
  if (submit) submit.disabled = false;
  showError(errEl, result.error ?? "Couldn't save.");
}

async function submitAnswer(form: HTMLFormElement) {
  const pollId = form.dataset.ggAnswer;
  if (!pollId) return;
  const errEl = form.querySelector(".gg-error");
  if (errEl instanceof HTMLElement) errEl.hidden = true;
  const body = String(new FormData(form).get("body") ?? "").trim();
  if (!body) return showError(errEl, "Write an answer first.");
  const submit = form.querySelector<HTMLButtonElement>("button[type=submit]");
  if (submit) submit.disabled = true;
  const result = await post("/api/groups/polls/answer", { poll_id: pollId, body });
  if (result.ok) return window.location.reload();
  if (submit) submit.disabled = false;
  showError(errEl, result.error ?? "Couldn't save your answer.");
}

async function deleteAnswer(btn: HTMLElement) {
  const id = btn.dataset.id;
  if (!id || !confirm("Delete this answer?")) return;
  const result = await post("/api/groups/polls/answer", { action: "delete", answer_id: id });
  if (result.ok) return window.location.reload();
  alert(result.error ?? "Couldn't delete the answer.");
}

async function removeFeatured(btn: HTMLElement) {
  const id = btn.dataset.id;
  if (!id) return;
  if (!confirm(`Remove ${btn.dataset.title ?? "this game"} from the Games tab? Its question and answers will be deleted too.`)) return;
  const result = await post("/api/groups/featured-games/delete", { id });
  if (result.ok) return window.location.reload();
  alert(result.error ?? "Couldn't remove the game.");
}

// ── Wiring ─────────────────────────────────────────────────────────────────

// ── Stats: picking a stage (played / finished / 100%) ──────────────────────
// The panel's data-stage shows that stage's people and lights up its time bar
// (CSS); the stage buttons carry aria-selected.

function pickStage(panel: HTMLElement, stage: string) {
  panel.dataset.stage = stage;
  for (const btn of panel.querySelectorAll<HTMLElement>(".gg-stage[data-gg-stage]")) {
    btn.setAttribute("aria-selected", btn.dataset.ggStage === stage ? "true" : "false");
  }
}

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement | null;
  if (!target?.closest("#gg-feature-form .autocomplete-wrap")) closeResults();
  const stageBtn = target?.closest<HTMLElement>("[data-gg-stage]");
  const stagePanel = stageBtn?.closest<HTMLElement>("[data-gg-stages]");
  if (stageBtn && stagePanel && stageBtn.dataset.ggStage) return pickStage(stagePanel, stageBtn.dataset.ggStage);
  const btn = target?.closest<HTMLElement>("[data-gg-action]");
  if (!btn) return;
  switch (btn.dataset.ggAction) {
    case "toggle-form": {
      const form = byId("gg-feature-form");
      if (!form) return;
      form.hidden = !form.hidden;
      if (!form.hidden) byId("gg-game-input")?.focus();
      return;
    }
    case "add-option": {
      // The first click adds a pair: a vote needs at least two options
      const box = byId("gg-poll-options");
      if (box && box.children.length === 0) addOptionInput();
      return addOptionInput();
    }
    case "delete-answer":
      void deleteAnswer(btn);
      return;
    case "edit": {
      const form = document.querySelector<HTMLElement>(`[data-gg-edit="${btn.dataset.id}"]`);
      if (form) form.hidden = !form.hidden;
      return;
    }
    case "remove":
      void removeFeatured(btn);
      return;
  }
});

document.addEventListener("input", (e) => {
  const target = e.target as HTMLElement | null;
  if (target?.id !== "gg-game-input") return;
  const q = (target as HTMLInputElement).value.trim();
  if (q !== chosenTitle) chosen = null;
  clearTimeout(searchTimer);
  if (q.length < 2) { searchSeq++; closeResults(); return; }
  searchTimer = setTimeout(() => void searchGames(q), 150);
});

// Enter in the game search picks nothing and mustn't submit the feature form
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.target as HTMLElement | null)?.id === "gg-game-input") e.preventDefault();
});

document.addEventListener("submit", (e) => {
  const form = e.target as HTMLElement | null;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id === "gg-feature-form") {
    e.preventDefault();
    void submitFeature(form);
  } else if (form.dataset.ggEdit) {
    e.preventDefault();
    void submitEdit(form);
  } else if (form.dataset.ggAnswer) {
    e.preventDefault();
    void submitAnswer(form);
  }
});
