// Shared client behaviour for CommentThread.astro.
// Reads data-ct-target-type on the root to pick which API endpoints to hit;
// the markup is identical across all comment targets so the handlers below
// cover every rendering of the component site-wide.

export {};

type TargetType = "poll_answer" | "forum_post_comment";

interface RoutedCall { url: string; body: Record<string, unknown> }

function toSignin(): void {
  const returnTo = window.location.pathname + window.location.search + window.location.hash;
  window.location.href = "/signin?returnTo=" + encodeURIComponent(returnTo);
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: any }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { error: "Network error. Please try again." } };
  }
}

// Each target type knows which URL to hit and what payload to send for each
// action — adding a new target (e.g. "review_comment") is a single switch
// case per action.
function routeCompose(target: { type: TargetType; id: string }, body: string): RoutedCall {
  switch (target.type) {
    case "poll_answer":
      return { url: "/api/groups/polls/answer", body: { poll_id: target.id, body } };
    case "forum_post_comment":
      return { url: "/api/forum/comments/create", body: { post_id: target.id, body } };
  }
}
function routeReply(target: { type: TargetType; id: string }, parentId: string, body: string): RoutedCall {
  switch (target.type) {
    case "poll_answer":
      return { url: "/api/groups/polls/answer-reply", body: { answer_id: parentId, body } };
    case "forum_post_comment":
      return { url: "/api/forum/comments/create", body: { post_id: target.id, parent_id: parentId, body } };
  }
}
function routeVote(target: { type: TargetType }, commentId: string, vote: 1 | -1): RoutedCall {
  switch (target.type) {
    case "poll_answer":
      return { url: "/api/groups/polls/answer-vote", body: { answer_id: commentId, vote } };
    case "forum_post_comment":
      return { url: "", body: {} }; // no vote endpoint yet
  }
}
function routeDelete(target: { type: TargetType }, commentId: string): RoutedCall {
  switch (target.type) {
    case "poll_answer":
      return { url: "/api/groups/polls/answer", body: { action: "delete", answer_id: commentId } };
    case "forum_post_comment":
      return { url: "/api/forum/comments/delete", body: { comment_id: commentId } };
  }
}
function routeDeleteReply(target: { type: TargetType }, replyId: string): RoutedCall {
  switch (target.type) {
    case "poll_answer":
      return { url: "/api/groups/polls/answer-reply", body: { action: "delete", reply_id: replyId } };
    case "forum_post_comment":
      return { url: "/api/forum/comments/delete", body: { comment_id: replyId } };
  }
}
function routeEdit(target: { type: TargetType }, commentId: string, body: string): RoutedCall {
  switch (target.type) {
    case "poll_answer":
      return { url: "/api/groups/polls/answer", body: { action: "update", answer_id: commentId, body } };
    case "forum_post_comment":
      return { url: "", body: {} }; // no edit endpoint yet
  }
}
function routeReact(target: { type: TargetType }, commentId: string, reactionType: string, isReply: boolean): RoutedCall {
  switch (target.type) {
    case "poll_answer":
      return {
        url: "/api/groups/polls/answer-react",
        body: isReply
          ? { reply_id: commentId, reaction_type: reactionType }
          : { answer_id: commentId, reaction_type: reactionType },
      };
    case "forum_post_comment":
      return { url: "", body: {} }; // no reaction endpoint yet
  }
}

function isReplyComment(el: Element): boolean {
  return !!el.closest(".ct-replies");
}
// The report system is already polymorphic by target_type/target_id; just map
// our TargetType to the one the reports table recognises.
function reportKind(target: { type: TargetType }): string {
  switch (target.type) {
    case "poll_answer": return "poll_answer";
    case "forum_post_comment": return "forum_comment";
  }
}

function threadRoot(el: Element | null): HTMLElement | null {
  return el ? (el.closest(".ct-thread") as HTMLElement | null) : null;
}

