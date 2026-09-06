import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
const source = readFileSync('experiments/minecraft-26/escape-26.2.js', 'utf8');
afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  const canvas = Object.assign(new EventTarget(), { focus: vi.fn(), requestPointerLock: vi.fn() });
  const doc = Object.assign(new EventTarget(), { hidden: false, pointerLockElement: canvas as typeof canvas | null, querySelector: () => canvas, hasFocus: () => true });
  const state = { screen: '', portalHidden: false, restoreAfterEscape: () => {} };
  const w = Object.assign(new EventTarget(), { __spawnpoint262: state });
  class Key extends Event { key = 'Escape'; constructor(type: string, options: EventInit) { super(type, options); } }
  vm.runInNewContext(source, { window: w, document: doc, location: { search: '?launch=qa' }, URLSearchParams, KeyboardEvent: Key, setTimeout, clearTimeout });
  return { canvas, doc, state, w, Key };
}
it('supplies a missing pause event after unlock without duplicating a native menu', () => {
  const { canvas, doc, state } = fixture();
  const events: string[] = [];
  canvas.addEventListener('keydown', () => events.push('keydown'));
  canvas.addEventListener('keyup', () => events.push('keyup'));
  doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange'));
  vi.advanceTimersByTime(100);
  expect(events).toEqual(['keydown', 'keyup']);
  events.length = 0;
  doc.pointerLockElement = canvas; doc.dispatchEvent(new Event('pointerlockchange'));
  doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange'));
  state.screen = 'PauseScreen';
  vi.advanceTimersByTime(100);
  expect(events).toEqual([]);
});
it('waits for Escape release before restoring the lock after closing inventory', () => {
  const { canvas, doc, state, w, Key } = fixture();
  doc.pointerLockElement = null; state.screen = 'InventoryScreen';
  const down = new Key('keydown', { cancelable: true }); w.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  state.screen = ''; state.restoreAfterEscape();
  expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  w.dispatchEvent(new Key('keyup', { cancelable: true }));
  vi.advanceTimersByTime(1);
  expect(canvas.requestPointerLock).toHaveBeenCalledOnce();
});
