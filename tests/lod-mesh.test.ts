import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

function mesh(tiles: Array<{ x: number; z: number; cells: number[] }>): Float32Array {
  let output: Float32Array = new Float32Array();
  const self = { onmessage: (_event: unknown) => {}, postMessage: (data: { vertices: Float32Array }) => { output = data.vertices; } };
  vm.runInNewContext(fs.readFileSync("experiments/minecraft-26/lod-mesh-worker.js", "utf8"), { self, Float32Array });
  self.onmessage({ data: { tiles, world: "test" } });
  return output;
}

describe("distant terrain mesh", () => {
  it("uses world coordinates for negative chunks and keeps packed map colors", () => {
    const vertices = mesh([{ x: -1, z: -2, cells: Array.from({ length: 16 }, () => [70, 0xff8040]).flat() }]);
    expect([...vertices.subarray(0, 3)]).toEqual([-16, 70, -32]);
    expect(vertices[3]).toBe(1);
    expect(vertices[4]).toBeCloseTo(128 / 255);
    expect(vertices[5]).toBeCloseTo(64 / 255);
    expect([...vertices].every(Number.isFinite)).toBe(true);
  });

  it("does not add a skirt between adjoining flat chunks", () => {
    const cells = Array.from({ length: 16 }, () => [70, 0xffffff]).flat();
    const one = mesh([{ x: 0, z: 0, cells }]);
    const pair = mesh([{ x: 0, z: 0, cells }, { x: 1, z: 0, cells }]);
    expect(pair.length).toBe(one.length * 2 - 4 * 6 * 6);
  });
});
