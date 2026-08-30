import { describe, expect, it } from "vitest";
import { siteIndexForHostname } from "../server/site-index";

describe("server site index", () => {
  it.each([
    ["예게.서버.한국", "index-yege.html"],
    [new URL("https://예게.서버.한국").hostname, "index-yege.html"],
    ["베이컨.서버.한국", "index-bacon.html"],
    [new URL("https://베이컨.서버.한국").hostname, "index-bacon.html"],
    ["spawnpointmc.up.railway.app", "index.html"],
    ["localhost", "index.html"],
  ])("uses the index for %s", (hostname, expected) => {
    expect(siteIndexForHostname(hostname)).toBe(expected);
  });

  it("normalizes host casing and a trailing dot", () => {
    const hostname = `${new URL("https://예게.서버.한국").hostname.toUpperCase()}.`;
    expect(siteIndexForHostname(hostname)).toBe("index-yege.html");
  });
});
