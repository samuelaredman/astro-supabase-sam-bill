// Shared query + shaping helpers for the recommendation post type. Used by the
// home feed, the following feed, the global browse page, game pages, and profile
// pages so the RecommendationFeedCard always receives a consistent shape.

// The two FKs to `games` are disambiguated by their column name (source_game_id /
// target_game_id) — PostgREST embedding syntax.
export const REC_SELECT = `
  id, body, contains_spoilers, created_at, profile_id,
  source_game:games!source_game_id ( id, title, slug, cover_img_url ),
  target_game:games!target_game_id ( id, title, slug, cover_img_url ),
  profiles ( id, username, avatar_url ),
  recommendation_votes ( vote, profile_id ),
  recommendation_reactions ( reaction_type, profile_id ),
  recommendation_comments ( id )
`;

export interface ShapedRec {
  id: string;
  body: string;
  containsSpoilers: boolean;
  createdAt: string;
  profileId: string;
  sourceGame: { id: string; title: string; slug: string; cover_img_url: string | null } | null;
  targetGame: { id: string; title: string; slug: string; cover_img_url: string | null } | null;
  ownerUsername: string;
  ownerAvatar: string | null;
  upVotes: number;
  downVotes: number;
  myVote: number;
  commentCount: number;
  reactions: { reaction_type: string; profile_id: string }[];
  _isRecommendation: true;
  _date: string;
}

export function shapeRec(r: any, currentProfileId: string | null): ShapedRec {
  const votes = Array.isArray(r.recommendation_votes) ? r.recommendation_votes : [];
  let up = 0, down = 0, myVote = 0;
  for (const v of votes) {
    if (v.vote === 1) up++;
    else if (v.vote === -1) down++;
    if (currentProfileId && v.profile_id === currentProfileId) myVote = v.vote;
  }
  const reactions = Array.isArray(r.recommendation_reactions) ? r.recommendation_reactions : [];
  const commentCount = Array.isArray(r.recommendation_comments) ? r.recommendation_comments.length : 0;
  return {
    id: r.id,
    body: r.body,
    containsSpoilers: !!r.contains_spoilers,
    createdAt: r.created_at,
    profileId: r.profile_id,
    sourceGame: r.source_game ?? null,
    targetGame: r.target_game ?? null,
    ownerUsername: r.profiles?.username ?? '',
    ownerAvatar: r.profiles?.avatar_url ?? null,
    upVotes: up,
    downVotes: down,
    myVote,
    commentCount,
    reactions,
    _isRecommendation: true,
    _date: r.created_at,
  };
}
