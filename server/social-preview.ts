import { randomInt, randomUUID } from "node:crypto";

export const socialPreviewBackgrounds = [
  "forest-pond",
  "garden-cottage",
  "birch-lantern-path",
  "pond-bench",
  "cherry-grove",
  "flower-garden-path",
  "koi-pond",
] as const;

const siteKeyByPath = new Map([
  ["/og-image.jpg", "spawnpoint"],
  ["/og-image-spawnpoint.jpg", "spawnpoint"],
  ["/og-image-yege.jpg", "yege"],
  ["/og-image-bacon.jpg", "bacon"],
]);

export function socialPreviewLocation(
  pathname: string,
  backgroundIndex: number,
  requestId: string,
): string | null {
  const siteKey = siteKeyByPath.get(pathname);
  const background = socialPreviewBackgrounds[backgroundIndex];
  if (!siteKey || !background) return null;
  return `/og/${siteKey}-${background}.jpg?request=${encodeURIComponent(requestId)}`;
}

export function randomSocialPreviewLocation(pathname: string): string | null {
  return socialPreviewLocation(
    pathname,
    randomInt(socialPreviewBackgrounds.length),
    randomUUID(),
  );
}
