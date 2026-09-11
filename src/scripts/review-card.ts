// @ts-nocheck — vanilla DOM JS, previously is:inline so never type-checked.
// ReviewCard's delegated card behaviour. Lives in a module (not inline in the
// component) so pages that insert these cards after load — the reviewer
// profile's on-demand tabs — can import it up front; a component's <script>
// only ships with pages that render the component. Self-guarded, so
// importing it from several places still registers it once.
import { IMAGE_EMOTES as imageEmotes, IMAGE_EMOTE_MAP as imageEmoteMap } from '../utils/reactions';
// ── Shared emoji picker — created once per page ────────────────────────────
if (!window.__rcPickerInit) {
  window.__rcPickerInit = true;
  var picker = document.createElement('div');
  picker.id = 'rc-emoji-picker';
  picker.style.cssText = 'display:none;position:fixed;z-index:1000';
  var ph = '<input type="text" id="rc-emote-search" class="rc-emote-search" placeholder="Search emotes..." autocomplete="off">';
  ph += '<div class="rc-emoji-grid rc-emote-grid" id="rc-emote-grid">';
  imageEmotes.forEach(function(emote) {
    // Bandwidth: src is withheld as data-src so the ~11 MB of emotes are NOT
    // fetched on page load. An IntersectionObserver (root: picker) promotes
    // data-src → src as images scroll into view, with an 80px preload margin.
    // loading="lazy" doesn't work here because the picker scrolls internally.
    ph += '<button class="rc-emoji-pick rc-emote-pick" data-emoji="' + emote.key + '" title="' + emote.key + '"><img data-src="' + emote.path + '" class="rc-emote-picker-img" alt="' + emote.key + '"></button>';
  });
  ph += '</div>';
  picker.innerHTML = ph;
  document.body.appendChild(picker);

  var rcEmoteObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        var img = entry.target;
        if (img.dataset.src) { img.src = img.dataset.src; img.removeAttribute('data-src'); }
        rcEmoteObserver.unobserve(img);
      }
    });
  }, { root: picker, rootMargin: '80px 0px', threshold: 0 });
  picker.querySelectorAll('.rc-emote-picker-img[data-src]').forEach(function(im) { rcEmoteObserver.observe(im); });

  document.getElementById('rc-emote-search').addEventListener('input', function() {
    var q = this.value.toLowerCase();
    document.querySelectorAll('#rc-emote-grid .rc-emote-pick').forEach(function(btn) {
      btn.style.display = btn.dataset.emoji.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
    });
  });
}

