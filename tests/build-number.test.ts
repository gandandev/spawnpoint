import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveBuildNumber } from "../scripts/build-number.mjs";

const directory = mkdtempSync(path.join(tmpdir(), "spawnpoint-build-number-"));
const repository = path.join(directory, "history");
const git = (...args: string[]) => execFileSync("git", args, {
  encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
}).trim();
git("init", repository);
const commit = () => git("-C", repository, "-c", "user.name=Test", "-c", "user.email=test@example.com",
  "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "Build version fixture");
commit();
const firstCommit = git("-C", repository, "rev-parse", "HEAD");
commit();
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("build number", () => {
  it("counts local commit history", () => {
    expect(resolveBuildNumber({ env: {}, cwd: repository })).toBe("2");
  });

  it("counts the deployed commit even when the branch has advanced", () => {
    expect(resolveBuildNumber({ env: {
      RAILWAY_GIT_COMMIT_SHA: firstCommit,
      SPAWNPOINT_BUILD_REPOSITORY: repository,
    }, cwd: directory })).toBe("1");
  });

  it("uses dev only for a local source directory without Git history", () => {
    expect(resolveBuildNumber({ env: {}, cwd: directory })).toBe("dev");
    expect(() => resolveBuildNumber({ env: { RAILWAY_GIT_COMMIT_SHA: firstCommit }, cwd: directory }))
      .toThrow("complete Git history");
  });

  it("rejects incomplete history instead of showing a smaller version", () => {
    const shallow = path.join(directory, "shallow");
    git("clone", "--depth=1", `file://${repository}`, shallow);
    expect(() => resolveBuildNumber({ env: {}, cwd: shallow })).toThrow("complete Git history");
  });

  it("rejects an invalid or unavailable deployment commit", () => {
    for (const sha of ["invalid", "0".repeat(40)]) {
      expect(() => resolveBuildNumber({ env: { RAILWAY_GIT_COMMIT_SHA: sha }, cwd: repository })).toThrow();
    }
  });
});
