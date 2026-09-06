(() => {
  if (window.spawnpointGameAssets) return;
  const nativeFetch = window.fetch.bind(window);
  const downloads = new Map();
  const modules = new Map();
  let manifestPromise;

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
        const result = await response(asset);
        const options = { builtins: ['js-string'] };
        // Keep a fallback stream for browsers without streaming compilation.
        // Neither the response nor its bytes are retained after compilation.
        if (typeof WebAssembly.compileStreaming !== 'function') {
          return WebAssembly.compile(await result.arrayBuffer(), options);
        }
        const backup = result.clone();
        try {
          const module = await WebAssembly.compileStreaming(result, options);
          void backup.body.cancel().catch(() => {});
          return module;
        } catch {
          return WebAssembly.compile(await backup.arrayBuffer(), options);
        }
      });
    },
    async warm() {
      const manifest = await api.manifest();
      await Promise.all(manifest.preload.map(name => {
        const asset = manifest.assets[name];
        return asset.type === 'application/wasm' ? api.compile(asset) : api.load(asset);
      }));
    },
    install(manifest) {
      // Only the same-origin game frame can access this in-memory cache.
      let shared = api;
      try { shared = window.parent.spawnpointGameAssets || api; } catch { /* Standalone launch. */ }
      window.spawnpointCompileWasm = name => shared.compile(manifest.assets[name]);
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
