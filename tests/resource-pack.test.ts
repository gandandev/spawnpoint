import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

function tarFiles(archive: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(archive);
  const files = new Map<string, Buffer>();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = tar.subarray(offset, offset + 100).toString("utf8").replace(/\0.*$/, "");
    if (!name) break;
    const normalizedName = name.startsWith("./") ? name.slice(2) : name;
    const sizeText = tar.subarray(offset + 124, offset + 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const type = tar[offset + 156];
    const dataStart = offset + 512;
    if (type === 0 || type === 48) files.set(normalizedName, tar.subarray(dataStart, dataStart + size));
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

describe("bundled resource pack", () => {
  it("ships the verified 1.12 New Default V2 pack with its attribution", () => {
    const archive = fs.readFileSync(path.join(process.cwd(), "public/game/resource-packs/new-default-v2.tar.gz"));
    const bridge = fs.readFileSync(path.join(process.cwd(), "public/game/resource-pack-bridge.js"), "utf8");
    const files = tarFiles(archive);

    const archiveHash = "36a9184a4ee864cdbd29ed6e533ad1883c8b2809457636b81f02e3b066e72b72";
    expect(crypto.createHash("sha256").update(archive).digest("hex")).toBe(archiveHash);
    expect(bridge).toContain(`newDefaultResourcePackVersion = "${archiveHash}"`);
    expect(files.size).toBe(1002);
    expect(JSON.parse(files.get("pack.mcmeta")!.toString("utf8"))).toEqual({
      pack: { pack_format: 3, description: "New updated textures!" },
    });
    expect(files.get("README.md")!.toString("utf8")).toContain("Preserved and Ported by Lissten");
    expect(files.get("assets/minecraft/textures/blocks/stone.png")).toBeDefined();

    const panoramaHashes = {
      "panorama_0.png": "265811fe173c4334a4e6488618953ed76a398c27b86d3709085acc89e85de075",
      "panorama_1.png": "00f27134e42cb8c8609b0ffe0ee9439242ea5fd0c1a24dcdbcc7dd904efd48ce",
      "panorama_2.png": "baf98ace911453364a662b94857e45c822a7c325977d96874a790fdae01d733e",
      "panorama_3.png": "01925def7e9f4043ab0dd022d3e4c19463e60b5cf93ad5ef0058d98179feb29b",
      "panorama_4.png": "265811fe173c4334a4e6488618953ed76a398c27b86d3709085acc89e85de075",
      "panorama_5.png": "00f27134e42cb8c8609b0ffe0ee9439242ea5fd0c1a24dcdbcc7dd904efd48ce",
      "panorama_overlay.png": "cce8a709b00e632508b9f54a51a87b24949888695b061cc1dc3f71efdcbc4a57",
    };
    for (const [name, expectedHash] of Object.entries(panoramaHashes)) {
      const file = files.get(`assets/minecraft/textures/gui/title/background/${name}`);
      expect(file, name).toBeDefined();
      expect(crypto.createHash("sha256").update(file!).digest("hex"), name).toBe(expectedHash);
    }
  });
});
