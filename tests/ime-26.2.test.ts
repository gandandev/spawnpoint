import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = fs.readFileSync('experiments/minecraft-26/ime-26.2.js', 'utf8');
const windows: JSDOM[] = [];
afterEach(() => { windows.splice(0).forEach(dom => dom.window.close()); });

function harness() {
  const dom = new JSDOM('<canvas class="_eaglercraftX_canvas_element"></canvas><input data-eagler-text-input="true"><input id="other">', { runScripts: 'outside-only', pretendToBeVisual: true });
  windows.push(dom);
  const win = dom.window;
  win.HTMLCanvasElement.prototype.getBoundingClientRect = (() => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 })) as never;
  win.eval(source);
  const runtime = win as unknown as { spawnpoint262Ime: { bind(exports: unknown): void; clear(): void } };
  const hook = { value: (_x: number, _y: number, _width: number, _height: number) => {} };
  runtime.spawnpoint262Ime.bind({ 'spawnpoint.textInputRendered': hook });
  hook.value(30, 285, 400, 300);
  const input = win.document.querySelector('input')!;
  input.value = ' ';
  input.focus();
  const compose = (type: string, data: string) => {
    const event = new win.CompositionEvent(type, { bubbles: true, cancelable: true, data });
    input.dispatchEvent(event);
    return event;
  };
  const preview = () => win.document.getElementById('spawnpoint-ime-preedit')!;
  return { win, runtime, hook, input, compose, preview };
}

describe('26.2 native IME preedit', () => {
  it('shows every Korean composition update immediately and leaves native commits untouched', () => {
    const h = harness();
    const committed = vi.fn();
    h.input.addEventListener('compositionend', committed);
    h.compose('compositionstart', '');
    for (const syllable of ['ㅎ', '하', '한']) {
      expect(h.compose('compositionupdate', syllable).defaultPrevented).toBe(false);
      expect(h.preview().textContent).toBe(syllable);
      expect(h.preview().hidden).toBe(false);
      expect(h.input.value).toBe(' ');
    }
    h.compose('compositionend', '한');
    expect(h.preview().hidden).toBe(true);
    expect(committed).toHaveBeenCalledTimes(1);
    expect(h.input.value).toBe(' ');
  });

  it('handles Chrome composing beforeinput without canceling it or forwarding duplicate text', () => {
    const h = harness();
    const nativeInput = vi.fn();
    h.input.addEventListener('beforeinput', nativeInput);
    const event = new h.win.InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertCompositionText', isComposing: true, data: '가' });
    h.input.dispatchEvent(event);
    expect(h.preview().textContent).toBe('가');
    expect(event.defaultPrevented).toBe(false);
    expect(nativeInput).toHaveBeenCalledTimes(1);
    h.compose('compositionend', '가');
    h.compose('compositionstart', '');
    h.compose('compositionupdate', '가');
    expect(h.preview().hidden).toBe(false);
    h.compose('compositionend', '');
    expect(h.preview().hidden).toBe(true);
  });

  it('follows the real caret and native GUI size, and clears on focus or screen changes', () => {
    const h = harness();
    h.compose('compositionstart', '한');
    expect(h.preview().style.left).toBe('60px');
    expect(h.preview().style.fontSize).toBe('18px');
    h.hook.value(80, 50, 800, 600);
    expect(h.preview().style.left).toBe('80px');
    expect(h.preview().style.fontSize).toBe('9px');
    h.input.blur();
    expect(h.preview().hidden).toBe(true);
    h.input.focus();
    h.compose('compositionstart', '한');
    h.runtime.spawnpoint262Ime.clear();
    expect(h.preview().hidden).toBe(true);
    h.hook.value(90, 50, 800, 600);
    expect(h.preview().hidden).toBe(true);
  });

  it('ignores other inputs and keeps preview failures out of the native render loop', () => {
    const h = harness();
    const other = h.win.document.getElementById('other')!;
    other.dispatchEvent(new h.win.CompositionEvent('compositionstart', { bubbles: true, data: '한' }));
    expect(h.preview()).toBeNull();
    h.compose('compositionstart', '한');
    h.win.HTMLCanvasElement.prototype.getBoundingClientRect = () => { throw Error('detached canvas'); };
    expect(() => h.hook.value(30, 285, 400, 300)).not.toThrow();
    expect(h.preview().hidden).toBe(true);
  });
});
