// Shared types + adapters for CommentThread.astro.
// Each page that renders comments maps its own rows into CommentData[] and
// passes a `target` so the shared client-side JS knows which API to hit.

export interface CommentAuthor {
  id: string;
  username: string;
  avatarUrl: string | null;
  badges?: string[];
  /** Owner / Admin / Staff tag; falsy means no chip rendered. */
  roleTag?: "Owner" | "Admin" | "Staff" | null;
}

export interface CommentData {
  id: string;
  parentId?: string | null;
  author: CommentAuthor;
  body: string;
  createdAt: string;
  updatedAt?: string | null;   // null/same-as-createdAt = never edited
  upvotes: number;
  /** Omit (or 0) to hide the downvote button entirely (e.g. poll answers). */
  downvotes?: number;
  /** 1 if viewer upvoted, -1 if downvoted, 0 (or undefined) if neither. */
  myVote?: 1 | -1 | 0;
  /** The viewer can edit this one — usually their own. */
  canEdit?: boolean;
  /** The viewer can delete this one — their own, or a moderator action. */
  canDelete?: boolean;
  /** The viewer can report this one — usually true for others' comments. */
  canReport?: boolean;
  /** Oldest-first list of direct replies (one level deep for now). */
  replies?: CommentData[];
  /** Aggregated :emote: reactions (image emotes come from IMAGE_EMOTES). */
  reactions?: CommentReaction[];
}

export interface CommentReaction {
  type: string;
  count: number;
  /** True if the viewer has this reaction active. */
  mine: boolean;
}

export type CommentTargetType = "poll_answer";

export interface CommentTarget {
  type: CommentTargetType;
  /** For poll_answer: the group_polls.id this thread hangs off. */
  id: string;
}
