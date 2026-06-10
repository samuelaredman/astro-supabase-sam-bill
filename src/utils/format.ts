export function scoreClass(score: number): string {
  if (score === 10) return 'score-perfect';
  if (score >= 9) return 'score-great';
  if (score >= 8) return 'score-teal';
  if (score >= 7) return 'score-good';
  if (score >= 5) return 'score-mid';
  if (score >= 3) return 'score-orange';
  return 'score-low';
}

export function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 604800)}w`;
}

export function getVoteCounts(votes: any): { up: number; down: number } {
  const arr = Array.isArray(votes) ? votes : votes ? [votes] : [];
  return {
    up: arr.filter((v: any) => v.vote === 1).length,
    down: arr.filter((v: any) => v.vote === -1).length,
  };
}

export function igdbImage(url: string | null | undefined, size = 't_cover_big'): string | null {
  if (!url) return null;
  const clean = url.startsWith('//') ? `https:${url}` : url;
  return clean.replace(/t_[a-z0-9_]+/, size);
}
