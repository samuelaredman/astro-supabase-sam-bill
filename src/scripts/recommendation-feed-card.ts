// @ts-nocheck — vanilla DOM JS, previously is:inline so never type-checked.
// RecommendationFeedCard's delegated card behaviour. Lives in a module (not inline in the
// component) so pages that insert these cards after load — the reviewer
// profile's on-demand tabs — can import it up front; a component's <script>
// only ships with pages that render the component. Self-guarded, so
// importing it from several places still registers it once.
    import { IMAGE_EMOTES as _rfcImageEmotes, IMAGE_EMOTE_MAP as _rfcImageEmoteMap } from '../utils/reactions';
if (!window.__rfcPickerInit) {
  window.__rfcPickerInit = true;

  var picker = document.createElement('div');
  picker.id = 'rfc-emoji-picker';
  picker.style.cssText = 'display:none;position:fixed;z-index:1000';
  var ph = '<input type="text" id="rfc-emote-search" class="rfc-emote-search" placeholder="Search emotes..." autocomplete="off">';
  ph += '<div class="rfc-emoji-grid" id="rfc-emote-grid">';
  _rfcImageEmotes.forEach(function(emote) {
    // src withheld as data-src so the ~11 MB of emotes aren't fetched on page
    // load — hydrated on first picker open below. See ReviewCard.astro for the why.
    ph += '<button class="rfc-emoji-pick" data-emoji="' + emote.key + '" title="' + emote.key + '"><img data-src="' + emote.path + '" class="rfc-emote-picker-img" alt="' + emote.key + '"></button>';
  });
  ph += '</div>';
  picker.innerHTML = ph;
  document.body.appendChild(picker);

  var rfcEmoteObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        var img = entry.target;
        if (img.dataset.src) { img.src = img.dataset.src; img.removeAttribute('data-src'); }
        rfcEmoteObserver.unobserve(img);
      }
    });
  }, { root: picker, rootMargin: '80px 0px', threshold: 0 });
  picker.querySelectorAll('.rfc-emote-picker-img[data-src]').forEach(function(im) { rfcEmoteObserver.observe(im); });

  document.getElementById('rfc-emote-search').addEventListener('input', function() {
    var q = this.value.toLowerCase();
    document.querySelectorAll('#rfc-emote-grid .rfc-emoji-pick').forEach(function(btn) {
      btn.style.display = btn.dataset.emoji.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
    });
  });
}

