/**
 * Fewest group reviews a game needs to place in a group's Top Rated. Small
 * friend groups rank every game; from 10 members, a game one member rated 10
 * would otherwise take the podium, so it takes two reviews to count.
 */
export function topRatedMinReviews(memberCount: number): number {
  return memberCount >= 10 ? 2 : 1;
}
