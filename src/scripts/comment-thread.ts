// Shared client behaviour for CommentThread.astro.
// Reads data-ct-target-type on the root to pick which API endpoints to hit;
// the markup is identical across all comment targets so the handlers below
// cover every rendering of the component site-wide.

export {};

type TargetType = "poll_answer";

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
  }
}
function routeReply(target: { type: TargetType; id: string }, parentId: string, body: string): RoutedCall {
  switch (target.type) {
    case "poll_answer":
      return { url: "/api/groups/polls/answer-reply", body: { answer_id: parentId, body } };
  }
}
function routeVote(target: { type: TargetType }, commentId: string, vote: 1 | -1): RoutedCall {
  switch (target.type) {
    case "poll_answer":
      return { url: "/api/groups/polls/answer-vote", body: { answer_id: commentId, vote } };
  }
}
function routeDelete(target: { type: TargetType }, commentId: string): RoutedCall {
  switch (target.type) {
    case "poll_answer":
      return { url: "/api/groups/polls/answer", body: { action: "delete", answer_id: commentId } };
  }
}
function routeDeleteReply(target: { type: TargetType }, replyId: string): RoutedCall {
  switch (target.type) {
    case "poll_answer":
      return { url: "/api/groups/polls/answer-reply", body: { action: "delete", reply_id: replyId } };
  }
}
function routeEdit(target: { type: TargetType }, commentId: string, body: string): RoutedCall {
  switch (target.type) {
    // The poll-answer endpoint upserts the viewer's own answer; the server
    // picks the right row by (poll_id, profile_id) — commentId isn't used.
    case "poll_answer":
      return { url: "/api/groups/polls/answer", body: { poll_id: (document.querySelector(".ct-thread") as HTMLElement | null)?.dataset.ctTargetId ?? "", body } };
    default:
      void commentId;
      return { url: "", body: {} };
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

  // "+" button → open the floating emote picker under the clicked toggle
  if (action === "react-picker") {
    const picker = root.querySelector<HTMLElement>("[data-ct-emote-picker]");
    if (!picker) return toSignin();
    const r = trigger.getBoundingClientRect();
    picker.hidden = false;
    picker.style.position = "fixed";
    picker.style.top = `${r.bottom + 6}px`;
    picker.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 320))}px`;
    picker.dataset.ctForComment = commentId;
    picker.dataset.ctForKind = isReplyComment(commentEl) ? "reply" : "answer";
    return;
  }
});

// Picking an emote from the floating grid dispatches a react toggle for the
// comment the picker was opened against, then closes the grid.
document.addEventListener("click", (e) => {
  const pick = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>(".ct-emote-pick") : null;
  if (!pick) return;
  const picker = pick.closest<HTMLElement>("[data-ct-emote-picker]");
  const root = threadRoot(pick);
  if (!picker || !root) return;
  const commentId = picker.dataset.ctForComment ?? "";
  const reactionType = pick.getAttribute("data-ct-emote-key");
  if (!commentId || !reactionType) return;
  picker.hidden = true;
  const target = readTarget(root);
  const call = routeReact(target, commentId, reactionType, picker.dataset.ctForKind === "reply");
  postJson(call.url, call.body).then((res) => {
    if (res.ok) window.location.reload();
    else alert(res.data?.error ?? "Couldn't react.");
  });
});

// Click-outside / Escape closes the picker without reacting.
document.addEventListener("click", (e) => {
  const picker = document.querySelector<HTMLElement>("[data-ct-emote-picker]");
  if (!picker || picker.hidden) return;
  const t = e.target instanceof HTMLElement ? e.target : null;
  if (!t) return;
  if (t.closest("[data-ct-emote-picker]") || t.closest('[data-ct-action="react-picker"]')) return;
  picker.hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const picker = document.querySelector<HTMLElement>("[data-ct-emote-picker]");
  if (picker && !picker.hidden) picker.hidden = true;
});
