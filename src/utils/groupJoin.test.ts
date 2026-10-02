import { describe, expect, it } from "vitest";
import { toPendingGroup } from "./groupJoin";

const ID = "10000000-0000-0000-0000-000000000001";

describe("toPendingGroup", () => {
  it("keeps a group id and invite code", () => {
    expect(toPendingGroup(ID, "SECRET42")).toEqual({ id: ID, code: "SECRET42" });
  });

  it("lowercases the id", () => {
    expect(toPendingGroup(ID.toUpperCase(), null)).toEqual({ id: ID, code: null });
  });

  it("drops a malformed code but keeps the group", () => {
    expect(toPendingGroup(ID, "<script>")).toEqual({ id: ID, code: null });
    expect(toPendingGroup(ID, "A".repeat(17))).toEqual({ id: ID, code: null });
    expect(toPendingGroup(ID, 42)).toEqual({ id: ID, code: null });
  });

  it.each([null, undefined, "", "not-a-uuid", "x'; drop table groups;--", 123, { id: ID }])(
    "returns null for group id %j",
    (groupId) => {
      expect(toPendingGroup(groupId, "SECRET42")).toBeNull();
    }
  );
});
