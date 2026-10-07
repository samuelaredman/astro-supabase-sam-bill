import { describe, expect, it } from "vitest";
import {
  buildFeaturedStats,
  FEATURED_POLL_PRESETS,
  formatHours,
  readFeaturedNote,
  readFeaturedPoll,
  summarizePoll,
  type FeaturedStatsRow,
} from "./groupFeaturedGames";

const row = (over: Partial<FeaturedStatsRow> = {}): FeaturedStatsRow => ({
  game_id: "g1",
  member_count: 200,
  played_count: 40,
  completed_count: 25,
  full_count: 10,
  review_count: 30,
  avg_score: 7.84,
  achievement_count: 20,
  avg_achievement_pct: 0.6349,
  hours_count: 18,
  avg_hours: 37.26,
  full_profile_ids: ["p1", "p2"],
  ...over,
});

describe("buildFeaturedStats", () => {
  it("turns counts into shares: played of members, finished and 100% of players", () => {
    const s = buildFeaturedStats(row());
    expect(s.memberCount).toBe(200);
    expect(s.played).toBe(40);
    expect(s.playedPct).toBe(20);
    expect(s.completedPct).toBe(63); // 25 / 40
    expect(s.fullPct).toBe(25); // 10 / 40
    expect(s.avgScore).toBeCloseTo(7.84);
    expect(s.avgAchievementPct).toBe(63);
    expect(s.avgHours).toBe(37.3);
  });

  it("shows a game nobody has touched as zeros, with no shares or averages", () => {
    const s = buildFeaturedStats(undefined, 12);
    expect(s).toMatchObject({
      memberCount: 12, played: 0, playedPct: 0, completedPct: null, fullPct: null,
      avgScore: null, avgAchievementPct: null, avgHours: null,
    });
  });

  it("drops an average that has nothing behind it", () => {
    const s = buildFeaturedStats(row({ review_count: 0, avg_score: null, achievement_count: 0, avg_achievement_pct: null }));
    expect(s.avgScore).toBeNull();
    expect(s.avgAchievementPct).toBeNull();
  });

  it("has no member share for an empty group", () => {
    expect(buildFeaturedStats(row({ member_count: 0, played_count: 0 })).playedPct).toBeNull();
  });
});

describe("formatHours", () => {
  it("rounds long games to whole hours and keeps a decimal for short ones", () => {
    expect(formatHours(37.26)).toBe("37h");
    expect(formatHours(4.46)).toBe("4.5h");
    expect(formatHours(0.75)).toBe("45m");
    expect(formatHours(0.001)).toBe("1m");
    expect(formatHours(null)).toBe("—");
  });
});

describe("readFeaturedPoll", () => {
  it("means no poll when absent", () => {
    expect(readFeaturedPoll(undefined)).toEqual({ poll: null });
    expect(readFeaturedPoll(null)).toEqual({ poll: null });
  });

  it("trims the question and options and drops empty options", () => {
    expect(readFeaturedPoll({ question: "  Keep or refund? ", options: [" Keep ", "", "Refund", "  "] }))
      .toEqual({ poll: { question: "Keep or refund?", options: ["Keep", "Refund"] } });
  });

  it("needs a question and 2–6 different options", () => {
    expect(readFeaturedPoll({ question: "", options: ["a", "b"] })).toHaveProperty("error");
    expect(readFeaturedPoll({ question: "Q", options: ["a"] })).toHaveProperty("error");
    expect(readFeaturedPoll({ question: "Q", options: ["a", "b", "c", "d", "e", "f", "g"] })).toHaveProperty("error");
    expect(readFeaturedPoll({ question: "Q", options: ["Yes", "yes"] })).toHaveProperty("error");
    expect(readFeaturedPoll({ question: "Q", options: "a,b" })).toHaveProperty("error");
    expect(readFeaturedPoll("Q")).toHaveProperty("error");
  });

  it("enforces the group polls' length limits", () => {
    expect(readFeaturedPoll({ question: "x".repeat(301), options: ["a", "b"] })).toHaveProperty("error");
    expect(readFeaturedPoll({ question: "Q", options: ["x".repeat(81), "b"] })).toHaveProperty("error");
  });

  it("accepts every preset as it stands", () => {
    for (const p of FEATURED_POLL_PRESETS) {
      expect(readFeaturedPoll({ question: p.question, options: [...p.options] })).toEqual({
        poll: { question: p.question, options: [...p.options] },
      });
    }
  });
});

describe("readFeaturedNote", () => {
  it("leaves the note alone when absent, and clears it when empty", () => {
    expect(readFeaturedNote({})).toEqual({ present: false });
    expect(readFeaturedNote({ note: "  " })).toEqual({ present: true, note: null });
    expect(readFeaturedNote({ note: null })).toEqual({ present: true, note: null });
    expect(readFeaturedNote({ note: " Brutal. " })).toEqual({ present: true, note: "Brutal." });
  });

  it("refuses a note that's too long or not text", () => {
    expect(readFeaturedNote({ note: "x".repeat(501) })).toHaveProperty("error");
    expect(readFeaturedNote({ note: 5 })).toHaveProperty("error");
  });
});

describe("summarizePoll", () => {
  const poll = { id: "poll1", question: "Keep or refund?", closed: false, profile_id: "owner" };
  const options = [
    { id: "o2", poll_id: "poll1", label: "Refund", position: 1 },
    { id: "o1", poll_id: "poll1", label: "Keep", position: 0 },
    { id: "x", poll_id: "other", label: "Elsewhere", position: 0 },
  ];
  const votes = [
    { poll_id: "poll1", option_id: "o1", profile_id: "a" },
    { poll_id: "poll1", option_id: "o1", profile_id: "b" },
    { poll_id: "poll1", option_id: "o2", profile_id: "me" },
    { poll_id: "other", option_id: "x", profile_id: "c" },
  ];

  it("orders this poll's options and gives each its share of the votes", () => {
    const s = summarizePoll(poll, options, votes, "me");
    expect(s.totalVotes).toBe(3);
    expect(s.options.map((o) => [o.label, o.count, o.pct])).toEqual([["Keep", 2, 67], ["Refund", 1, 33]]);
    expect(s.myOptionId).toBe("o2");
  });

  it("has no vote of mine for a visitor, and 0% everywhere with no votes", () => {
    expect(summarizePoll(poll, options, votes, null).myOptionId).toBeNull();
    expect(summarizePoll(poll, options, [], "me").options.every((o) => o.pct === 0)).toBe(true);
  });
});
