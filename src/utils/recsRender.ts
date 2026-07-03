// Client-side rendering for recommendation blocks — shared by the profile
// "Game Recs" tab (reviewers/[username].astro) and the global /recommendations
// page, so the two views can't drift apart.

import { igdbImage, timeAgo } from './format';

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>
  )[c]);
}

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max).trim() + '…' : text;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'want_to_play', label: '🔖 Want to Play' },
  { value: 'playing', label: '🎮 Playing' },
  { value: 'completed', label: '✓ Completed' },
  { value: 'hundred_percent', label: '💯 100%' },
  { value: 'owned', label: '📦 Owned' },
  { value: 'dropped', label: '✗ Dropped' },
];

let carouselCounter = 0;

function carouselHtml(recs: any[]): string {
  const carouselId = 'rc' + (carouselCounter++);
  const slides = recs.map((rec, i) => {
    const cover = igdbImage(rec.cover_img_url, 't_cover_big');
    const statusMenu = STATUS_OPTIONS.map((opt) =>
      '<button type="button" class="recs-status-option" data-status="' + opt.value + '">' + opt.label + '</button>'
    ).join('');
    return '<div class="recs-slide' + (i === 0 ? ' active' : '') + '" data-slide-index="' + i + '">' +
      '<a href="/games/' + rec.slug + '" class="recs-slide-cover-link">' +
        (cover
          ? '<img class="recs-slide-cover" src="' + cover + '" alt="' + escapeHtml(rec.title) + '" loading="lazy">'
          : '<div class="recs-slide-cover"></div>') +
      '</a>' +
      '<div class="recs-slide-info">' +
        '<a href="/games/' + rec.slug + '" class="recs-slide-title">' + escapeHtml(rec.title) + '</a>' +
        (rec.game_description
          ? '<p class="recs-slide-desc">' + escapeHtml(truncate(rec.game_description, 160)) + '</p>'
          : '') +
        '<div class="recs-slide-actions">' +
          '<a href="/games/' + rec.slug + '" class="recs-slide-view-btn">View game</a>' +
          '<div class="recs-status-picker">' +
            '<button type="button" class="recs-status-btn" data-game-id="' + rec.id + '">+ Add to library</button>' +
            '<div class="recs-status-menu">' + statusMenu + '</div>' +
          '</div>' +
          '<a href="/games/' + rec.slug + '" class="recs-slide-review-link">Write a review</a>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  const dots = recs.length > 1
    ? '<div class="recs-carousel-dots">' +
        recs.map((_, i) => '<span class="recs-dot' + (i === 0 ? ' active' : '') + '" data-dot-index="' + i + '"></span>').join('') +
      '</div>'
    : '';

  const arrows = recs.length > 1
    ? '<button type="button" class="recs-carousel-arrow recs-carousel-prev" aria-label="Previous">‹</button>' +
      '<button type="button" class="recs-carousel-arrow recs-carousel-next" aria-label="Next">›</button>'
    : '';

  return '<div class="recs-carousel" id="' + carouselId + '" data-index="0" data-count="' + recs.length + '">' +
    '<div class="recs-carousel-track">' + slides + '</div>' +
    arrows +
    dots +
  '</div>';
}

function blockHtml(block: any): string {
  if (block.type === 'genre') {
    return '<div class="recs-seed-header"><div class="recs-seed-title">Because you enjoy <strong>' +
        escapeHtml(block.genreNames.join(', ')) + '</strong> games</div></div>' +
      carouselHtml(block.recs);
  }
  if (block.type === 'social') {
    return '<div class="recs-seed-header"><div class="recs-seed-title">Loved by <strong>people you follow</strong></div></div>' +
      carouselHtml(block.recs);
  }
  const game = block.game;
  const seedCover = igdbImage(game.cover_img_url, 't_thumb');
  return '<div class="recs-seed-header">' +
      (seedCover ? '<img class="recs-seed-cover" src="' + seedCover + '" alt="">' : '') +
      '<div class="recs-seed-title">Because you loved <strong>' + escapeHtml(game.title) + '</strong></div>' +
    '</div>' +
    carouselHtml(block.recs);
}

// One "page" per block, vertically snap-scrollable, with a down-arrow that
// advances to the next one — keeps each section full-width/height instead of
// competing for space in one long scroll, and works equally via click, mouse
// wheel, or touch swipe since scroll-snap handles all three the same way.
function sectionsHtml(recommendations: any[]): string {
  const sections = recommendations.map((block, i) => {
    const isLast = i === recommendations.length - 1;
    return '<div class="recs-section" data-section-index="' + i + '">' +
      '<div class="recs-seed-block">' + blockHtml(block) + '</div>' +
      (isLast ? '' : '<button type="button" class="recs-section-next" aria-label="Next recommendation">︾</button>') +
    '</div>';
  }).join('');

  const sectionDots = recommendations.length > 1
    ? '<div class="recs-section-dots">' +
        recommendations.map((_, i) => '<span class="recs-section-dot' + (i === 0 ? ' active' : '') + '" data-section-dot="' + i + '"></span>').join('') +
      '</div>'
    : '';

  return '<div class="recs-sections-wrap">' +
    '<div class="recs-sections" id="recsSections">' + sections + '</div>' +
    sectionDots +
  '</div>';
}

export function renderRecommendationBlocks(recommendations: any[]): string {
  return sectionsHtml(recommendations);
}

export function loadRecommendationsInto(
  container: HTMLElement,
  username: string,
  emptyMessage = 'No recommendations yet — rate a few games 7/10 or higher to get suggestions.'
): void {
  function fetchAndRender(forceRefresh: boolean) {
    container.innerHTML = '<div class="recs-loading">Loading recommendations…</div>';
    const qs = 'username=' + encodeURIComponent(username) + (forceRefresh ? '&refresh=1' : '');
    fetch('/api/recommendations?' + qs)
      .then((r) => r.json())
      .then((data) => {
        const recommendations = (data && data.recommendations) || [];
        if (recommendations.length === 0) {
          container.innerHTML = '<div class="recs-empty">' + emptyMessage + '</div>';
          return;
        }
        const updatedLabel = data.computedAt ? 'Updated ' + timeAgo(data.computedAt) + ' ago' : '';
        container.innerHTML =
          '<div class="recs-toolbar">' +
            '<span class="recs-updated">' + updatedLabel + '</span>' +
            '<button type="button" class="recs-refresh-btn" id="recsRefreshBtn">↻ Refresh</button>' +
          '</div>' +
          renderRecommendationBlocks(recommendations);

        const refreshBtn = container.querySelector('#recsRefreshBtn') as HTMLButtonElement | null;
        if (refreshBtn) {
          refreshBtn.addEventListener('click', () => {
            refreshBtn.disabled = true;
            refreshBtn.textContent = 'Refreshing…';
            fetchAndRender(true);
          });
        }

        const sectionsEl = container.querySelector('.recs-sections') as HTMLElement | null;
        if (sectionsEl) {
          sectionsEl.addEventListener('scroll', () => syncSectionDots(sectionsEl));
        }
      })
      .catch(() => {
        container.innerHTML = '<div class="recs-error">Couldn\'t load recommendations. Try again later.</div>';
      });
  }
  fetchAndRender(false);
}

// Event delegation for carousel nav, section nav, and library status —
// guarded so the listener registers once regardless of how many recs blocks
// end up on the page (matches the pattern ReviewCard.astro uses for its own
// delegated events).
function goToSlide(carousel: HTMLElement, index: number): void {
  const count = parseInt(carousel.dataset.count || '0', 10);
  if (count === 0) return;
  const next = ((index % count) + count) % count;
  carousel.dataset.index = String(next);
  carousel.querySelectorAll('.recs-slide').forEach((el) => {
    el.classList.toggle('active', (el as HTMLElement).dataset.slideIndex === String(next));
  });
  carousel.querySelectorAll('.recs-dot').forEach((el) => {
    el.classList.toggle('active', (el as HTMLElement).dataset.dotIndex === String(next));
  });
}

function closeAllStatusMenus(): void {
  document.querySelectorAll('.recs-status-picker.open').forEach((el) => el.classList.remove('open'));
}

function goToSection(sections: HTMLElement, index: number): void {
  const all = sections.querySelectorAll('.recs-section');
  if (index < 0 || index >= all.length) return;
  // Dots aren't updated here — the scroll listener below reacts to the
  // resulting scroll position, so it stays correct however the section
  // changed (this click, a mouse-wheel scroll, or a touch swipe).
  (all[index] as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Keeps the side dots in sync with whatever section is actually in view,
// regardless of how the user got there (arrow click, wheel, touch, keyboard).
// Sections have an exact height matching the container (see shared.css), so
// scrollTop / clientHeight lands on a clean integer index at rest.
function syncSectionDots(sections: HTMLElement): void {
  if (!sections.clientHeight) return;
  const index = Math.round(sections.scrollTop / sections.clientHeight);
  const wrap = sections.closest('.recs-sections-wrap');
  if (!wrap) return;
  wrap.querySelectorAll('.recs-section-dot').forEach((el) => {
    el.classList.toggle('active', (el as HTMLElement).dataset.sectionDot === String(index));
  });
}

if (!(window as any).__recsCarouselInit) {
  (window as any).__recsCarouselInit = true;

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    const prevBtn = target.closest('.recs-carousel-prev');
    if (prevBtn) {
      const carousel = prevBtn.closest('.recs-carousel') as HTMLElement;
      if (carousel) goToSlide(carousel, parseInt(carousel.dataset.index || '0', 10) - 1);
      return;
    }
    const nextBtn = target.closest('.recs-carousel-next');
    if (nextBtn) {
      const carousel = nextBtn.closest('.recs-carousel') as HTMLElement;
      if (carousel) goToSlide(carousel, parseInt(carousel.dataset.index || '0', 10) + 1);
      return;
    }
    const dot = target.closest('.recs-dot') as HTMLElement | null;
    if (dot) {
      const carousel = dot.closest('.recs-carousel') as HTMLElement;
      if (carousel) goToSlide(carousel, parseInt(dot.dataset.dotIndex || '0', 10));
      return;
    }

    const sectionNext = target.closest('.recs-section-next');
    if (sectionNext) {
      const section = sectionNext.closest('.recs-section') as HTMLElement;
      const sections = section?.closest('.recs-sections') as HTMLElement;
      if (section && sections) goToSection(sections, parseInt(section.dataset.sectionIndex || '0', 10) + 1);
      return;
    }
    const sectionDot = target.closest('.recs-section-dot') as HTMLElement | null;
    if (sectionDot) {
      const sections = sectionDot.closest('.recs-sections-wrap')?.querySelector('.recs-sections') as HTMLElement;
      if (sections) goToSection(sections, parseInt(sectionDot.dataset.sectionDot || '0', 10));
      return;
    }

    const statusBtn = target.closest('.recs-status-btn') as HTMLButtonElement | null;
    if (statusBtn) {
      const picker = statusBtn.closest('.recs-status-picker') as HTMLElement;
      const wasOpen = picker.classList.contains('open');
      closeAllStatusMenus();
      if (!wasOpen) picker.classList.add('open');
      return;
    }
    const statusOption = target.closest('.recs-status-option') as HTMLButtonElement | null;
    if (statusOption) {
      const picker = statusOption.closest('.recs-status-picker') as HTMLElement;
      const btn = picker.querySelector('.recs-status-btn') as HTMLButtonElement;
      const gameId = btn?.dataset.gameId;
      const status = statusOption.dataset.status;
      if (!gameId || !status) return;
      const label = statusOption.textContent || '';
      btn.textContent = 'Saving…';
      fetch('/api/user-game-status/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game_id: gameId, status }),
      })
        .then((r) => {
          if (r.status === 401) { window.location.href = '/signin'; return null; }
          return r.json();
        })
        .then((data) => {
          if (!data) return;
          btn.textContent = data.error ? '+ Add to library' : label;
          picker.classList.toggle('set', !data.error);
          closeAllStatusMenus();
        })
        .catch(() => { btn.textContent = '+ Add to library'; });
      return;
    }

    if (!target.closest('.recs-status-picker')) closeAllStatusMenus();
  });
}
