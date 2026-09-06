import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const client = readFileSync("experiments/minecraft-26/client-26.2.js", "utf8");

function harness() {
  class Context {
    source = "";
    uploads: number[][] = [];
    shaderSource(_shader: object, source: string) { this.source = source; }
    useProgram(_program?: object) {}
    getUniformLocation() { return {}; }
    uniform4fv(_location: object, value: Float32Array) { this.uploads.push([...value]); }
  }
  let tick: () => Promise<void> = async () => {};
  let snapshot = {};
  let now = 0;
  let fail = false;
  const state: { heldLight?: Float32Array } = {};
  const context = {
    URLSearchParams, Float32Array, Map, WeakMap,
    location: { search: "?launch=test" },
    __spawnpoint262: state,
    __eaglerWorldReady: true,
    WebGL2RenderingContext: Context,
    addEventListener() {},
    document: { hidden: false, addEventListener() {}, querySelector() { return null; } },
    performance: { now: () => now },
    setInterval(callback: () => Promise<void>) { tick = callback; },
    fetch: async () => {
      if (fail) throw new Error("offline");
      return { ok: true, json: async () => snapshot };
    },
  };
  vm.runInNewContext(client, { ...context, window: context });
  return {
    gl: new Context(), state,
    async update(value: object) { snapshot = value; await tick(); },
    async expire() { fail = true; now = 1200; await tick(); },
  };
}

const modelVertex = `
void main() {
    gl_Position = ProjMat * ModelViewMat * vec4(Position, 1.0);
    lightMapColor = sample_lightmap(Sampler2, UV2);
}`;

describe("held light", () => {
  it("lights model vertices in world coordinates and preserves sky light and GUI previews", () => {
    const { gl } = harness();
    gl.shaderSource({}, modelVertex);
    expect(gl.source).toContain("Position + vec3(CameraBlockPos) - CameraOffset");
    expect(gl.source).toContain("uniform Globals");
    expect(gl.source).toContain("heldLevel *= ProjMat[3][3] == 0.0 ? 1.0 : 0.0");
    expect(gl.source).toContain("max(float(UV2.x), heldLevel * 16.0), UV2.y");
    expect(gl.source).not.toContain("sample_lightmap(Sampler2, UV2)");
  });

  it("keeps the terrain coordinate path and does not duplicate existing Globals", () => {
    const { gl } = harness();
    const globals = "layout(std140) uniform Globals { ivec3 CameraBlockPos; };\n";
    gl.shaderSource({}, globals + modelVertex);
    expect(gl.source.match(/uniform Globals/g)).toHaveLength(1);
    gl.shaderSource({}, globals + `void main() {
      vec3 pos = Position + vec3(ChunkPosition - CameraBlockPos);
      vertexColor = Color * sample_lightmap(Sampler2, UV2);
    }`);
    expect(gl.source).toContain("length(Position + vec3(ChunkPosition) - SpawnpointHeldLight.xyz)");
    expect(gl.source.match(/uniform Globals/g)).toHaveLength(1);
  });

  it("leaves unrelated and emissive-only shader sources unchanged", () => {
    const { gl } = harness();
    for (const source of ["void main() { gl_Position = vec4(0.0); }", modelVertex.replace("sample_lightmap(Sampler2, UV2)", "vec4(1.0)")]) {
      gl.shaderSource({}, source);
      expect(gl.source).toBe(source);
    }
  });

  it("updates both shader programs for either hand, removal, and stale player state", async () => {
    const { gl, state, update, expire } = harness();
    const terrain = {}, entity = {};
    const player = { x: 100.25, y: 64.5, z: -200.75, mainHand: "minecraft:torch", offHand: "minecraft:lantern" };
    await update({ active: true, clientState: player });
    expect([...state.heldLight!]).toEqual([100.25, 64.5, -200.75, 15]);
    gl.useProgram(terrain);
    gl.useProgram(entity);
    gl.useProgram(entity);
    expect(gl.uploads).toHaveLength(2);
    await update({ active: true, clientState: { ...player, offHand: "minecraft:air" } });
    gl.useProgram(entity);
    expect(gl.uploads.at(-1)?.[3]).toBe(14);
    await update({ active: true, clientState: { ...player, mainHand: "minecraft:air", offHand: "minecraft:air" } });
    gl.useProgram(terrain);
    gl.useProgram(entity);
    expect(gl.uploads.slice(-2).map(value => value[3])).toEqual([0, 0]);
    await update({ active: true, clientState: player });
    await expire();
    gl.useProgram(entity);
    expect(gl.uploads.at(-1)?.[3]).toBe(0);
  });
});
