(() => {
  const query = new URLSearchParams(location.search);
  const tablet = navigator.maxTouchPoints > 0 && matchMedia('(pointer:coarse)').matches;
  const requested = query.get('profile');
  const profile = ['native', 'gram', 'tablet'].includes(requested) ? requested : tablet ? 'tablet' : 'gram';
  const nativeRatio = devicePixelRatio;
  const budget = profile === 'tablet' ? 800000 : 1024000;
  const ratio = profile === 'native' ? nativeRatio : Math.min(nativeRatio, 1, Math.sqrt(budget / Math.max(1, innerWidth * innerHeight)));
  // Fixed for this launch. Repeated canvas resizing during play can cause black frames.
  if (ratio !== nativeRatio) Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => ratio });
  const namespace = `_spawnpoint26_${profile}`;
  // This port does not yet apply the launcher's servers/joinServer options.
  // Seed its standard uncompressed servers.dat once in this isolated namespace.
  const serverKey = `${namespace}.minecraft.servers.dat`;
  try {
    if (!localStorage.getItem(serverKey)) {
      const bytes = [10, 0, 0, 9];
      const string = value => { const data = new TextEncoder().encode(value); bytes.push(data.length >> 8, data.length & 255, ...data); };
      string('servers'); bytes.push(10, 0, 0, 0, 1);
      bytes.push(8); string('name'); string('Spawnpoint 26.2 prototype');
      bytes.push(8); string('ip'); string(`ws://${location.host}/gateway`);
      bytes.push(0, 0);
      localStorage.setItem(serverKey, btoa(String.fromCharCode(...bytes)));
    }
  } catch { /* Direct Connection remains available when storage is disabled. */ }
  const loaded = [], saved = [];
  window.__prototype26 = { profile, nativeRatio, ratio, budget, loaded, saved };
  window.eaglercraftXOpts = {
    container: 'game', assetsURI: '/assets.epk', localesURI: '/lang/',
    localStorageNamespace: namespace, worldsDB: `${namespace}_worlds`, resourcePacksDB: `${namespace}_packs`,
    lang: 'ko_KR', allowUpdateSvc: false, allowUpdateDL: false,
    allowVoiceClient: false, allowServerRedirects: false, finishOnSwap: false,
    servers: [{ addr: `ws://${location.host}/gateway`, name: 'Spawnpoint 26.2 prototype' }],
    joinServer: `ws://${location.host}/gateway`, relays: [],
    hooks: {
      localStorageLoaded(key) {
        loaded.push(key);
        try { return localStorage.getItem(key); } catch { return null; }
      },
      localStorageSaved(key, value) {
        saved.push(key);
        try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch {}
      },
    },
  };
  // These fields are guarded against the pinned client hash in build-client.mjs.
  window.spawnpoint26Options = (options, integer, off, cloudsOff, fast, deferred, decimal, minimized) => {
    // Upstream audio repeatedly retries failed music streams every few seconds.
    options.h_6.e5V.data[1].eTb = decimal(0);
    options.f7d.eTb = integer(90);
    options.hiK.eTb = integer(120);
    options.hBq.eTb = minimized;
    options.fMt.eTb = integer(profile === 'tablet' ? 4 : 6);
    options.hlA.eTb = integer(5); // This client validates a minimum of five; Paper still simulates four.
    options.gdu.eTb = integer(0);
    options.gBE.eTb = off;
    options.gdn.eTb = off;
    options.gAI.eTb = fast;
    options.gnU.eTb = cloudsOff;
    options.gDe.eTb = deferred;
    window.__prototype26.applyViewDistance = () => { options.fMt.eTb = integer(profile === 'tablet' ? 4 : 6); };
  };
  // MacBook GUI 4 at DPR 2 is two CSS pixels per GUI pixel.
  window.spawnpoint26GuiScale = (width, height) => Math.max(1, Math.min(
    Math.round(2 * Math.min(width / innerWidth, height / innerHeight)), Math.floor(width / 320), Math.floor(height / 240)));
  window.spawnpoint26Client = client => { window.__prototype26.client = client; };
  window.prototypeSettingsReady = Promise.resolve();
})();
