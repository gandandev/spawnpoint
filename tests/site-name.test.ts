import { describe, expect, it } from "vitest";
import { siteNameForHostname } from "../src/lib/site-name";

describe("site name", () => {
  it.each([
    ["예게.서버.한국", "예게.서버.한국"],
    [new URL("https://예게.서버.한국").hostname, "예게.서버.한국"],
    ["베이컨.서버.한국", "베이컨.서버.한국"],
    [new URL("https://베이컨.서버.한국").hostname, "베이컨.서버.한국"],
    ["spawnpointmc.up.railway.app", "spawnpoint"],
    ["localhost", "spawnpoint"],
  ])("uses the name for %s", (hostname, expected) => {
    expect(siteNameForHostname(hostname)).toBe(expected);
  });

  it("normalizes host casing and a trailing dot", () => {
    const hostname = `${new URL("https://베이컨.서버.한국").hostname.toUpperCase()}.`;
    expect(siteNameForHostname(hostname)).toBe("베이컨.서버.한국");
  });
});
