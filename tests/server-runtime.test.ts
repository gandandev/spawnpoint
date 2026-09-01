import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("bundled server runtime", () => {
  it("pins the patched EaglerXServer 1.1.1 release", () => {
    const jar = fs.readFileSync(path.join(process.cwd(), "server-runtime/seed/plugins/EaglerXServer.jar"));
    const attribution = fs.readFileSync(path.join(process.cwd(), "ATTRIBUTION.md"), "utf8");
    const digest = crypto.createHash("sha256").update(jar).digest("hex");

    expect(digest).toBe("468cb07eb7ca466b21b439be75156d3d01579327f4c6dae5b67d471137a64208");
    expect(attribution).toContain("EaglerXServer 1.1.1");
    expect(attribution).toContain(`\`${digest}\``);
  });
});
