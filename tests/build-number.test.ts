import { describe, expect, it } from "vitest";
import { resolveBuildNumber } from "../scripts/build-number.mjs";

describe("build number", () => {
  it("uses the deployed commit before the local checkout", () => {
    expect(resolveBuildNumber({
      env: { RAILWAY_GIT_COMMIT_SHA: "abc123456789" },
      localSha: "def567890123",
    })).toBe("abc1234");
  });

  it("uses the local commit outside Railway", () => {
    expect(resolveBuildNumber({ env: {}, localSha: "DEF567890123" })).toBe("def5678");
  });

  it("labels builds without a valid commit as development builds", () => {
    expect(resolveBuildNumber({ env: {}, localSha: "" })).toBe("dev");
    expect(resolveBuildNumber({ env: {}, localSha: "invalid" })).toBe("dev");
  });
});
