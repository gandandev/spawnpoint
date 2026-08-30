const SITE_INDEX_BY_HOSTNAME = new Map([
  [new URL("https://예게.서버.한국").hostname, "index-yege.html"],
  [new URL("https://베이컨.서버.한국").hostname, "index-bacon.html"],
]);

export function siteIndexForHostname(hostname: string) {
  const input = hostname.toLowerCase().replace(/\.$/, "");
  let normalized = input;
  try {
    normalized = new URL(`https://${input}`).hostname;
  } catch {
    // A malformed hostname cannot match a configured domain.
  }
  return SITE_INDEX_BY_HOSTNAME.get(normalized) ?? "index.html";
}
