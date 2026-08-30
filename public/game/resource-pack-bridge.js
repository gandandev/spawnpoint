(function () {
  "use strict";

  var newDefaultResourcePackName = "New Default V2";
  var newDefaultResourcePackVersion = "36a9184a4ee864cdbd29ed6e533ad1883c8b2809457636b81f02e3b066e72b72";
  var newDefaultResourcePackUrl = "/game/resource-packs/new-default-v2.tar.gz?v=" + newDefaultResourcePackVersion.slice(0, 16);

  function binaryStringToBytes(binary) {
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; ++index) bytes[index] = binary.charCodeAt(index) & 255;
    return bytes;
  }

  function bytesToBinaryString(bytes) {
    var binary = "";
    var chunkSize = 32_768;
    for (var index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
    }
    return binary;
  }

  function isGzip(binary) {
    return binary.length >= 2 && binary.charCodeAt(0) === 31 && binary.charCodeAt(1) === 139;
  }

  function decodeGameSettingList(gameSettings, key) {
    var match = new RegExp("(?:^|\\n)" + key + ":([^\\r\\n]*)").exec(gameSettings);
    if (!match) return [];
    try {
      var value = JSON.parse(match[1]);
      return Array.isArray(value) ? value.filter(function (entry) { return typeof entry === "string"; }) : [];
    } catch (_error) {
      return [];
    }
  }

  async function transformGameSettings(encoded, transform, decodeBase64, encodeBase64) {
    var binary = typeof window.atob === "function" ? window.atob(encoded) : decodeBase64(encoded);
    if (!isGzip(binary)) return encodeBase64(transform(binary));
    if (typeof window.DecompressionStream !== "function" || typeof window.CompressionStream !== "function") {
      return null;
    }
    var compressed = binaryStringToBytes(binary);
    var decompressedStream = new Blob([compressed]).stream().pipeThrough(new window.DecompressionStream("gzip"));
    var gameSettings = await new Response(decompressedStream).text();
    var transformed = transform(gameSettings);
    var compressedStream = new Blob([new TextEncoder().encode(transformed)]).stream()
      .pipeThrough(new window.CompressionStream("gzip"));
    var result = new Uint8Array(await new Response(compressedStream).arrayBuffer());
    return encodeBase64(bytesToBinaryString(result));
  }

  function resourcePackDatabaseName() {
    // The shipped 1.12 WASM client keeps worlds and resource packs in this
    // fixed virtual-filesystem database. Current upstream 1.8 builds use a
    // configurable suffix, which does not apply to this binary.
    return "_net_lax1dude_eaglercraft_v1_8_internal_PlatformFilesystem_1_12_2_";
  }

  function openResourcePackDatabase() {
    return new Promise(function (resolve, reject) {
      var request;
      try {
        request = window.indexedDB.open(resourcePackDatabaseName());
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains("filesystem")) {
          request.result.createObjectStore("filesystem", { keyPath: ["path"] });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("Could not open the resource-pack database")); };
      request.onblocked = function () { reject(new Error("The resource-pack database is busy in another tab")); };
    });
  }

  function readResourcePackRow(database, path) {
    return new Promise(function (resolve, reject) {
      var request = database.transaction("filesystem", "readonly").objectStore("filesystem").get([path]);
      request.onsuccess = function () { resolve(request.result || null); };
      request.onerror = function () { reject(request.error || new Error("Could not read the resource-pack database")); };
    });
  }

  function resourcePackRowText(row) {
    if (!row || !row.data) return "";
    try {
      return new TextDecoder("utf-8").decode(row.data);
    } catch (_error) {
      return "";
    }
  }

  function parseTarString(bytes, start, length) {
    var end = start;
    var limit = start + length;
    while (end < limit && bytes[end] !== 0) ++end;
    return new TextDecoder("utf-8").decode(bytes.subarray(start, end));
  }

  function parseResourcePackTar(buffer) {
    var bytes = new Uint8Array(buffer);
    var files = [];
    for (var offset = 0; offset + 512 <= bytes.length;) {
      var name = parseTarString(bytes, offset, 100);
      if (!name) break;
      var prefix = parseTarString(bytes, offset + 345, 155);
      if (prefix) name = prefix + "/" + name;
      if (name.slice(0, 2) === "./") name = name.slice(2);
      var sizeText = parseTarString(bytes, offset + 124, 12).trim();
      var size = parseInt(sizeText || "0", 8);
      if (!Number.isFinite(size) || size < 0) throw new Error("The resource-pack archive has an invalid file size");
      var type = bytes[offset + 156];
      var dataStart = offset + 512;
      var dataEnd = dataStart + size;
      if (dataEnd > bytes.length) throw new Error("The resource-pack archive is incomplete");
      if ((type === 0 || type === 48) && name && name.charAt(0) !== "/" && name.split("/").indexOf("..") === -1) {
        files.push({ path: name, data: buffer.slice(dataStart, dataEnd) });
      }
      offset = dataStart + Math.ceil(size / 512) * 512;
    }
    if (files.length < 100 || !files.some(function (file) { return file.path === "pack.mcmeta"; })) {
      throw new Error("The resource-pack archive has no usable pack metadata");
    }
    return files;
  }

  function waitForResourcePackTransaction(transaction) {
    return new Promise(function (resolve, reject) {
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () { reject(transaction.error || new Error("Could not write the resource-pack database")); };
      transaction.onabort = function () { reject(transaction.error || new Error("The resource-pack database write was cancelled")); };
    });
  }

  async function ensureNewDefaultResourcePack() {
    if (!window.indexedDB || typeof window.fetch !== "function" || typeof window.DecompressionStream !== "function") return false;
    var markerPath = "resourcepacks/.spawnpoint-new-default-v2";
    var manifestPath = "resourcepacks/manifest.json";
    var database = await openResourcePackDatabase();
    try {
      var rows = await Promise.all([
        readResourcePackRow(database, markerPath),
        readResourcePackRow(database, manifestPath),
      ]);
      var marker = rows[0];
      var manifest;
      try {
        manifest = JSON.parse(resourcePackRowText(rows[1]) || "{}");
      } catch (_error) {
        manifest = {};
      }
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) manifest = {};
      var resourcePacks = Array.isArray(manifest.resourcePacks) ? manifest.resourcePacks : [];
      var hasPack = resourcePacks.some(function (pack) { return pack && pack.folder === newDefaultResourcePackName; });
      if (resourcePackRowText(marker) === newDefaultResourcePackVersion && hasPack) return true;

      var response = await window.fetch(newDefaultResourcePackUrl, { cache: "force-cache", credentials: "same-origin" });
      if (!response.ok || !response.body) throw new Error("Could not download New Default V2");
      var decompressed = response.body.pipeThrough(new window.DecompressionStream("gzip"));
      var files = parseResourcePackTar(await new Response(decompressed).arrayBuffer());
      var transaction = database.transaction("filesystem", "readwrite");
      var completed = waitForResourcePackTransaction(transaction);
      var store = transaction.objectStore("filesystem");
      files.forEach(function (file) {
        store.put({ path: "resourcepacks/" + newDefaultResourcePackName + "/" + file.path, data: file.data });
      });
      var encoder = new TextEncoder();
      store.put({
        path: "resourcepacks/" + newDefaultResourcePackName + "/assets/minecraft/optifine/_property_files_index.json",
        data: encoder.encode('{"propertyFiles":[]}').buffer,
      });
      store.put({
        path: "resourcepacks/" + newDefaultResourcePackName + "/assets/minecraft/mcpatcher/cit/potion/_potions_files_index.json",
        data: encoder.encode('{"potionsFiles":[]}').buffer,
      });
      resourcePacks = resourcePacks.filter(function (pack) { return pack && pack.folder !== newDefaultResourcePackName; });
      resourcePacks.unshift({
        folder: newDefaultResourcePackName,
        name: newDefaultResourcePackName,
        timestamp: Date.now(),
        domains: ["minecraft"],
      });
      manifest.resourcePacks = resourcePacks;
      store.put({ path: manifestPath, data: encoder.encode(JSON.stringify(manifest)).buffer });
      store.put({ path: markerPath, data: encoder.encode(newDefaultResourcePackVersion).buffer });
      await completed;
      return true;
    } finally {
      database.close();
    }
  }

  window.createSpawnpointResourcePackManager = function (options) {
    var preference = options.preference === "programmer-art" ? "programmer-art" : "new-default";
    var lastSyncedPreference = preference;
    var syncQueue = Promise.resolve();

    function encodeBase64(value) {
      return typeof window.btoa === "function" ? window.btoa(value) : options.encodeBase64(value);
    }

    function applyPreference(gameSettings) {
      var selected = decodeGameSettingList(gameSettings, "resourcePacks").filter(function (name) {
        return name !== newDefaultResourcePackName;
      });
      if (preference === "new-default") selected.unshift(newDefaultResourcePackName);
      var incompatible = decodeGameSettingList(gameSettings, "incompatibleResourcePacks").filter(function (name) {
        return name !== newDefaultResourcePackName;
      });
      gameSettings = options.setGameSetting(gameSettings, "resourcePacks", JSON.stringify(selected), true);
      return options.setGameSetting(gameSettings, "incompatibleResourcePacks", JSON.stringify(incompatible), true);
    }

    async function prepare() {
      var packReady;
      try {
        packReady = await ensureNewDefaultResourcePack();
      } catch (error) {
        console.warn("Could not prepare New Default V2", error);
        packReady = false;
      }
      if (preference === "new-default" && !packReady) return;
      try {
        var gameSettingsKey = options.storageNamespace + ".g";
        var encoded = window.localStorage.getItem(gameSettingsKey) || options.defaultGameSettings();
        var updated = await transformGameSettings(encoded, applyPreference, options.decodeBase64, encodeBase64);
        if (updated !== null) window.localStorage.setItem(gameSettingsKey, updated);
      } catch (error) {
        console.warn("Could not apply the account resource-pack preference", error);
      }
    }

    async function preferenceFromGameSettings(encoded) {
      var detected = null;
      await transformGameSettings(encoded, function (gameSettings) {
        detected = decodeGameSettingList(gameSettings, "resourcePacks").indexOf(newDefaultResourcePackName) !== -1
          ? "new-default"
          : "programmer-art";
        return gameSettings;
      }, options.decodeBase64, encodeBase64);
      return detected;
    }

    function sync(encoded) {
      if (!options.csrf || typeof window.fetch !== "function" || !encoded) return;
      syncQueue = syncQueue.then(async function () {
        var nextPreference = await preferenceFromGameSettings(encoded);
        if (!nextPreference || nextPreference === lastSyncedPreference) return;
        var response = await window.fetch("/api/account/resource-pack", {
          method: "PUT",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "x-spawnpoint-csrf": options.csrf,
          },
          body: JSON.stringify({ resourcePackPreference: nextPreference }),
        });
        if (!response.ok) throw new Error("The account resource-pack preference was rejected");
        lastSyncedPreference = nextPreference;
      }).catch(function (error) {
        console.warn("Could not sync the resource-pack preference", error);
      });
    }

    return { prepare: prepare, sync: sync };
  };
})();
