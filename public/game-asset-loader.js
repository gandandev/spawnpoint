(() => {
  if (window.spawnpointGameAssets) return;
  const nativeFetch = window.fetch.bind(window);
  const downloads = new Map();
  const modules = new Map();
  let manifestPromise;
  const mobile = /Android|iPhone|iPad|iPod/.test(window.navigator?.userAgent || '')
    || (window.navigator?.maxTouchPoints > 1 && /Mac/.test(window.navigator?.platform || ''));
  const apple = /Apple/.test(window.navigator?.vendor || '');
  let compilationQueue = Promise.resolve();

  function remember(map, key, task) {
    if (!map.has(key)) {
      const pending = task().catch(error => {
        map.delete(key);
        throw error;
      });
      map.set(key, pending);
    }
    return map.get(key);
  }

  async function response(asset) {
    const result = await nativeFetch(asset.url, {
      credentials: 'omit', signal: AbortSignal.timeout(120000),
    });
    if (!result.ok) throw new Error(`Game asset HTTP ${result.status}: ${asset.url}`);
    return result;
  }

  const api = {
    manifest() {
      if (!manifestPromise) {
        manifestPromise = nativeFetch('/game/client-assets.json', { cache: 'no-cache' })
          .then(result => {
            if (!result.ok) throw new Error('Game assets are not available');
            return result.json();
          }).catch(error => { manifestPromise = undefined; throw error; });
      }
      return manifestPromise;
    },
    load(asset) {
      return remember(downloads, asset.url, async () => (await response(asset)).blob());
    },
    compile(asset) {
      return remember(modules, asset.url, async () => {
        const compile = async () => {
          const result = await response(asset);
          const options = { builtins: ['js-string'] };
          // Older Safari ignores streaming compile options. Byte compilation
          // supports the string builtins without keeping a cloned response alive.
          if (apple || typeof WebAssembly.compileStreaming !== 'function'
              || result.headers.get('content-type')?.split(';')[0].trim() !== 'application/wasm') {
            return WebAssembly.compile(await result.arrayBuffer(), options);
          }
          return WebAssembly.compileStreaming(result, options);
        };
        if (!mobile) return compile();
        const pending = compilationQueue.then(compile);
        compilationQueue = pending.catch(() => {});
        return pending;
      });
    },
    async warm() {
      const manifest = await api.manifest();
      // Preload resource packs on mobile/Safari without compiling outside the game.
      const preload = manifest.preload.filter(name => !(mobile || apple) || manifest.assets[name].type !== 'application/wasm');
      await Promise.all(preload.map(name => {
        const asset = manifest.assets[name];
        return asset.type === 'application/wasm' ? api.compile(asset) : api.load(asset);
      }));
    },
    install(manifest) {
      // Only the same-origin game frame can access this in-memory cache.
      let shared = api;
      try { shared = window.parent.spawnpointGameAssets || api; } catch { /* Standalone launch. */ }
      // Keep Safari's native Module in the same realm as its runtime.
      // Keep Blob downloads shared, but do not pass parent-owned Modules to it.
      const compiler = apple ? api : shared;
      window.spawnpointCompileWasm = name => compiler.compile(manifest.assets[name]);
      window.spawnpointPrepareAssets = async options => {
        const assets = new Map(Object.values(manifest.assets).map(asset => [asset.url, asset]));
        await Promise.all(options.assetsURI.map(async entry => {
          const asset = assets.get(entry.url);
          if (!asset || asset.type === 'application/wasm') return;
          const blob = await shared.load(asset);
          window.__eaglerAssetDownloadProgress?.(entry.url, blob.size, blob.size, true);
          // The existing fetch/XHR loader reads this frame-owned Blob without
          // another network request. The browser releases it when the frame exits.
          entry.url = URL.createObjectURL(blob);
        }));
      };
    },
  };
  window.spawnpointGameAssets = api;
})();