if (!window.__rcInit) {
  window.__rcInit = true;

  // ── Close all floating panels/dropdowns ──────────────────────────────────
  function closeAllRcPanels() {
    var picker = document.getElementById('rc-emoji-picker');
    if (picker) {
      picker.style.display = 'none';
      var search = document.getElementById('rc-emote-search');
      if (search) {
        search.value = '';
        document.querySelectorAll('#rc-emote-grid .rc-emote-pick').forEach(function(btn) { btn.style.display = ''; });
      }
    }
    document.querySelectorAll('.rc-menu-dropdown').forEach(function(d) { d.style.display = 'none'; });
  }

  // ── Apply reaction state to all matching inline buttons ──────────────────
  function emoteInnerHTML(reactionType, count) {
    var path = imageEmoteMap[reactionType];
    return '<img src="' + path + '" class="rc-emote-img" alt="' + reactionType + '"> ' + count;
  }

  function applyReactionState(reviewId, reactionType, reacted, count, displayChar) {
    var isImage = !!imageEmoteMap[reactionType];
    var updated = false;
    document.querySelectorAll('.rc-reaction-inline[data-review-id="' + reviewId + '"][data-reaction="' + reactionType + '"]').forEach(function(btn) {
      btn.dataset.reacted = reacted ? 'true' : 'false';
      btn.dataset.count   = String(count);
      if (isImage) {
        btn.innerHTML = emoteInnerHTML(reactionType, count);
      } else {
        var display = displayChar || btn.dataset.display || reactionType;
        btn.textContent = display + ' ' + count;
      }
      btn.classList.toggle('reaction-active', reacted);
      btn.style.display = count > 0 ? '' : 'none';
      updated = true;
    });
    // If no inline button exists yet and count > 0, create one before the toggle btn
    if (!updated && count > 0) {
      var wrap = document.querySelector('.rc-reaction-wrap[data-review-id="' + reviewId + '"]');
      if (wrap) {
        var toggleBtn = wrap.querySelector('.rc-reaction-toggle');
        var newBtn = document.createElement('button');
        newBtn.className = 'rc-reaction-btn rc-reaction-inline' + (reacted ? ' reaction-active' : '');
        newBtn.dataset.reviewId  = reviewId;
        newBtn.dataset.reaction  = reactionType;
        newBtn.dataset.display   = displayChar || reactionType;
        newBtn.dataset.reacted   = reacted ? 'true' : 'false';
        newBtn.dataset.count     = String(count);
        newBtn.dataset.loggedIn  = 'true';
        newBtn.dataset.isImage   = isImage ? 'true' : 'false';
        if (isImage) {
          newBtn.innerHTML = emoteInnerHTML(reactionType, count);
        } else {
          newBtn.textContent = (displayChar || reactionType) + ' ' + count;
        }
        wrap.insertBefore(newBtn, toggleBtn);
      }
    }
  }

  document.addEventListener('click', function(e) {
    // Spoiler reveal — only intercept while still hidden; once revealed, fall through to navigation
    var spoiler = e.target.closest('.rc-body[data-spoiler="true"].spoiler-hidden');
    if (spoiler) {
      spoiler.classList.remove('spoiler-hidden');
      return;
    }

    // Review body click → navigate to full review + comments
    var bodyEl = e.target.closest('.rc-body[data-href]');
    if (bodyEl && !bodyEl.classList.contains('spoiler-hidden')) {
      window.location.href = bodyEl.dataset.href;
      return;
    }

    // ── Three-dot menu toggle ────────────────────────────────────────────
    var menuBtn = e.target.closest('.rc-menu-btn');
    if (menuBtn) {
      var menuId = menuBtn.dataset.menuId;
      var dropdown = document.getElementById('rcd-' + menuId);
      if (!dropdown) return;
      var isOpen = dropdown.style.display !== 'none';
      closeAllRcPanels();
      if (!isOpen) dropdown.style.display = 'block';
      return;
    }

    // ── Report from dropdown ─────────────────────────────────────────────
    var reportBtn = e.target.closest('.rc-menu-report');
    if (reportBtn) {
      closeAllRcPanels();
      var loggedIn = reportBtn.dataset.isLoggedIn === 'true';
      if (!loggedIn) { window.location.href = '/signin'; return; }
      var rid = reportBtn.dataset.reportReviewId;
      if (typeof openReport === 'function') openReport('review', rid);
      return;
    }

    // ── Emoji picker toggle (+ button) ───────────────────────────────────
    var panelToggle = e.target.closest('.rc-reaction-toggle');
    if (panelToggle) {
      var reviewId  = panelToggle.dataset.toggleReviewId;
      var loggedIn  = panelToggle.dataset.loggedIn === 'true';
      var picker    = document.getElementById('rc-emoji-picker');
      if (!picker) return;
      var isOpen = picker.style.display !== 'none' && picker.dataset.activeReviewId === reviewId;
      closeAllRcPanels();
      if (!isOpen) {
        picker.dataset.activeReviewId  = reviewId;
        picker.dataset.activeLoggedIn  = loggedIn ? 'true' : 'false';
        picker.style.display = 'block';
        // Position after display so we have real dimensions
        requestAnimationFrame(function() {
          var rect  = panelToggle.getBoundingClientRect();
          var pRect = picker.getBoundingClientRect();
          var top   = rect.top - pRect.height - 8;
          if (top < 8) top = rect.bottom + 8;
          var left  = rect.left;
          if (left + pRect.width > window.innerWidth - 8) left = window.innerWidth - pRect.width - 8;
          picker.style.top  = top  + 'px';
          picker.style.left = left + 'px';
          // Mark active emojis for this review
          picker.querySelectorAll('.rc-emoji-pick').forEach(function(btn) {
            var inlineBtn = document.querySelector('.rc-reaction-inline[data-review-id="' + reviewId + '"][data-reaction="' + btn.dataset.emoji + '"]');
            btn.classList.toggle('rc-emoji-active', !!(inlineBtn && inlineBtn.dataset.reacted === 'true'));
          });
        });
      }
      return;
    }

    // ── Emoji pick from shared picker ────────────────────────────────────
    var emojiBtn = e.target.closest('.rc-emoji-pick');
    if (emojiBtn) {
      var picker    = document.getElementById('rc-emoji-picker');
      var reviewId  = picker && picker.dataset.activeReviewId;
      var loggedIn  = picker && picker.dataset.activeLoggedIn === 'true';
      if (!reviewId) return;
      if (!loggedIn) { window.location.href = '/signin'; return; }
      var emoji     = emojiBtn.dataset.emoji;
      var existing  = document.querySelector('.rc-reaction-inline[data-review-id="' + reviewId + '"][data-reaction="' + emoji + '"]');
      var reacted   = existing ? existing.dataset.reacted === 'true' : false;
      var count     = existing ? (parseInt(existing.dataset.count) || 0) : 0;
      var newReacted = !reacted;
      var newCount   = newReacted ? count + 1 : Math.max(0, count - 1);
      applyReactionState(reviewId, emoji, newReacted, newCount, emoji);
      closeAllRcPanels();
      fetch('/api/reviews/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_id: reviewId, reaction_type: emoji }),
      }).then(function(res) {
        if (res.status === 401) { window.location.href = '/signin'; return; }
        return res.json();
      }).then(function(data) {
        if (!data) return;
        applyReactionState(reviewId, emoji, data.reacted, data.count, emoji);
        if (typeof gtag === 'function' && data.reacted) {
          gtag('event', 'reaction_added', { review_id: reviewId, reaction_type: emoji });
        }
      }).catch(function() {
        applyReactionState(reviewId, emoji, reacted, count, emoji);
      });
      return;
    }

    // ── Inline reaction button click (toggle existing reaction) ──────────
    var reactionBtn = e.target.closest('.rc-reaction-btn');
    if (reactionBtn) {
      var loggedIn = reactionBtn.dataset.loggedIn === 'true';
      if (!loggedIn) { window.location.href = '/signin'; return; }
      var reviewId = reactionBtn.dataset.reviewId;
      var reaction = reactionBtn.dataset.reaction;
      var display  = reactionBtn.dataset.display || reaction;
      var reacted  = reactionBtn.dataset.reacted === 'true';
      var count    = parseInt(reactionBtn.dataset.count) || 0;
      var newReacted = !reacted;
      var newCount   = newReacted ? count + 1 : Math.max(0, count - 1);
      applyReactionState(reviewId, reaction, newReacted, newCount, display);
      fetch('/api/reviews/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_id: reviewId, reaction_type: reaction }),
      }).then(function(res) {
        if (res.status === 401) { window.location.href = '/signin'; return; }
        return res.json();
      }).then(function(data) {
        if (!data) return;
        applyReactionState(reviewId, reaction, data.reacted, data.count, display);
        if (typeof gtag === 'function' && data.reacted) {
          gtag('event', 'reaction_added', { review_id: reviewId, reaction_type: reaction });
        }
      }).catch(function() {
        applyReactionState(reviewId, reaction, reacted, count, display);
      });
      return;
    }

    // ── Edit button ──────────────────────────────────────────────────────
    var editBtn = e.target.closest('.rc-edit-btn');
    if (editBtn) {
      var d = editBtn.dataset;
      if (typeof openEditModal === 'function') {
        openEditModal({
          reviewId:    d.reviewId,
          gameId:      d.gameId,
          gameTitle:   d.gameTitle,
          score:       d.score,
          title:       d.reviewTitle,
          body:        d.body,
          platformId:  d.platformId,
          hours:       d.hours,
          spoilers:    d.spoilers === 'true',
        });
      }
      return;
    }

    // Outside click: close all panels
    if (!e.target.closest('.rc-reaction-wrap') && !e.target.closest('.rc-menu-wrap') && !e.target.closest('#rc-emoji-picker')) {
      closeAllRcPanels();
    }
  });

  // ── Delete flow ──────────────────────────────────────────────────────────
  document.addEventListener('click', async function(e) {
    var deleteBtn = e.target.closest('.rc-delete-btn');
    if (deleteBtn) {
      var id = deleteBtn.dataset.reviewId;
      deleteBtn.style.display = 'none';
      var confirmEl = document.querySelector('.rc-delete-confirm[data-review-id="' + id + '"]');
      if (confirmEl) confirmEl.style.display = '';
      return;
    }

    var cancelBtn = e.target.closest('.rc-delete-no');
    if (cancelBtn) {
      var id = cancelBtn.dataset.reviewId;
      var confirmEl = document.querySelector('.rc-delete-confirm[data-review-id="' + id + '"]');
      if (confirmEl) confirmEl.style.display = 'none';
      var origBtn = document.querySelector('.rc-delete-btn[data-review-id="' + id + '"]');
      if (origBtn) origBtn.style.display = '';
      return;
    }

    var yesBtn = e.target.closest('.rc-delete-yes');
    if (yesBtn) {
      var id = yesBtn.dataset.reviewId;
      yesBtn.disabled = true;
      yesBtn.textContent = 'Deleting…';
      var res = await fetch('/api/reviews/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_id: id }),
      });
      if (!res.ok) {
        yesBtn.disabled = false;
        yesBtn.textContent = 'Yes, delete';
        alert('Could not delete review. Please try again.');
        return;
      }
      var card = yesBtn.closest('.rc');
      if (card) {
        card.style.transition = 'opacity 0.3s, max-height 0.4s';
        card.style.overflow = 'hidden';
        card.style.opacity = '0';
        card.style.maxHeight = card.offsetHeight + 'px';
        setTimeout(function() { card.style.maxHeight = '0'; card.style.padding = '0'; }, 50);
        setTimeout(function() { card.remove(); }, 450);
      }
      return;
    }
  });

  // ── Vote buttons ─────────────────────────────────────────────────────────
  // Paint the new vote state immediately, then reconcile with the server's
  // authoritative counts. Reverts to the captured state if the request fails.
  function readVoteState(reviewId) {
    var upBtn   = document.querySelector('.vote-btn[data-review-id="' + reviewId + '"][data-vote="1"]');
    var downBtn = document.querySelector('.vote-btn[data-review-id="' + reviewId + '"][data-vote="-1"]');
    return {
      up:     upBtn   ? (parseInt(upBtn.dataset.count)   || 0) : 0,
      down:   downBtn ? (parseInt(downBtn.dataset.count) || 0) : 0,
      myVote: upBtn && upBtn.classList.contains('active-up') ? 1
            : downBtn && downBtn.classList.contains('active-down') ? -1 : 0,
    };
  }
  function applyVoteState(reviewId, myVote, up, down) {
    document.querySelectorAll('.vote-btn[data-review-id="' + reviewId + '"]').forEach(function(b) {
      var bVote = parseInt(b.dataset.vote);
      var count = bVote === 1 ? up : down;
      b.dataset.count = count;
      b.textContent = (bVote === 1 ? '▲ ' : '▼ ') + count;
      b.classList.toggle('active-up',   bVote === 1  && myVote === 1);
      b.classList.toggle('active-down', bVote === -1 && myVote === -1);
    });
  }

  document.addEventListener('click', function(e) {
    var btn = e.target.closest('.vote-btn');
    if (!btn) return;

    var reviewId = btn.dataset.reviewId;
    var vote = parseInt(btn.dataset.vote);
    var prev = readVoteState(reviewId);

    // Optimistic: derive the next state from the current one.
    var nextMyVote = prev.myVote === vote ? 0 : vote;
    var up = prev.up, down = prev.down;
    if (prev.myVote === 1) up = Math.max(0, up - 1);
    if (prev.myVote === -1) down = Math.max(0, down - 1);
    if (nextMyVote === 1) up += 1;
    if (nextMyVote === -1) down += 1;
    applyVoteState(reviewId, nextMyVote, up, down);

    fetch('/api/reviews/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_id: reviewId, vote }),
    }).then(function(res) {
      if (res.status === 401) { window.location.href = '/signin'; return null; }
      if (!res.ok) {
        return res.json().catch(function() { return {}; }).then(function(err) {
          console.error('[vote] API error:', res.status, err);
          applyVoteState(reviewId, prev.myVote, prev.up, prev.down);
          return null;
        });
      }
      return res.json();
    }).then(function(data) {
      if (!data) return;
      applyVoteState(reviewId, data.vote || 0, data.up, data.down);
    }).catch(function() {
      applyVoteState(reviewId, prev.myVote, prev.up, prev.down);
    });
  });
}