if (!window.__rfcInit) {
  window.__rfcInit = true;

  function readRfcVote(recId) {
    var sel = '.rfc-vote-btn[data-rec-id="' + recId + '"]';
    var upBtn = document.querySelector(sel + '[data-vote="1"]');
    var downBtn = document.querySelector(sel + '[data-vote="-1"]');
    var num = function(el) { return el ? (parseInt((el.textContent.match(/\d+/) || ['0'])[0]) || 0) : 0; };
    return {
      up: num(upBtn), down: num(downBtn),
      my: upBtn && upBtn.classList.contains('rfc-vote-active-up') ? 1
        : downBtn && downBtn.classList.contains('rfc-vote-active-down') ? -1 : 0,
    };
  }
  function paintRfcVote(recId, my, up, down) {
    document.querySelectorAll('.rfc-vote-btn[data-rec-id="' + recId + '"]').forEach(function(b) {
      var bVote = parseInt(b.dataset.vote);
      b.textContent = (bVote === 1 ? '▲ ' : '▼ ') + (bVote === 1 ? up : down);
      b.classList.toggle('rfc-vote-active-up',   bVote === 1  && my === 1);
      b.classList.toggle('rfc-vote-active-down', bVote === -1 && my === -1);
    });
  }

  function closeRfcPanels() {
    var picker = document.getElementById('rfc-emoji-picker');
    if (picker) {
      picker.style.display = 'none';
      var search = document.getElementById('rfc-emote-search');
      if (search) {
        search.value = '';
        document.querySelectorAll('#rfc-emote-grid .rfc-emoji-pick').forEach(function(btn) { btn.style.display = ''; });
      }
    }
    document.querySelectorAll('.rfc-menu-dropdown').forEach(function(d) { d.style.display = 'none'; });
  }

  function applyRfcReaction(recId, reactionType, reacted, count) {
    var isImage = !!_rfcImageEmoteMap[reactionType];
    var updated = false;
    document.querySelectorAll('.rfc-reaction-btn[data-rec-id="' + recId + '"][data-reaction="' + reactionType + '"]').forEach(function(btn) {
      btn.dataset.reacted = reacted ? 'true' : 'false';
      btn.dataset.count = String(count);
      if (isImage) {
        btn.innerHTML = '<img src="' + _rfcImageEmoteMap[reactionType] + '" class="rfc-emote-img" alt="' + reactionType + '"> ' + count;
      } else {
        btn.textContent = reactionType + ' ' + count;
      }
      btn.classList.toggle('rfc-reaction-active', reacted);
      btn.style.display = count > 0 ? '' : 'none';
      updated = true;
    });
    if (!updated && count > 0) {
      var wrap = document.querySelector('.rfc-reaction-wrap[data-rec-id="' + recId + '"]');
      if (wrap) {
        var toggle = wrap.querySelector('.rfc-react-toggle');
        var newBtn = document.createElement('button');
        newBtn.className = 'rfc-reaction-btn' + (reacted ? ' rfc-reaction-active' : '');
        newBtn.dataset.recId = recId;
        newBtn.dataset.reaction = reactionType;
        newBtn.dataset.reacted = reacted ? 'true' : 'false';
        newBtn.dataset.count = String(count);
        newBtn.dataset.loggedIn = 'true';
        newBtn.dataset.isImage = isImage ? 'true' : 'false';
        if (isImage) {
          newBtn.innerHTML = '<img src="' + _rfcImageEmoteMap[reactionType] + '" class="rfc-emote-img" alt="' + reactionType + '"> ' + count;
        } else {
          newBtn.textContent = reactionType + ' ' + count;
        }
        wrap.insertBefore(newBtn, toggle);
      }
    }
  }

  document.addEventListener('click', async function(e) {
    // Feed menu (⋯) toggle
    var menuBtn = e.target.closest('.rfc-menu-btn');
    if (menuBtn) {
      var dropdown = document.getElementById('rfcm-' + menuBtn.dataset.menuId);
      if (!dropdown) return;
      var isOpen = dropdown.style.display !== 'none';
      closeRfcPanels();
      if (!isOpen) dropdown.style.display = 'block';
      return;
    }

    // Feed menu → Report
    var reportBtn = e.target.closest('.rfc-menu-report');
    if (reportBtn) {
      closeRfcPanels();
      if (reportBtn.dataset.loggedIn !== 'true') { window.location.href = '/signin'; return; }
      if (typeof window.openReport === 'function') window.openReport('recommendation', reportBtn.dataset.recId);
      return;
    }

    // Feed card: delete recommendation icon button (animate away)
    var feedDelBtn = e.target.closest('.rfc-feed-delete-btn');
    if (feedDelBtn) {
      if (!confirm('Delete this recommendation? This cannot be undone.')) return;
      feedDelBtn.disabled = true;
      var res = await fetch('/api/recommendations/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendation_id: feedDelBtn.dataset.recId }),
      });
      if (res.ok) {
        var card = feedDelBtn.closest('.rfc');
        if (card) {
          card.style.transition = 'opacity 0.3s, max-height 0.4s';
          card.style.overflow = 'hidden';
          card.style.opacity = '0';
          card.style.maxHeight = card.offsetHeight + 'px';
          setTimeout(function() { card.style.maxHeight = '0'; card.style.padding = '0'; }, 50);
          setTimeout(function() { card.remove(); }, 450);
        }
      } else feedDelBtn.disabled = false;
      return;
    }

    // Owner: delete recommendation (detail action bar — redirects away)
    var delBtn = e.target.closest('.rfc-delete-btn');
    if (delBtn) {
      if (!confirm('Delete this recommendation? This cannot be undone.')) return;
      delBtn.disabled = true;
      var res = await fetch('/api/recommendations/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendation_id: delBtn.dataset.recId }),
      });
      if (res.ok) window.location.href = '/recommendations';
      else delBtn.disabled = false;
      return;
    }

    // Owner: open inline editor (feed icon button or detail pill button)
    var editBtn = e.target.closest('.rfc-edit-btn, .rfc-feed-edit-btn');
    if (editBtn) {
      var rid = editBtn.dataset.recId;
      var art = document.querySelector('.rfc[data-rec-id="' + rid + '"]');
      if (!art || art.querySelector('.rfc-edit-wrap')) return;
      var bodyEl = art.querySelector('.rfc-body[data-rec-id="' + rid + '"]');
      var raw = bodyEl.dataset.rawBody || bodyEl.textContent;
      var spoiler = bodyEl.dataset.spoiler === 'true';
      var wrap = document.createElement('div');
      wrap.className = 'rfc-edit-wrap';
      wrap.innerHTML =
        '<textarea class="rfc-edit-ta" maxlength="5000"></textarea>' +
        '<label class="rfc-edit-spoiler"><input type="checkbox" class="rfc-edit-spoiler-cb"' + (spoiler ? ' checked' : '') + '> Contains spoilers</label>' +
        '<div class="rfc-edit-foot"><button class="rfc-edit-cancel">Cancel</button><button class="rfc-edit-save" data-rec-id="' + rid + '">Save</button></div>';
      bodyEl.style.display = 'none';
      bodyEl.parentNode.insertBefore(wrap, bodyEl.nextSibling);
      var ta = wrap.querySelector('.rfc-edit-ta');
      ta.value = raw; ta.focus();
      return;
    }
    var editCancel = e.target.closest('.rfc-edit-cancel');
    if (editCancel) {
      var wrap = editCancel.closest('.rfc-edit-wrap');
      var art = editCancel.closest('.rfc');
      var bodyEl = art.querySelector('.rfc-body');
      if (bodyEl) bodyEl.style.display = '';
      wrap.remove();
      return;
    }
    var editSave = e.target.closest('.rfc-edit-save');
    if (editSave) {
      var rid = editSave.dataset.recId;
      var wrap = editSave.closest('.rfc-edit-wrap');
      var ta = wrap.querySelector('.rfc-edit-ta');
      var newBody = ta.value.trim();
      var newSpoiler = wrap.querySelector('.rfc-edit-spoiler-cb').checked;
      if (!newBody) return;
      editSave.disabled = true;
      var res = await fetch('/api/recommendations/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendation_id: rid, body: newBody, contains_spoilers: newSpoiler }),
      });
      if (res.ok) {
        var art = editSave.closest('.rfc');
        var bodyEl = art.querySelector('.rfc-body');
        bodyEl.textContent = newBody;
        bodyEl.dataset.rawBody = newBody;
        bodyEl.dataset.spoiler = newSpoiler ? 'true' : 'false';
        bodyEl.classList.remove('spoiler-hidden');
        // sync the spoiler pill
        var pill = art.querySelector('.rfc-spoiler-pill');
        if (newSpoiler && !pill) {
          pill = document.createElement('div');
          pill.className = 'rfc-spoiler-pill';
          pill.textContent = '⚠ spoilers';
          bodyEl.parentNode.insertBefore(pill, bodyEl);
        } else if (!newSpoiler && pill) { pill.remove(); }
        bodyEl.style.display = '';
        wrap.remove();
      } else editSave.disabled = false;
      return;
    }

    // Body: reveal spoiler on click; navigate to detail only in the feed view
    var bodyEl = e.target.closest('.rfc-body[data-rec-id]');
    if (bodyEl) {
      if (bodyEl.dataset.spoiler === 'true' && bodyEl.classList.contains('spoiler-hidden')) {
        bodyEl.classList.remove('spoiler-hidden');
      } else if (bodyEl.dataset.detail !== 'true') {
        window.location.href = '/recommendations/' + bodyEl.dataset.recId;
      }
      return;
    }

    // Vote button — optimistic: repaint immediately, reconcile with the
    // server's authoritative counts, revert on failure.
    var voteBtn = e.target.closest('.rfc-vote-btn');
    if (voteBtn) {
      var loggedIn = voteBtn.dataset.loggedIn === 'true';
      if (!loggedIn) { window.location.href = '/signin'; return; }
      var recId = voteBtn.dataset.recId;
      var vote = parseInt(voteBtn.dataset.vote);
      var prev = readRfcVote(recId);

      var nextMy = prev.my === vote ? 0 : vote;
      var up = prev.up, down = prev.down;
      if (prev.my === 1) up = Math.max(0, up - 1);
      if (prev.my === -1) down = Math.max(0, down - 1);
      if (nextMy === 1) up += 1;
      if (nextMy === -1) down += 1;
      paintRfcVote(recId, nextMy, up, down);

      fetch('/api/recommendations/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendation_id: recId, vote }),
      }).then(function(res) {
        if (res.status === 401) { window.location.href = '/signin'; return null; }
        if (!res.ok) { paintRfcVote(recId, prev.my, prev.up, prev.down); return null; }
        return res.json();
      }).then(function(data) {
        if (!data) return;
        paintRfcVote(recId, data.vote || 0, data.up, data.down);
      }).catch(function() {
        paintRfcVote(recId, prev.my, prev.up, prev.down);
      });
      return;
    }

    // Inline reaction button
    var reactionBtn = e.target.closest('.rfc-reaction-btn');
    if (reactionBtn) {
      var loggedIn = reactionBtn.dataset.loggedIn === 'true';
      if (!loggedIn) { window.location.href = '/signin'; return; }
      var recId = reactionBtn.dataset.recId;
      var reaction = reactionBtn.dataset.reaction;
      var reacted = reactionBtn.dataset.reacted === 'true';
      var count = parseInt(reactionBtn.dataset.count) || 0;
      applyRfcReaction(recId, reaction, !reacted, reacted ? Math.max(0, count - 1) : count + 1);
      fetch('/api/recommendations/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendation_id: recId, reaction_type: reaction }),
      }).then(function(res) {
        if (res.status === 401) { window.location.href = '/signin'; return res.json(); }
        return res.json();
      }).then(function(data) {
        if (data) applyRfcReaction(recId, reaction, data.reacted, data.count);
      }).catch(function() {
        applyRfcReaction(recId, reaction, reacted, count);
      });
      return;
    }

    // React toggle (+) button
    var toggleBtn = e.target.closest('.rfc-react-toggle');
    if (toggleBtn) {
      var loggedIn = toggleBtn.dataset.loggedIn === 'true';
      if (!loggedIn) { window.location.href = '/signin'; return; }
      var recId = toggleBtn.dataset.recId;
      var picker = document.getElementById('rfc-emoji-picker');
      if (!picker) return;
      var isOpen = picker.style.display !== 'none' && picker.dataset.activeRecId === recId;
      closeRfcPanels();
      if (!isOpen) {
        picker.dataset.activeRecId = recId;
        picker.style.display = 'block';
        requestAnimationFrame(function() {
          var rect = toggleBtn.getBoundingClientRect();
          var pRect = picker.getBoundingClientRect();
          var top = rect.top - pRect.height - 8;
          if (top < 8) top = rect.bottom + 8;
          var left = rect.left;
          if (left + pRect.width > window.innerWidth - 8) left = window.innerWidth - pRect.width - 8;
          picker.style.top = top + 'px';
          picker.style.left = left + 'px';
          picker.querySelectorAll('.rfc-emoji-pick').forEach(function(btn) {
            var inlineBtn = document.querySelector('.rfc-reaction-btn[data-rec-id="' + recId + '"][data-reaction="' + btn.dataset.emoji + '"]');
            btn.classList.toggle('rfc-emoji-active', !!(inlineBtn && inlineBtn.dataset.reacted === 'true'));
          });
        });
      }
      return;
    }

    // Pick from emoji picker
    var emojiBtn = e.target.closest('.rfc-emoji-pick');
    if (emojiBtn) {
      var picker = document.getElementById('rfc-emoji-picker');
      var recId = picker && picker.dataset.activeRecId;
      if (!recId) return;
      var emoji = emojiBtn.dataset.emoji;
      var existing = document.querySelector('.rfc-reaction-btn[data-rec-id="' + recId + '"][data-reaction="' + emoji + '"]');
      var reacted = existing ? existing.dataset.reacted === 'true' : false;
      var count = existing ? (parseInt(existing.dataset.count) || 0) : 0;
      applyRfcReaction(recId, emoji, !reacted, reacted ? Math.max(0, count - 1) : count + 1);
      closeRfcPanels();
      fetch('/api/recommendations/react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recommendation_id: recId, reaction_type: emoji }),
      }).then(function(res) { return res.json(); })
        .then(function(data) { if (data) applyRfcReaction(recId, emoji, data.reacted, data.count); })
        .catch(function() { applyRfcReaction(recId, emoji, reacted, count); });
      return;
    }

    // Outside click
    if (!e.target.closest('.rfc-reaction-wrap') && !e.target.closest('#rfc-emoji-picker')) {
      closeRfcPanels();
    }
  });
}
