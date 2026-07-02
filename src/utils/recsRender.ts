// Client-side rendering for recommendation blocks — shared by the profile
// "Game Recs" tab (reviewers/[username].astro) and the global /recommendations
// page, so the two views can't drift apart.

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>
  )[c]);
}

function toCoverUrl(url: string | null | undefined, size: string): string {
  if (!url) return '';
  const abs = url.indexOf('//') === 0 ? 'https:' + url : url;
  return abs.replace(/t_[a-z0-9_]+/, size);
}

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? text.slice(0, max).trim() + '…' : text;
}

let carouselCounter = 0;

function carouselHtml(recs: any[]): string {
  const carouselId = 'rc' + (carouselCounter++);
  const slides = recs.map((rec, i) => {
    const cover = toCoverUrl(rec.cover_img_url, 't_cover_big');
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
          '<button type="button" class="recs-slide-watchlist-btn" data-game-id="' + rec.id + '">+ Watchlist</button>' +
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

export function renderRecommendationBlocks(recommendations: any[]): string {
  return recommendations.map((block) => {
    if (block.type === 'genre') {
      return '<div class="recs-seed-block">' +
        '<div class="recs-seed-header"><div class="recs-seed-title">Because you enjoy <strong>' +
          escapeHtml(block.genreNames.join(', ')) + '</strong> games</div></div>' +
        carouselHtml(block.recs) +
      '</div>';
    }
    if (block.type === 'social') {
      return '<div class="recs-seed-block">' +
        '<div class="recs-seed-header"><div class="recs-seed-title">Loved by <strong>people you follow</strong></div></div>' +
        carouselHtml(block.recs) +
      '</div>';
    }
    const game = block.game;
    const seedCover = toCoverUrl(game.cover_img_url, 't_thumb');
    return '<div class="recs-seed-block">' +
      '<div class="recs-seed-header">' +
        (seedCover ? '<img class="recs-seed-cover" src="' + seedCover + '" alt="">' : '') +
        '<div class="recs-seed-title">Because you loved <strong>' + escapeHtml(game.title) + '</strong></div>' +
      '</div>' +
      carouselHtml(block.recs) +
    '</div>';
  }).join('');
}

export function loadRecommendationsInto(
  container: HTMLElement,
  username: string,
  emptyMessage = 'No recommendations yet — rate a few games 7/10 or higher to get suggestions.'
): void {
  fetch('/api/recommendations?username=' + encodeURIComponent(username))
    .then((r) => r.json())
    .then((data) => {
      const recommendations = (data && data.recommendations) || [];
      if (recommendations.length === 0) {
        container.innerHTML = '<div class="recs-empty">' + emptyMessage + '</div>';
        return;
      }
      container.innerHTML = renderRecommendationBlocks(recommendations);
    })
    .catch(() => {
      container.innerHTML = '<div class="recs-error">Couldn\'t load recommendations. Try again later.</div>';
    });
}

// Event delegation for carousel nav + watchlist buttons, guarded so the
// listener registers once regardless of how many recs blocks end up on the
// page (matches the pattern ReviewCard.astro uses for its own delegated events).
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

    const watchlistBtn = target.closest('.recs-slide-watchlist-btn') as HTMLButtonElement | null;
    if (watchlistBtn) {
      if (watchlistBtn.disabled) return;
      const gameId = watchlistBtn.dataset.gameId;
      if (!gameId) return;
      watchlistBtn.disabled = true;
      const originalText = watchlistBtn.textContent;
      fetch('/api/watchlist/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game_id: gameId }),
      })
        .then((r) => {
          if (r.status === 401) {
            window.location.href = '/signin';
            return null;
          }
          return r.json();
        })
        .then((data) => {
          if (!data) return;
          if (data.error) {
            watchlistBtn.textContent = 'Already tracked';
            return;
          }
          watchlistBtn.textContent = data.watching ? '✓ On watchlist' : '+ Watchlist';
          watchlistBtn.classList.toggle('active', !!data.watching);
          watchlistBtn.disabled = false;
        })
        .catch(() => {
          watchlistBtn.textContent = originalText;
          watchlistBtn.disabled = false;
        });
    }
  });
}
