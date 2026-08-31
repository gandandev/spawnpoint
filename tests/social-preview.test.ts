import { describe, expect, it } from "vitest";
import {
  socialPreviewBackgrounds,
  socialPreviewLocation,
} from "../server/social-preview";

describe("random social previews", () => {
  it.each([
    ["/og-image.jpg", "spawnpoint"],
    ["/og-image-spawnpoint.jpg", "spawnpoint"],
    ["/og-image-yege.jpg", "yege"],
    ["/og-image-bacon.jpg", "bacon"],
  ])("maps %s to every %s background variant", (pathname, siteKey) => {
    socialPreviewBackgrounds.forEach((background, index) => {
      expect(socialPreviewLocation(pathname, index, "request 1")).toBe(
        `/og/${siteKey}-${background}.jpg?request=request%201`,
      );
    });
  });

  it("rejects an unknown preview path or background", () => {
    expect(socialPreviewLocation("/not-an-og-image.jpg", 0, "request-1")).toBeNull();
    expect(socialPreviewLocation("/og-image.jpg", -1, "request-1")).toBeNull();
    expect(socialPreviewLocation("/og-image.jpg", socialPreviewBackgrounds.length, "request-1")).toBeNull();
  });
});