function readTarget(root: HTMLElement): { type: TargetType; id: string } {
  return {
    type: (root.dataset.ctTargetType ?? "poll_answer") as TargetType,
    id: root.dataset.ctTargetId ?? "",
  };
}

function showError(formEl: HTMLElement, msg: string): void {
  const err = formEl.querySelector("[data-ct-composer-err]");
  if (!(err instanceof HTMLElement)) return;
  err.textContent = msg;
  err.classList.add("open");
}
function clearError(formEl: HTMLElement): void {
  const err = formEl.querySelector("[data-ct-composer-err]");
  if (err instanceof HTMLElement) err.classList.remove("open");
}

// ── Composer / reply form / edit form submit ───────────────────────────────
document.addEventListener("submit", (e) => {
  const form = e.target instanceof HTMLFormElement ? e.target : null;
  if (!form) return;
  const isMain = form.hasAttribute("data-ct-composer");
  const isReply = form.hasAttribute("data-ct-reply-form");
  const isEdit = form.hasAttribute("data-ct-edit-form");
  if (!isMain && !isReply && !isEdit) return;
  e.preventDefault();
  const root = threadRoot(form);
  if (!root) return;
  clearError(form);
  const textarea = form.querySelector("textarea[name=body]") as HTMLTextAreaElement | null;
  const body = (textarea?.value ?? "").trim();
  if (!body) return showError(form, "Write something first.");
  const target = readTarget(root);
  const commentEl = form.closest(".ct-comment") as HTMLElement | null;
  const commentId = commentEl?.getAttribute("data-ct-id") ?? "";
  const submit = form.querySelector("button[type=submit]") as HTMLButtonElement | null;
  if (submit) submit.disabled = true;
  const call = isReply
    ? routeReply(target, form.getAttribute("data-ct-parent-id") ?? "", body)
    : isEdit
      ? routeEdit(target, commentId, body)
      : routeCompose(target, body);
  postJson(call.url, call.body).then((res) => {
    if (res.ok) return window.location.reload();
    if (submit) submit.disabled = false;
    showError(form, res.data?.error ?? "Couldn't post your comment.");
  });
});

// Live character counter
document.addEventListener("input", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLTextAreaElement) || t.name !== "body") return;
  const container = t.closest(".ct-composer-wrap") ?? t.closest("[data-ct-composer]") ?? t.closest("[data-ct-reply-form]") ?? t.closest("[data-ct-edit-form]");
  const counter = container?.querySelector("[data-ct-char-count]");
  if (counter instanceof HTMLElement) counter.textContent = String(t.value.length);
});

