(() => {
  const opts = window.eaglercraftXOpts;
  const params = new URLSearchParams(location.search);
  const managed = params.has('launch');
  const gateway = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/gateway${managed ? '?launch=' + encodeURIComponent(params.get('launch')) : ''}`;
  const requested = new URLSearchParams(location.search).get('profile');
  const profile = ['native', 'gram', 'tablet'].includes(requested) ? requested : 'gram';
  const nativeRatio = devicePixelRatio;
  const ratio = profile === 'native' ? nativeRatio : Math.min(nativeRatio, 1,
    Math.sqrt((profile === 'tablet' ? 800000 : 1024000) / Math.max(1, innerWidth * innerHeight)));
  if (ratio !== nativeRatio) Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => ratio });
  opts.localStorageNamespace = '_spawnpoint262' + (managed ? '_' + (params.get('account') || '').replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() : '');
  opts.worldsDB = '_spawnpoint262_worlds';
  opts.resourcePacksDB = '_spawnpoint262_packs';
  opts.servers = [{ addr: gateway, name: 'Spawnpoint Java 26.2' }];
  opts.joinServer = gateway;
  opts.relays = [];
  if (managed) {
    opts.assetsURI[0].url = window.spawnpointAssetManifest?.assets['assets-spawnpoint-vanilla.epk'].url || 'assets-spawnpoint-vanilla.epk';
    opts.assetsURI.push({ url: '/api/game/heads.epk', path: '' });
  }
  opts.lang = 'ko_kr';
  opts.allowUpdateSvc = false;
  opts.allowUpdateDL = false;
  opts.allowVoiceClient = false;
  opts.allowServerRedirects = false;
  opts.finishOnSwap = false;
  // This port upgrades typed ws:// addresses to wss://. Our authenticated local
  // gateway uses HTTP; correct only that exact same-host development endpoint.
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(address, protocols) {
      const url = new URL(address, location.href);
      if (location.protocol === 'http:' && url.host === location.host && url.pathname === '/gateway') url.protocol = 'ws:';
      super(url.href, protocols);
    }
  };
  window.eaglercraftXIwaBundleURL = '';
  window.__spawnpoint262 = { profile, nativeRatio, ratio };
  window.spawnpoint262ServerReady = managed ? (async () => {
    const deadline = Date.now() + 135000;
    while (Date.now() < deadline) {
      const response = await fetch('/api/server/status', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw Error('서버 상태를 확인하지 못했어요.');
      const { server } = await response.json();
      if (server.phase === 'online') return;
      if (server.phase === 'off' || server.phase === 'error') throw Error(server.lastError || '서버를 시작하지 못했어요.');
      await new Promise(resolve => setTimeout(resolve, 750));
    }
    throw Error('서버 시작이 예상보다 오래 걸려요.');
  })() : Promise.resolve();
  // Attach a handler immediately while WASM downloads and compiles in parallel.
  window.spawnpoint262ServerReady.catch(() => {});
  window.spawnpoint262SettingsReady = (async () => {
    if (window.spawnpointPreviewCloud && !managed) {
      const response = await fetch('/preview-session', { cache: 'no-store' });
      if (!response.ok) { location.replace('/'); throw Error('Preview login required'); }
      const session = await response.json();
      opts.username = session.username;
      localStorage.setItem(`${opts.localStorageNamespace}.username`, btoa(session.username));
    }
    if (managed) {
      const accountProfile = localStorage.getItem('_spawnpoint_' + (params.get('account') || '').toLowerCase() + '.p');
      if (accountProfile) localStorage.setItem(opts.localStorageNamespace + '.p', accountProfile);
    }
    const key = `${opts.localStorageNamespace}.g`;
    const stored = localStorage.getItem(key);
    let text = '';
    if (stored) {
      const bytes = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
      text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    }
    const settings = new Map(text.split('\n').filter(Boolean).map(line => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon), line.slice(colon + 1)];
    }));
    const marker = opts.localStorageNamespace + '.defaults.v2';
    if (!localStorage.getItem(marker)) {
      Object.entries({ version: '4903', lang: 'ko_kr', tutorialStep: 'none', fov: '0.5', renderDistance: profile === 'tablet' ? '4' : '6',
        graphicsPreset: '"fast"', renderClouds: '"off"', ao: 'false', entityShadows: 'false',
        biomeBlendRadius: '0', inactivityFpsLimit: '"minimized"', soundCategory_music: '0.0' })
        .forEach(([key, value]) => settings.set(key, value));
    }
    // Same apparent size as GUI 4 on a DPR-2 MacBook, constrained to fit.
    const guiScale = Math.max(1, Math.min(Math.round(2 * ratio), Math.floor(innerWidth * ratio / 320), Math.floor(innerHeight * ratio / 240)));
    settings.set('guiScale', String(guiScale));
    // 260 is Minecraft 26.2's unlimited sentinel, not a 260 FPS cap.
    // Let browser VSync pace frames, including when the window moves to a faster display.
    settings.set('enableVsync', 'true');
    settings.set('maxFps', '260');
    settings.set('resourcePacks', '[]');
    settings.set('incompatibleResourcePacks', '[]');
    settings.set('skipMultiplayerWarning', 'true');
    settings.set('key_key.saveToolbarActivator', 'key.keyboard.unknown');
    settings.set('key_key.loadToolbarActivator', 'key.keyboard.unknown');
    settings.set('lastServer', gateway);
    const encoded = new TextEncoder().encode([...settings].map(([key, value]) => `${key}:${value}`).join('\n') + '\n');
    const compressed = new Uint8Array(await new Response(new Blob([encoded]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    localStorage.setItem(key, btoa(String.fromCharCode(...compressed)));
    localStorage.setItem(marker, '1');
    window.__spawnpoint262.guiScale = guiScale;
  })().catch(error => console.warn('Spawnpoint 26.2 settings could not be saved', error));
})();
