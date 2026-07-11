(function () {
  "use strict";
  var query = new URLSearchParams(window.location.search);
  var account = query.get("account") || "player";
  var launchId = query.get("launch") || "";
  var options = window.eaglercraftXOpts || window.eaglercraftXOptsHints;
  var profileEditingLocked = true;
  var storageNamespace = "_spawnpoint_" + account.toLowerCase();

  if (!options || !launchId) {
    document.addEventListener("DOMContentLoaded", function () {
      document.body.innerHTML = "<main style='display:grid;place-items:center;height:100%;background:#111411;color:#d8ddcf;font:14px monospace'>open this client from spawnpoint after logging in</main>";
    });
    return;
  }

  var websocketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  var gateway = websocketProtocol + "//" + window.location.host + "/gateway?launch=" + encodeURIComponent(launchId);

  function decodeBase64(value) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var input = value.replace(/[^A-Za-z0-9+/=]/g, "");
    var output = "";
    for (var index = 0; index < input.length; index += 4) {
      var first = alphabet.indexOf(input.charAt(index));
      var second = alphabet.indexOf(input.charAt(index + 1));
      var third = input.charAt(index + 2) === "=" ? 64 : alphabet.indexOf(input.charAt(index + 2));
      var fourth = input.charAt(index + 3) === "=" ? 64 : alphabet.indexOf(input.charAt(index + 3));
      output += String.fromCharCode((first << 2) | (second >> 4));
      if (third !== 64) output += String.fromCharCode(((second & 15) << 4) | (third >> 2));
      if (fourth !== 64) output += String.fromCharCode(((third & 3) << 6) | fourth);
    }
    return output;
  }

  function encodeBase64(value) {
    var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var output = "";
    for (var index = 0; index < value.length;) {
      var first = value.charCodeAt(index++) & 255;
      var second = index < value.length ? value.charCodeAt(index++) & 255 : -1;
      var third = index < value.length ? value.charCodeAt(index++) & 255 : -1;
      output += alphabet.charAt(first >> 2);
      output += alphabet.charAt(((first & 3) << 4) | (second < 0 ? 0 : second >> 4));
      output += second < 0 ? "=" : alphabet.charAt(((second & 15) << 2) | (third < 0 ? 0 : third >> 6));
      output += third < 0 ? "=" : alphabet.charAt(third & 63);
    }
    return output;
  }

  function forceKoreanGameSettings(encodedGameSettings) {
    var gameSettings = encodedGameSettings
      ? (typeof window.atob === "function" ? window.atob(encodedGameSettings) : decodeBase64(encodedGameSettings))
      : "";
    if (/(^|\n)lang:[^\r\n]*/.test(gameSettings)) {
      gameSettings = gameSettings.replace(/(^|\n)lang:[^\r\n]*/, "$1lang:ko_KR");
    } else {
      if (gameSettings && gameSettings.charAt(gameSettings.length - 1) !== "\n") gameSettings += "\n";
      gameSettings += "lang:ko_KR\n";
    }
    return typeof window.btoa === "function" ? window.btoa(gameSettings) : encodeBase64(gameSettings);
  }

  // This client parses the `lang` launch option but does not apply it when
  // GameSettings is created. Set the same per-account value its language menu
  // writes, while preserving every other Minecraft preference.
  try {
    var gameSettingsKey = storageNamespace + ".g";
    var encodedGameSettings = window.localStorage.getItem(gameSettingsKey);
    window.localStorage.setItem(gameSettingsKey, forceKoreanGameSettings(encodedGameSettings));
  } catch (_error) {
    // Storage can be unavailable in private browsing. Keep the launch hint as
    // a best-effort fallback instead of preventing the client from starting.
  }

  // WASM-GC uses these hooks as its authoritative local-storage adapter when
  // they are present. Supplying them makes the Korean setting reliable in both
  // the JavaScript and WASM clients instead of depending on their storage glue.
  var existingHooks = options.hooks && typeof options.hooks === "object" ? options.hooks : {};
  var existingLoadHook = typeof existingHooks.localStorageLoaded === "function"
    ? existingHooks.localStorageLoaded
    : null;
  var existingSaveHook = typeof existingHooks.localStorageSaved === "function"
    ? existingHooks.localStorageSaved
    : null;

  function storageKeyForHook(key) {
    return key.indexOf(storageNamespace + ".") === 0 ? key : storageNamespace + "." + key;
  }

  function isGameSettingsKey(key) {
    return key === "g" || key === storageNamespace + ".g";
  }

  existingHooks.localStorageLoaded = function (key) {
    var encoded = null;
    try {
      encoded = existingLoadHook
        ? existingLoadHook.call(this, key)
        : window.localStorage.getItem(storageKeyForHook(key));
      return isGameSettingsKey(key) ? forceKoreanGameSettings(encoded) : encoded;
    } catch (_error) {
      return isGameSettingsKey(key) ? forceKoreanGameSettings(null) : null;
    }
  };

  existingHooks.localStorageSaved = function (key, encoded) {
    var value = isGameSettingsKey(key) ? forceKoreanGameSettings(encoded) : encoded;
    if (existingSaveHook) {
      existingSaveHook.call(this, key, value);
      return;
    }
    try {
      var storageKey = storageKeyForHook(key);
      if (value === null || value === undefined) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, value);
    } catch (_error) {
      // The client can continue without persistence when storage is blocked.
    }
  };
  // WASM-GC u2 casts every optional hook to a function without checking null.
  // Keep its older adapter from crashing when only storage hooks are supplied.
  if (typeof existingHooks.crashReportShow !== "function") existingHooks.crashReportShow = function () {};
  if (typeof existingHooks.screenChanged !== "function") existingHooks.screenChanged = function () {};
  options.hooks = existingHooks;

  // The vendored client has no launch option for disabling its profile editor.
  // Block the main-menu button while the client is outside an active game session;
  // spawnpoint owns the player's name and skin instead.
  if (typeof window.WebSocket === "function" && typeof window.Proxy === "function") {
    window.WebSocket = new window.Proxy(window.WebSocket, {
      construct: function (WebSocketConstructor, args) {
        var socket = new WebSocketConstructor(...args);
        if (String(args[0]).indexOf("/gateway?") !== -1) {
          socket.addEventListener("open", function () { profileEditingLocked = false; });
          socket.addEventListener("close", function () { profileEditingLocked = true; });
        }
        return socket;
      },
    });
  }

  function isEditProfileButton(event) {
    if (!profileEditingLocked || typeof event.clientX !== "number" || typeof event.clientY !== "number") return false;
    var canvas = document.querySelector && document.querySelector("#game_frame canvas, canvas");
    if (!canvas || event.target !== canvas) return false;

    var bounds = canvas.getBoundingClientRect();
    var displayWidth = canvas.width || bounds.width;
    var displayHeight = canvas.height || bounds.height;
    var maxScale = 1;
    while (displayWidth / (maxScale + 1) >= 320 && displayHeight / (maxScale + 1) >= 240) maxScale++;

    for (var scale = 1; scale <= maxScale; scale++) {
      var scaledWidth = Math.ceil(displayWidth / scale);
      var scaledHeight = Math.ceil(displayHeight / scale);
      var x = bounds.left + (Math.floor(scaledWidth / 2) + 2) * scale * bounds.width / displayWidth;
      var y = bounds.top + (Math.floor(scaledHeight / 4) + 132) * scale * bounds.height / displayHeight;
      var width = 98 * scale * bounds.width / displayWidth;
      var height = 20 * scale * bounds.height / displayHeight;
      if (event.clientX >= x && event.clientX < x + width && event.clientY >= y && event.clientY < y + height) return true;
    }
    return false;
  }

  function blockProfileEditor(event) {
    if (!isEditProfileButton(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  if (document.addEventListener) {
    ["pointerdown", "pointerup", "mousedown", "mouseup", "click"].forEach(function (eventName) {
      document.addEventListener(eventName, blockProfileEditor, true);
    });
  }

  options.servers = [{ addr: gateway, name: "spawnpoint", hideAddress: true }];
  options.joinServer = gateway;
  options.relays = [];
  options.checkRelaysForUpdates = false;
  options.localesURI = "/game/lang-v2";
  options.lang = "ko_KR";
  options.autoJump = false;
  options.localStorageNamespace = storageNamespace;
  options.enableDownloadOfflineButton = false;
  options.openDebugConsoleOnLaunch = false;
  options.allowUpdateSvc = false;
  document.title = "spawnpoint, " + account;
  history.replaceState(null, "", window.location.pathname);
})();