// ── Delegated clicks: vote, reply-toggle, edit, edit-cancel, delete, report ──
document.addEventListener("click", (e) => {
  const trigger = e.target instanceof HTMLElement ? e.target.closest("[data-ct-action]") : null;
  if (!(trigger instanceof HTMLElement)) return;
  const root = threadRoot(trigger);
  if (!root) return;
  const action = trigger.getAttribute("data-ct-action");
  const commentEl = trigger.closest(".ct-comment") as HTMLElement | null;
  if (!commentEl) return;

  const target = readTarget(root);
  const commentId = commentEl.getAttribute("data-ct-id") ?? "";

  if (action === "toggle-reply") {
    const form = commentEl.querySelector(":scope > .ct-body > [data-ct-reply-form]") as HTMLElement | null;
    if (!form) return;
    const open = form.hidden;
    form.hidden = !open;
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) (form.querySelector("textarea") as HTMLTextAreaElement | null)?.focus();
    return;
  }

  // Cancel button inside the reply form — close the form AND flip the parent
  // Reply button's aria-expanded back so clicking it again reopens cleanly.
  if (action === "reply-cancel") {
    const form = commentEl.querySelector(":scope > .ct-body > [data-ct-reply-form]") as HTMLElement | null;
    if (form) form.hidden = true;
    const replyBtn = commentEl.querySelector(":scope > .ct-body > .ct-actions > .ct-reply-btn") as HTMLElement | null;
    replyBtn?.setAttribute("aria-expanded", "false");
    return;
  }

  if (action === "edit") {
    const form = commentEl.querySelector(":scope > .ct-body > [data-ct-edit-form]") as HTMLElement | null;
    const text = commentEl.querySelector(":scope > .ct-body > [data-ct-text]") as HTMLElement | null;
    const actions = commentEl.querySelector(":scope > .ct-body > .ct-actions") as HTMLElement | null;
    if (form) form.hidden = false;
    if (text) text.hidden = true;
    if (actions) actions.hidden = true;
    (form?.querySelector("textarea") as HTMLTextAreaElement | null)?.focus();
    return;
  }

  if (action === "edit-cancel") {
    const form = trigger.closest("[data-ct-edit-form]") as HTMLElement | null;
    const text = commentEl.querySelector(":scope > .ct-body > [data-ct-text]") as HTMLElement | null;
    const actions = commentEl.querySelector(":scope > .ct-body > .ct-actions") as HTMLElement | null;
    if (form) form.hidden = true;
    if (text) text.hidden = false;
    if (actions) actions.hidden = false;
    return;
  }

  if (action === "vote") {
    if ((trigger as HTMLButtonElement).disabled) return toSignin();
    const voteStr = trigger.getAttribute("data-ct-vote");
    const vote = (voteStr === "-1" ? -1 : 1) as 1 | -1;
    const call = routeVote(target, commentId, vote);
    postJson(call.url, call.body).then((res) => {
      if (res.ok) window.location.reload();
      else alert(res.data?.error ?? "Couldn't record vote.");
    });
    return;
  }

  if (action === "delete") {
    if (!confirm("Delete this comment?")) return;
    const call = routeDelete(target, commentId);
    postJson(call.url, call.body).then((res) => {
      if (res.ok) window.location.reload();
      else alert(res.data?.error ?? "Couldn't delete.");
    });
    return;
  }

  if (action === "delete-reply") {
    if (!confirm("Delete this reply?")) return;
    const call = routeDeleteReply(target, commentId);
    postJson(call.url, call.body).then((res) => {
      if (res.ok) window.location.reload();
      else alert(res.data?.error ?? "Couldn't delete.");
    });
    return;
  }

  if (action === "report") {
    const kind = reportKind(target);
    const open = (window as any).openReport;
    if (typeof open === "function") open(kind, commentId);
    else toSignin();
    return;
  }

  // Direct reaction toggle (clicking an existing reaction chip)
  if (action === "react") {
    const reactionType = trigger.getAttribute("data-ct-reaction");
    if (!reactionType) return;
    const call = routeReact(target, commentId, reactionType, isReplyComment(commentEl));
    postJson(call.url, call.body).then((res) => {
      if (res.ok) window.location.reload();
      else alert(res.data?.error ?? "Couldn't react.");
    });
    return;
  }

  // "+" button → open the floating emote picker in react mode
  if (action === "react-picker") {
    const picker = root.querySelector<HTMLElement>("[data-ct-emote-picker]");
    if (!picker) return toSignin();
    openPicker(picker, trigger, { mode: "react", commentId, isReply: isReplyComment(commentEl) });
    return;
  }
});

// Composer / reply / edit emote-insert button → open picker in insert mode,
// bound to the sibling textarea in the same form.
document.addEventListener("click", (e) => {
  const btn = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>("[data-ct-action='emote-insert']") : null;
  if (!btn) return;
  e.preventDefault();
  const root = threadRoot(btn);
  const picker = root?.querySelector<HTMLElement>("[data-ct-emote-picker]");
  if (!root || !picker) return;
  const form = btn.closest("form");
  const ta = form?.querySelector<HTMLTextAreaElement>("textarea[name=body]");
  if (!ta) return;
  openPicker(picker, btn, { mode: "insert", textarea: ta });
});

