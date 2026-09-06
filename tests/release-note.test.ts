import { describe, expect, it } from "vitest";
import { validateReleaseNote } from "../scripts/release-note.mjs";

const note = { version: "v142", title: "게임 화면 업데이트가 있어요", description: "음식 회복량을 미리 볼 수 있어요." };
describe("required release notes", () => {
  it("accepts a note for the deployed version", () => {
    expect(() => validateReleaseNote(note, "v142")).not.toThrow();
  });
  it("rejects a stale release note", () => {
    expect(() => validateReleaseNote(note, "v143")).toThrow("이번 배포");
  });
  it.each(["", " ", "첫 줄\n둘째 줄", "a".repeat(201)])("rejects invalid copy %j", value => {
    expect(() => validateReleaseNote({ ...note, description: value })).toThrow();
  });
});
