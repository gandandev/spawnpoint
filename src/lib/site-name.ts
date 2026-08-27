const DOMAIN_SITE_NAMES = new Map([
  [new URL("https://예게.서버.한국").hostname, "예게.서버.한국"],
  [new URL("https://베이컨.서버.한국").hostname, "베이컨.서버.한국"],
]);

export function siteNameForHostname(hostname: string) {
  const input = hostname.toLowerCase().replace(/\.$/, "");
  let normalized = input;
  try {
    normalized = new URL(`https://${input}`).hostname;
  } catch {
    // A malformed hostname cannot match a configured domain.
  }
  return DOMAIN_SITE_NAMES.get(normalized) ?? "spawnpoint";
}

export function currentSiteName() {
  return siteNameForHostname(window.location.hostname);
}
