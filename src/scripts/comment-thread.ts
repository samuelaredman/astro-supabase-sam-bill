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
// action — kept side-by-side so adding a new target (e.g. "review_comment")
// is a single switch case per action.
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
      // Poll answers only support upvote; the vote arg is ignored (an active
      // upvote re-click is interpreted as a remove on the server).
      void vote;
      return { url: "/api/groups/polls/answer-vote", body: { answer_id: commentId } };
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

// ── Composer / reply form submit ────────────────────────────────────────────
document.addEventListener("submit", (e) => {
  const form = e.target instanceof HTMLFormElement ? e.target : null;
  if (!form) return;
  const isMain = form.hasAttribute("data-ct-composer");
  const isReply = form.hasAttribute("data-ct-reply-form");
  if (!isMain && !isReply) return;
  e.preventDefault();
  const root = threadRoot(form);
  if (!root) return;
  clearError(form);
  const textarea = form.querySelector("textarea[name=body]") as HTMLTextAreaElement | null;
  const body = (textarea?.value ?? "").trim();
  if (!body) return showError(form, "Write something first.");
  const target = readTarget(root);
  const submit = form.querySelector("button[type=submit]") as HTMLButtonElement | null;
  if (submit) submit.disabled = true;
  const call = isReply
    ? routeReply(target, form.getAttribute("data-ct-parent-id") ?? "", body)
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
  const wrap = t.closest(".ct-composer-wrap") ?? t.closest("[data-ct-composer]") ?? t.closest("[data-ct-reply-form]");
  const counter = wrap?.querySelector("[data-ct-char-count]");
  if (counter instanceof HTMLElement) counter.textContent = String(t.value.length);
});

// ── Delegated clicks: vote, toggle-reply, delete, delete-reply ──────────────
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

  if (action === "vote") {
    // If signed-out: redirect to signin (vote endpoints will 401 otherwise)
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
});
