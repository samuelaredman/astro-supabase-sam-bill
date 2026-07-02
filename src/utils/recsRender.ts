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

function cardsHtml(recs: any[]): string {
  return recs.map((rec) => {
    const cover = toCoverUrl(rec.cover_img_url, 't_cover_big');
    return '<a class="recs-card" href="/games/' + rec.slug + '">' +
      (cover
        ? '<img class="recs-card-cover" src="' + cover + '" alt="' + escapeHtml(rec.title) + '" loading="lazy">'
        : '<div class="recs-card-cover"></div>') +
      '<div class="recs-card-title">' + escapeHtml(rec.title) + '</div>' +
    '</a>';
  }).join('');
}

export function renderRecommendationBlocks(recommendations: any[]): string {
  return recommendations.map((block) => {
    if (block.type === 'genre') {
      return '<div class="recs-seed-block">' +
        '<div class="recs-seed-header"><div class="recs-seed-title">Because you enjoy <strong>' +
          escapeHtml(block.genreNames.join(', ')) + '</strong> games</div></div>' +
        '<div class="recs-grid">' + cardsHtml(block.recs) + '</div>' +
      '</div>';
    }
    if (block.type === 'social') {
      return '<div class="recs-seed-block">' +
        '<div class="recs-seed-header"><div class="recs-seed-title">Loved by <strong>people you follow</strong></div></div>' +
        '<div class="recs-grid">' + cardsHtml(block.recs) + '</div>' +
      '</div>';
    }
    const game = block.game;
    const seedCover = toCoverUrl(game.cover_img_url, 't_thumb');
    return '<div class="recs-seed-block">' +
      '<div class="recs-seed-header">' +
        (seedCover ? '<img class="recs-seed-cover" src="' + seedCover + '" alt="">' : '') +
        '<div class="recs-seed-title">Because you loved <strong>' + escapeHtml(game.title) + '</strong></div>' +
      '</div>' +
      '<div class="recs-grid">' + cardsHtml(block.recs) + '</div>' +
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
