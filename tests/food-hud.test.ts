import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
const source = fs.readFileSync('experiments/minecraft-26/food-hud-26.2.js', 'utf8');
function harness() {
  const dom = new JSDOM('<body><canvas class="_eaglercraftX_canvas_element" width="1200" height="800"></canvas></body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  let now = 100;
  const timers: (() => void)[] = [];
  const ctx = { clearRect: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(), globalAlpha: 1 };
  win.HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
  win.HTMLCanvasElement.prototype.getBoundingClientRect = (() => ({ left: 10, top: 20, width: 600, height: 400 })) as never;
  Object.defineProperty(win.performance, 'now', { value: () => now });
  win.setInterval = ((fn: () => void) => { timers.push(fn); return timers.length; }) as never;
  win.Image = class { complete = true; naturalWidth = 256; } as never;
  win.eval(source);
  const runtime = win as unknown as { spawnpointFoodHudModel: (food: unknown, level: number) => any; spawnpointFoodHealthModel: (food: unknown, health: number) => any; createSpawnpointFoodHud: (state: any) => any; __eaglerWorldReady: boolean };
  runtime.__eaglerWorldReady = true;
  const state = { screen: '', guiScale: 9 };
  const hud = runtime.createSpawnpointFoodHud(state);
  return { dom, win, runtime, state, hud, ctx, tick(time: number) { now = time; timers.forEach(fn => fn()); } };
}
const bread = { nutrition: 5, saturation: 6, canAlwaysEat: false };
const food = { level: 17, saturation: 4, exhaustion: 2, mainHand: bread, offHand: null };
describe('26.2 food HUD', () => {
  it('caps recovery at food capacity and treats saturation as an absolute increment', () => {
    const h = harness();
    expect(h.runtime.spawnpointFoodHudModel(food, 17)).toEqual({ level: 17, saturation: 4, exhaustion: .5, levelAfter: 20, saturationAfter: 10 });
    expect(h.runtime.spawnpointFoodHudModel({ ...food, saturation: 16 }, 17).saturationAfter).toBe(20);
    h.dom.window.close();
  });
  it('uses offhand food, preserves main-hand priority and respects always-edible components', () => {
    const h = harness(); const calculate = h.runtime.spawnpointFoodHudModel;
    expect(calculate({ ...food, mainHand: null, offHand: bread }, 17).levelAfter).toBe(20);
    expect(calculate({ ...food, mainHand: { ...bread, nutrition: 1 }, offHand: bread }, 17).levelAfter).toBe(18);
    expect(calculate({ ...food, level: 20 }, 20).saturationAfter).toBe(4);
    expect(calculate({ ...food, level: 20, mainHand: { ...bread, canAlwaysEat: true } }, 20).saturationAfter).toBe(10);
    h.dom.window.close();
  });
  it('rejects malformed or out-of-sync state rather than inventing food values', () => {
    const h = harness(); const calculate = h.runtime.spawnpointFoodHudModel;
    for (const candidate of [null, {}, { ...food, saturation: NaN }, { ...food, exhaustion: -1 }, { ...food, mainHand: { nutrition: 5 } }]) expect(calculate(candidate, 17)).toBeNull();
    expect(calculate(food, 16)).toBeNull();
    h.dom.window.close();
  });
  it('uses actual native coordinates and scale, not the saved launch scale', () => {
    const h = harness(); h.hud.update(food); h.hud.render(391, 361, 17);
    const canvas = h.win.document.getElementById('spawnpoint-food-hud')!;
    expect(canvas.style.display).toBe('block');
    expect(canvas.style.left).toBe('320px'); expect(canvas.style.top).toBe('381px');
    expect(canvas.style.width).toBe('81px'); expect(h.ctx.drawImage).toHaveBeenCalled();
    h.dom.window.close();
  });
  it('waits for the game canvas instead of selecting an overlay as its anchor', () => {
    const h = harness();
    const gameCanvas = h.win.document.querySelector('canvas._eaglercraftX_canvas_element')!;
    gameCanvas.remove();
    h.hud.update(food); h.hud.render(391, 361, 17);
    expect(h.win.document.getElementById('spawnpoint-food-hud')!.style.display).toBe('none');
    h.win.document.body.appendChild(gameCanvas);
    h.hud.render(391, 361, 17);
    expect(h.win.document.getElementById('spawnpoint-food-hud')!.style.left).toBe('320px');
    h.dom.window.close();
  });
  it('hides after native HUD stops rendering or server state expires', () => {
    const h = harness(); const canvas = h.win.document.getElementById('spawnpoint-food-hud')!;
    h.hud.update(food); h.hud.render(391, 361, 17); h.tick(400);
    expect(canvas.style.display).toBe('none');
    h.tick(1200); h.hud.render(391, 361, 17); expect(canvas.style.display).toBe('none');
    h.hud.update(food); h.hud.render(391, 361, 17); expect(canvas.style.display).toBe('block');
    h.hud.update(null); expect(canvas.style.display).toBe('none');
    h.dom.window.close();
  });
  it('hides in menus and contains canvas failures inside the WASM callback', () => {
    const h = harness(); h.hud.update(food); h.state.screen = 'net.minecraft.client.gui.screens.PauseScreen';
    h.hud.render(391, 361, 17); expect(h.ctx.drawImage).not.toHaveBeenCalled();
    h.state.screen = ''; h.ctx.drawImage.mockImplementation(() => { throw Error('lost context'); });
    expect(() => h.hud.render(391, 361, 17)).not.toThrow();
    expect(h.win.document.getElementById('spawnpoint-food-hud')!.style.display).toBe('none');
    h.dom.window.close();
  });
});

const injured = { ...food, level: 13, saturation: 0, exhaustion: 0, health: 10, maxHealth: 20,
  naturalRegeneration: true, healthPredictionSafe: true,
  mainHand: { ...bread, regeneration: 0, predictable: true } };
describe('food health prediction and tooltip lifecycle', () => {
  it('predicts resting regeneration, caps health, and respects disabled regeneration', () => {
    const h = harness(); const predict = h.runtime.spawnpointFoodHealthModel;
    // 18 food and six saturation support five slow regeneration ticks.
    expect(predict(injured, 10)).toEqual({ health: 10, after: 15 });
    h.hud.update(injured); h.hud.heartsRendered(209, 361, 11, 10);
    expect(h.win.document.getElementById('spawnpoint-food-health')!.style.display).toBe('block');
    expect(predict({ ...injured, health: 19 }, 19)).toEqual({ health: 19, after: 20 });
    expect(predict({ ...injured, level: 12 }, 10)).toBeNull();
    expect(predict({ ...injured, naturalRegeneration: false }, 10)).toBeNull();
    expect(predict({ ...injured, naturalRegeneration: false, mainHand: { ...injured.mainHand, regeneration: 4 } }, 10).after).toBe(14);
    h.dom.window.close();
  });
  it('suppresses stale health, harmful effects, uncertain food and healing already underway', () => {
    const h = harness(); const predict = h.runtime.spawnpointFoodHealthModel;
    expect(predict(injured, 9)).toBeNull();
    expect(predict({ ...injured, healthPredictionSafe: false }, 10)).toBeNull();
    expect(predict({ ...injured, mainHand: { ...injured.mainHand, predictable: false } }, 10)).toBeNull();
    expect(predict({ ...injured, level: 18 }, 10)).toBeNull();
    expect(predict({ ...injured, maxHealth: NaN }, 10)).toBeNull();
    expect(predict({ ...injured, mainHand: null, offHand: injured.mainHand }, 10)?.after).toBe(15);
    h.dom.window.close();
  });
  it('handles tiny saturation without hanging and draws multiple health rows', () => {
    const h = harness();
    const unusual = { ...injured, level: 17, health: 18, maxHealth: 40, mainHand: { ...injured.mainHand, saturation: 1e-20 } };
    expect(h.runtime.spawnpointFoodHealthModel(unusual, 18)?.after).toBeGreaterThan(18);
    h.hud.update({ ...unusual, mainHand: { ...unusual.mainHand, saturation: 20 } });
    h.hud.heartsRendered(209, 361, 10, 18);
    const hearts = h.win.document.getElementById('spawnpoint-food-health') as HTMLCanvasElement;
    expect(hearts.style.display).toBe('block'); expect(hearts.height).toBeGreaterThan(9);
    h.tick(400); expect(hearts.style.display).toBe('none');
    h.dom.window.close();
  });
  it('shows the actual hovered values independently of held food, then clears them', () => {
    const h = harness(); h.state.screen = 'InventoryScreen'; h.hud.guiWidth(600);
    h.hud.foodHovered(8, 12.8); h.hud.tooltipRendered(200, 100, 70, 9);
    const tooltip = h.win.document.getElementById('spawnpoint-food-tooltip')!;
    expect(tooltip.style.display).toBe('block'); expect(tooltip.textContent).toBe('허기 +8포화도 +12.8');
    // A non-food tooltip cannot reuse the previous food's values.
    h.hud.tooltipRendered(200, 100, 70, 9); expect(tooltip.style.display).toBe('none');
    h.hud.foodHovered(5, 6); h.hud.tooltipRendered(200, 100, 70, 9);
    h.hud.render(391, 361, 17); expect(tooltip.style.display).toBe('block');
    h.tick(250); expect(tooltip.style.display).toBe('none');
    h.dom.window.close();
  });
});
