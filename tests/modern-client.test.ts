import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync('experiments/minecraft-26/client-26.2.js', 'utf8');
function fixture() {
  const upload = vi.fn();
  class GL {
    shaderSource() {}
    useProgram() {}
    getUniformLocation() { return {}; }
    uniform4fv(_location: unknown, values: Float32Array) { upload([...values]); }
  }
  class Canvas {}
  const events = new Map<string, (event: unknown) => void>();
  const postMessage = vi.fn();
  const hooks = { screenChanged: vi.fn() };
  const state = { guiScale: 2 };
  const context = {
    location: { search: '?launch=qa', origin: 'http://localhost' },
    URLSearchParams, Float32Array, WeakMap, Map, Date, HTMLCanvasElement: Canvas,
    WebGL2RenderingContext: GL, __spawnpoint262: state, __eaglerWorldReady: false,
    eaglercraftXOpts: { hooks }, parent: { postMessage }, focus: vi.fn(),
    addEventListener: (name: string, listener: (event: unknown) => void) => events.set(name, listener),
    document: { querySelector: () => ({ width: 1200, height: 700 }), addEventListener() {}, hidden: false },
    innerWidth: 1200, innerHeight: 700, setInterval: vi.fn(), setTimeout: vi.fn(), console,
  };
  const runtime = Object.assign(context, { window: context }) as typeof context & {
    __spawnpointBind262: (exports: Record<string, { value: unknown }>) => void;
    __spawnpoint262: typeof state & { heldLight: Float32Array };
  };
  vm.runInNewContext(source, runtime);
  return { runtime, GL, Canvas, events, upload, postMessage, hooks };
}

describe('modern client bridge', () => {
  it('uploads changed light independently to each program, without repeated GPU writes', () => {
    const { runtime, GL, upload } = fixture();
    const gl = new GL(), first = {}, second = {};
    const use = gl.useProgram as (program: object) => void;
    use.call(gl, first); use.call(gl, first);
    expect(upload).toHaveBeenCalledTimes(1);
    runtime.__spawnpoint262.heldLight.set([1, 2, 3, 14]);
    use.call(gl, first); use.call(gl, second); use.call(gl, first);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(upload).toHaveBeenLastCalledWith([1, 2, 3, 14]);
  });

  it('keeps startup in the game, but native disconnect returns to the current portal launch', () => {
    const { runtime, postMessage, hooks } = fixture();
    const callback = { value: null as unknown };
    runtime.__spawnpointBind262({ 'spawnpoint.screenChanged': callback });
    const screen = callback.value as (name: string | null) => void;
    screen('net.minecraft.client.gui.screens.TitleScreen');
    expect(postMessage).not.toHaveBeenCalled();
    runtime.__eaglerWorldReady = true;
    screen(null);
    screen('net.minecraft.client.gui.screens.PauseScreen');
    expect(postMessage).not.toHaveBeenCalled();
    screen('net.minecraft.client.gui.screens.TitleScreen');
    expect(postMessage).toHaveBeenCalledWith({ type: 'spawnpoint:return-to-menu', launchId: 'qa' }, 'http://localhost');
    expect(hooks.screenChanged).toHaveBeenCalled();
  });

  it('moves keyboard focus into the frame when its canvas receives pointer input', () => {
    const { runtime, Canvas, events } = fixture();
    events.get('pointerdown')!({ target: new Canvas() });
    expect(runtime.focus).toHaveBeenCalledOnce();
  });
});

it('reconnects with retained native arguments only for the owning portal', () => {
  const { runtime, events } = fixture();
  const args = [{}, {}, {}, {}, 0, null];
  const connect = vi.fn();
  const exports = Object.fromEntries(args.map((value, index) => ['spawnpoint.connectArg' + index, { value }]));
  Object.assign(exports, { 'spawnpoint.reconnect': connect, 'spawnpoint.screenChanged': { value: null } });
  runtime.__spawnpointBind262(exports);
  const resume = { type: 'spawnpoint:visibility', launchId: 'qa', visible: true, reconnect: true };
  events.get('message')!({ origin: 'http://other', source: runtime.parent, data: resume });
  events.get('message')!({ origin: 'http://localhost', source: {}, data: resume });
  expect(connect).not.toHaveBeenCalled();
  events.get('message')!({ origin: 'http://localhost', source: runtime.parent, data: resume });
  expect(connect).toHaveBeenCalledWith(...args);
  expect(runtime.__eaglerWorldReady).toBe(false);
});
