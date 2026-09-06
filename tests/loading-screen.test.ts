import { JSDOM } from 'jsdom';
import { expect, it, vi } from 'vitest';
import { brandLoadingScreen } from '../experiments/minecraft-26/loading-screen.mjs';

it('keeps the return link available when a crash occurs after the loading overlay is gone', () => {
  const html = brandLoadingScreen('<head></head>\t<div id="loading_screen"></div>\t<div id="game_frame"></div><script>var st = document.getElementById("boot_status");window.__eaglerGameReady === true</script>');
  const dom = new JSDOM(html, { url: 'https://portal.test/', runScripts: 'outside-only' });
  const { window } = dom;
  const showCrash = vi.fn(() => {
    const panel = window.document.createElement('div');
    panel.className = '_eaglercraftX_crash_element';
    window.document.body.appendChild(panel);
  });
  Object.assign(window, { __eaglerShowShellCrash: showCrash });
  try {
    window.eval(window.document.querySelector('script')!.textContent!);
    window.document.getElementById('loading_screen')!.remove();
    const error = new Error('late startup failure');
    expect(() => (window as any).__eaglerShowShellCrash(error)).not.toThrow();
    expect(showCrash).toHaveBeenCalledWith(error);
    const exit = window.document.querySelector<HTMLAnchorElement>('._eaglercraftX_crash_element a')!;
    expect(exit.textContent).toBe('포털로 돌아가기');
    expect(exit.href).toBe('https://portal.test/');
    expect(exit.style.display).toBe('block');
  } finally {
    window.close();
  }
});