function openPicker(
  picker: HTMLElement,
  anchor: HTMLElement,
  opts: { mode: "react"; commentId: string; isReply: boolean } | { mode: "insert"; textarea: HTMLTextAreaElement },
): void {
  const r = anchor.getBoundingClientRect();
  picker.hidden = false;
  picker.style.position = "fixed";
  // Prefer opening above the anchor (above composer buttons) so the picker
  // doesn't push the composer around; fall back to below when there's no room.
  const estHeight = Math.min(300, picker.offsetHeight || 300);
  let top = r.top - estHeight - 6;
  if (top < 8) top = r.bottom + 6;
  picker.style.top = `${top}px`;
  picker.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 320))}px`;
  picker.dataset.ctMode = opts.mode;
  if (opts.mode === "react") {
    picker.dataset.ctForComment = opts.commentId;
    picker.dataset.ctForKind = opts.isReply ? "reply" : "answer";
    pickerTextarea = null;
  } else {
    pickerTextarea = opts.textarea;
    delete picker.dataset.ctForComment;
    delete picker.dataset.ctForKind;
  }
  const search = picker.querySelector<HTMLInputElement>("[data-ct-emote-search]");
  if (search) {
    search.value = "";
    picker.querySelectorAll<HTMLElement>(".ct-emote-pick").forEach((p) => { p.hidden = false; });
    setTimeout(() => search.focus(), 0);
  }
}

// Insert-mode textarea tracked outside dataset (direct DOM reference) so we
// can refocus the exact element the user was typing in.
let pickerTextarea: HTMLTextAreaElement | null = null;

// Live filter on the emote picker search input.
document.addEventListener("input", (e) => {
  const t = e.target instanceof HTMLInputElement ? e.target : null;
  if (!t || !t.hasAttribute("data-ct-emote-search")) return;
  const picker = t.closest<HTMLElement>("[data-ct-emote-picker]");
  if (!picker) return;
  const q = t.value.trim().toLowerCase();
  picker.querySelectorAll<HTMLElement>(".ct-emote-pick").forEach((pick) => {
    const key = (pick.getAttribute("data-ct-emote-key") ?? "").toLowerCase();
    pick.hidden = q.length > 0 && !key.includes(q);
  });
});

// Emote pick: either toggles a reaction (react mode) or splices :key: into
// the composer textarea at the cursor (insert mode).
document.addEventListener("click", (e) => {
  const pick = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(".ct-emote-pick") : null;
  if (!pick) return;
  const picker = pick.closest<HTMLElement>("[data-ct-emote-picker]");
  const root = threadRoot(pick);
  if (!picker || !root) return;
  const key = pick.getAttribute("data-ct-emote-key");
  if (!key) return;

  if (picker.dataset.ctMode === "insert" && pickerTextarea) {
    const ta = pickerTextarea;
    const code = `:${key}:`;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = ta.value.slice(0, start) + code + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + code.length;
    picker.hidden = true;
    ta.focus();
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  // React mode (default)
  const commentId = picker.dataset.ctForComment ?? "";
  if (!commentId) { picker.hidden = true; return; }
  picker.hidden = true;
  const target = readTarget(root);
  const call = routeReact(target, commentId, key, picker.dataset.ctForKind === "reply");
  postJson(call.url, call.body).then((res) => {
    if (res.ok) window.location.reload();
    else alert(res.data?.error ?? "Couldn't react.");
  });
});

// Click-outside / Escape closes the picker without acting.
document.addEventListener("click", (e) => {
  const picker = document.querySelector<HTMLElement>("[data-ct-emote-picker]");
  if (!picker || picker.hidden) return;
  const t = e.target instanceof HTMLElement ? e.target : null;
  if (!t) return;
  if (
    t.closest("[data-ct-emote-picker]") ||
    t.closest('[data-ct-action="react-picker"]') ||
    t.closest('[data-ct-action="emote-insert"]')
  ) return;
  picker.hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const picker = document.querySelector<HTMLElement>("[data-ct-emote-picker]");
  if (picker && !picker.hidden) picker.hidden = true;
});
