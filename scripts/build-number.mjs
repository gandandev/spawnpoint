import { execFileSync } from "node:child_process";

function localCommitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function resolveBuildNumber({
  env = process.env,
  localSha = localCommitSha(),
} = {}) {
  const sha = env.RAILWAY_GIT_COMMIT_SHA || localSha;
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : "dev";
}
