/**
 * The group Games tab's feature form, and editing / removing a featured game
 * (src/components/groups/GamesTab.astro). Everything goes through
 * /api/groups/featured-games/* and reloads the page on success, which stays on
 * ?tab=games.
 *
 * The listeners are delegated from document and registered once; they do
 * nothing on pages without the tab.
 */

interface Preset {
  id: string;
  question: string;
  options: string[];
}

interface SearchResult {
  id: string;
  title: string;
  year: number | null;
  source: "db" | "igdb";
  igdb_id?: number;
}

/** The game picked in the feature form: a Chekpoint game, or an IGDB result to import. */
let chosen: { gameId?: string; igdbId?: number; title: string } | null = null;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
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

function setChosen(game: typeof chosen) {
  chosen = game;
  const input = byId<HTMLInputElement>("gg-game-input");
  const box = byId("gg-game-chosen");
  const title = byId("gg-game-chosen-title");
  const results = byId("gg-search-results");
  if (results) results.replaceChildren();
  if (input) input.hidden = !!game;
  if (box) box.hidden = !game;
  if (title) title.textContent = game?.title ?? "";
  if (!game && input) { input.value = ""; input.focus(); }
}

async function searchGames(q: string) {
  const results = byId("gg-search-results");
  if (!results) return;
  const seq = ++searchSeq;
  if (q.length < 2) { results.replaceChildren(); return; }
  let games: SearchResult[] = [];
  try {
    const res = await fetch(`/api/games/search?q=${encodeURIComponent(q)}`);
    if (res.ok) games = await res.json();
  } catch { /* leave the list empty */ }
  if (seq !== searchSeq) return; // a newer search is on its way
  results.replaceChildren(...games.slice(0, 6).map((g) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gg-search-result";
    btn.textContent = g.year ? `${g.title} (${g.year})` : g.title;
    btn.addEventListener("click", () => {
      setChosen(g.source === "igdb"
        ? { igdbId: Number(g.igdb_id ?? g.id), title: g.title }
        : { gameId: g.id, title: g.title });
    });
    return btn;
  }));
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

function applyPreset(id: string) {
  const form = byId("gg-feature-form");
  const fields = byId("gg-poll-fields");
  const question = byId<HTMLInputElement>("gg-poll-question");
  const box = byId("gg-poll-options");
  if (!form || !fields || !question || !box) return;
  fields.hidden = !id;
  box.replaceChildren();
  if (!id) return;
  let presets: Preset[] = [];
  try { presets = JSON.parse(form.dataset.presets ?? "[]"); } catch { /* none */ }
  const preset = presets.find((p) => p.id === id);
  question.value = preset?.question ?? "";
  (preset?.options ?? ["", ""]).forEach((o) => addOptionInput(o));
}

function readPoll(): { question: string; options: string[] } | null {
  const preset = byId<HTMLSelectElement>("gg-poll-preset")?.value;
  if (!preset) return null;
  return {
    question: byId<HTMLInputElement>("gg-poll-question")?.value.trim() ?? "",
    options: Array.from(document.querySelectorAll<HTMLInputElement>(".gg-poll-option"))
      .map((i) => i.value.trim())
      .filter(Boolean),
  };
}

// ── Submit ─────────────────────────────────────────────────────────────────

async function submitFeature(form: HTMLFormElement) {
  const errEl = byId("gg-form-error");
  if (errEl) errEl.hidden = true;
  const group = groupId();
  if (!group) return;
  if (!chosen) return showError(errEl, "Pick a game first.");
  const poll = readPoll();
  if (poll && !poll.question) return showError(errEl, "Add a question for the poll, or choose No poll.");
  if (poll && poll.options.length < 2) return showError(errEl, "The poll needs at least 2 options.");

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

async function removeFeatured(btn: HTMLElement) {
  const id = btn.dataset.id;
  if (!id) return;
  if (!confirm(`Remove ${btn.dataset.title ?? "this game"} from the Games tab? Its poll will be deleted too.`)) return;
  const result = await post("/api/groups/featured-games/delete", { id });
  if (result.ok) return window.location.reload();
  alert(result.error ?? "Couldn't remove the game.");
}

// ── Wiring ─────────────────────────────────────────────────────────────────

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement | null;
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
    case "clear-game":
      return setChosen(null);
    case "add-option":
      return addOptionInput();
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
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void searchGames(q), 250);
});

document.addEventListener("change", (e) => {
  const target = e.target as HTMLElement | null;
  if (target?.id === "gg-poll-preset") applyPreset((target as HTMLSelectElement).value);
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
  }
});
