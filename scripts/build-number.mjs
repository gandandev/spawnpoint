import { execFileSync } from "node:child_process";

export function resolveBuildNumber({ env = process.env, cwd = process.cwd() } = {}) {
  const repository = env.SPAWNPOINT_BUILD_REPOSITORY || cwd;
  const git = args => execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const revision = env.RAILWAY_GIT_COMMIT_SHA || "HEAD";
  if (revision !== "HEAD" && !/^[0-9a-f]{40}$/i.test(revision)) {
    throw new Error("The deployment commit must be a full Git SHA.");
  }
  try {
    git(["rev-parse", "--git-dir"]);
  } catch {
    if (env.RAILWAY_GIT_COMMIT_SHA || env.SPAWNPOINT_BUILD_REPOSITORY) {
      throw new Error("Deployment version requires the complete Git history.");
    }
    return "dev";
  }
  if (git(["rev-parse", "--is-shallow-repository"]) === "true") {
    throw new Error("Fetch the complete Git history before calculating the version.");
  }
  return git(["rev-list", "--count", revision]);
}
