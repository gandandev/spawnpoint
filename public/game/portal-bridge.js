(function () {
  "use strict";
  var query = new URLSearchParams(window.location.search);
  var account = query.get("account") || "player";
  var launchId = query.get("launch") || "";
  var options = window.eaglercraftXOpts || window.eaglercraftXOptsHints;
  var storageNamespace = "_spawnpoint_" + account.toLowerCase();
  var profileDismissTimer = null;
  var autoDismissingProfileEditor = false;

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

  function setGameSetting(gameSettings, key, value, overwrite) {
    var pattern = new RegExp("(^|\\n)" + key + ":[^\\r\\n]*");
    if (pattern.test(gameSettings)) {
      return overwrite ? gameSettings.replace(pattern, "$1" + key + ":" + value) : gameSettings;
    }
    if (gameSettings && gameSettings.charAt(gameSettings.length - 1) !== "\n") gameSettings += "\n";
    return gameSettings + key + ":" + value + "\n";
  }

  function applySpawnpointGameSettings(encodedGameSettings) {
    var gameSettings = encodedGameSettings
      ? (typeof window.atob === "function" ? window.atob(encodedGameSettings) : decodeBase64(encodedGameSettings))
      : "";
    gameSettings = setGameSetting(gameSettings, "lang", "ko_KR", true);
    gameSettings = setGameSetting(gameSettings, "autoJump", "false", false);
    gameSettings = setGameSetting(gameSettings, "fov", "0.5", false);
    gameSettings = setGameSetting(gameSettings, "enableDynamicLights", "true", false);
    gameSettings = setGameSetting(gameSettings, "ao", "2", false);
    gameSettings = setGameSetting(gameSettings, "tutorialStep", "none", true);
    return typeof window.btoa === "function" ? window.btoa(gameSettings) : encodeBase64(gameSettings);
  }

  // Seed Spawnpoint's per-account defaults in the same GameSettings blob the
  // client writes. Existing user choices stay intact, except for the portal's
  // Korean-language contract and its disabled vanilla tutorial.
  try {
    var gameSettingsKey = storageNamespace + ".g";
    var encodedGameSettings = window.localStorage.getItem(gameSettingsKey);
    window.localStorage.setItem(gameSettingsKey, applySpawnpointGameSettings(encodedGameSettings));
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
      return isGameSettingsKey(key) ? applySpawnpointGameSettings(encoded) : encoded;
    } catch (_error) {
      return isGameSettingsKey(key) ? applySpawnpointGameSettings(null) : null;
    }
  };

  existingHooks.localStorageSaved = function (key, encoded) {
    var value = isGameSettingsKey(key) ? applySpawnpointGameSettings(encoded) : encoded;
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
  var existingScreenChangedHook = typeof existingHooks.screenChanged === "function"
    ? existingHooks.screenChanged
    : null;

  function dismissProfileEditor(scaledHeight) {
    if (profileDismissTimer !== null || typeof scaledHeight !== "number" || scaledHeight <= 0) return;
    profileDismissTimer = setTimeout(function () {
      profileDismissTimer = null;
      var canvas = document.querySelector && document.querySelector("#game_frame canvas, canvas");
      if (!canvas || typeof canvas.dispatchEvent !== "function") return;
      var bounds = canvas.getBoundingClientRect();
      var eventInit = {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + ((scaledHeight / 6 + 178) / scaledHeight) * bounds.height,
        button: 0,
        buttons: 1,
        pointerId: 1,
        pointerType: "mouse",
      };
      autoDismissingProfileEditor = true;
      try {
        if (typeof window.PointerEvent === "function") {
          canvas.dispatchEvent(new window.PointerEvent("pointerdown", eventInit));
        }
        canvas.dispatchEvent(new window.MouseEvent("mousedown", eventInit));
        eventInit.buttons = 0;
        if (typeof window.PointerEvent === "function") {
          canvas.dispatchEvent(new window.PointerEvent("pointerup", eventInit));
        }
        canvas.dispatchEvent(new window.MouseEvent("mouseup", eventInit));
        canvas.dispatchEvent(new window.MouseEvent("click", eventInit));
      } finally {
        autoDismissingProfileEditor = false;
      }
    }, 50);
  }

  existingHooks.screenChanged = function (screenName, scaledWidth, scaledHeight, realWidth, realHeight, scaleFactor) {
    if (existingScreenChangedHook) {
      existingScreenChangedHook.call(this, screenName, scaledWidth, scaledHeight, realWidth, realHeight, scaleFactor);
    }
    currentScreenName = typeof screenName === "string" ? screenName : "";
    // Some browser/client combinations process the same physical Escape again
    // after the Exit Chat click. Undo only that immediate duplicate pause.
    if (chatEscapeHandledAt && /GuiIngameMenu$/.test(currentScreenName) && Date.now() - chatEscapeHandledAt < 750) {
      chatEscapeHandledAt = 0;
      setTimeout(function () { dispatchRelayedBackquote(null); }, 0);
    }
    if (typeof scaleFactor === "number" && isFinite(scaleFactor) && scaleFactor > 0) {
      locatorGuiScale = scaleFactor;
    }
    updateLocatorHudLayout();
    updateLocatorHudVisibility();
    updateTPAPickerLayout();
    updateMobileControlsVisibility();
    if (typeof screenName === "string" && /GuiScreenEditProfile$/.test(screenName)) {
      dismissProfileEditor(scaledHeight);
    }
    if (typeof screenName === "string" && /GuiChat$/.test(screenName)) {
      desktopChatInputActive = true;
      chatDraft = Date.now() - lastChatSlashAt < 500 ? "/" : "";
      updateTPAPickerVisibility();
      setTimeout(function () {
        if (desktopChatInputActive) enableClientTextInput(true);
      }, 50);
    } else if (desktopChatInputActive) {
      desktopChatInputActive = false;
      chatDraft = "";
      updateTPAPickerVisibility();
      releaseDesktopChatInput();
    }
  };

  // WASM-GC u2 casts every optional hook to a function without checking null.
  // Keep its older adapter from crashing when only storage hooks are supplied.
  if (typeof existingHooks.crashReportShow !== "function") existingHooks.crashReportShow = function () {};
  options.hooks = existingHooks;

  // The vendored client has no launch option for disabling its profile editor.
  // Block its canvas button permanently and dismiss the screen if another path
  // reaches it. Spawnpoint owns the player's name and skin in every session.

  function isEditProfileButton(event) {
    if (typeof event.clientX !== "number" || typeof event.clientY !== "number") return false;
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
    if (autoDismissingProfileEditor) return;
    if (!isEditProfileButton(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  if (document.addEventListener) {
    var profileBlockEvent = typeof window.PointerEvent === "function" ? "pointerdown" : "mousedown";
    document.addEventListener(profileBlockEvent, blockProfileEditor, true);
  }

  // The WASM runtime already has a hidden input that forwards beforeinput text
  // into Minecraft. Make that input usable on desktop and commit only the final
  // browser-composed string so Korean IME updates do not duplicate syllables.
  var composingInput = null;
  var composedText = "";
  var recentlyCommittedInput = null;
  var recentlyCommittedText = "";
  var imeCommitTimer = null;
  var dispatchingIMECommit = false;
  var desktopChatInputActive = false;
  var currentScreenName = "";
  var pointerLockActive = false;
  var nativeEscapePending = false;
  var chatEscapeHandledAt = 0;
  var locatorGuiScale = 2;
  var locatorRoot = null;
  var locatorMarkerLayer = null;
  var locatorMarkers = Object.create(null);
  var locatorHasTargets = false;
  var locatorRequestPending = false;
  var locatorFailureCount = 0;
  var chatDraft = "";
  var lastChatSlashAt = 0;
  var tpaRoot = null;
  var tpaList = null;
  var tpaPlayers = [];
  var tpaPlayersLoaded = false;
  var tpaRequestPending = false;
  var tpaPickerWasActive = false;
  var mobileTouchCapable = detectMobileTouchCapability();
  var mobileControlsRoot = null;
  var mobileSessionStarted = false;
  var mobileFakePointerLockElement = null;
  var mobileLookTouchId = null;
  var mobileLookStartX = 0;
  var mobileLookStartY = 0;
  var mobileLookPreviousX = 0;
  var mobileLookPreviousY = 0;
  var mobileLookMoved = false;
  var mobileGuiTouchActive = false;
  var mobileHeldKeys = Object.create(null);
  var mobileHeldMouseButtons = Object.create(null);

  function injectLocatorHudStyles() {
    if (!document.createElement || !document.head || document.getElementById("spawnpoint-locator-style")) return;
    var style = document.createElement("style");
    style.id = "spawnpoint-locator-style";
    style.textContent = [
      "#spawnpoint-player-locator{position:fixed;display:none;pointer-events:none;z-index:2147483000;--sp-locator-pixel:2px;--sp-locator-width:364px}",
      "#spawnpoint-player-locator .sp-locator-track{position:absolute;left:50%;top:calc(var(--sp-locator-pixel)*8);width:var(--sp-locator-width);height:calc(var(--sp-locator-pixel)*5);transform:translateX(-50%);background:#050505;box-shadow:0 var(--sp-locator-pixel) 0 rgba(0,0,0,.35);image-rendering:pixelated}",
      "#spawnpoint-player-locator .sp-locator-track:before{content:'';position:absolute;inset:var(--sp-locator-pixel);background:#294b31;border-top:var(--sp-locator-pixel) solid #426f48;box-sizing:border-box}",
      "#spawnpoint-player-locator .sp-locator-track:after{content:'';position:absolute;left:50%;top:var(--sp-locator-pixel);width:var(--sp-locator-pixel);height:calc(var(--sp-locator-pixel)*3);transform:translateX(-50%);background:#8eaa7c}",
      "#spawnpoint-player-locator .sp-locator-markers{position:absolute;inset:0;overflow:visible;z-index:1}",
      "#spawnpoint-player-locator .sp-locator-marker{position:absolute;top:50%;width:calc(var(--sp-locator-pixel)*10);height:calc(var(--sp-locator-pixel)*10);transform:translate(-50%,-50%);transition:left 160ms linear;will-change:left}",
      "#spawnpoint-player-locator .sp-locator-marker.is-behind{opacity:.72}",
      "#spawnpoint-player-locator .sp-locator-marker canvas{display:block;width:100%;height:100%;image-rendering:pixelated}",
    ].join("");
    document.head.appendChild(style);
  }

  function removeLocatorMarker(marker) {
    if (!marker || !marker.element) return;
    if (typeof marker.element.remove === "function") marker.element.remove();
    else if (marker.element.parentNode) marker.element.parentNode.removeChild(marker.element);
  }

  function clearLocatorMarkers() {
    Object.keys(locatorMarkers).forEach(function (id) { removeLocatorMarker(locatorMarkers[id]); });
    locatorMarkers = Object.create(null);
    locatorHasTargets = false;
    updateLocatorHudVisibility();
  }

  function drawLocatorHead(canvas, skinUrl) {
    var context = canvas.getContext && canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, 10, 10);
    context.fillStyle = "#000";
    context.fillRect(0, 0, 10, 10);
    context.fillStyle = "#806349";
    context.fillRect(1, 1, 8, 8);
    if (typeof window.Image !== "function") return;
    var image = new window.Image();
    image.onload = function () {
      var width = image.naturalWidth || image.width || 0;
      var height = image.naturalHeight || image.height || 0;
      if (width < 64 || height < 32) return;
      var textureScale = width / 64;
      context.clearRect(0, 0, 10, 10);
      context.fillStyle = "#000";
      context.fillRect(0, 0, 10, 10);
      context.drawImage(image, 8 * textureScale, 8 * textureScale, 8 * textureScale, 8 * textureScale, 1, 1, 8, 8);
      context.drawImage(image, 40 * textureScale, 8 * textureScale, 8 * textureScale, 8 * textureScale, 1, 1, 8, 8);
    };
    image.src = skinUrl;
  }

  function createLocatorMarker(target) {
    var element = document.createElement("div");
    element.className = "sp-locator-marker";
    var canvas = document.createElement("canvas");
    canvas.width = 10;
    canvas.height = 10;
    element.appendChild(canvas);
    locatorMarkerLayer.appendChild(element);
    drawLocatorHead(canvas, target.skinUrl);
    return { element: element, canvas: canvas, skinUrl: target.skinUrl };
  }

  function updateLocatorMarker(marker, target, index, count) {
    if (marker.skinUrl !== target.skinUrl) {
      marker.skinUrl = target.skinUrl;
      drawLocatorHead(marker.canvas, target.skinUrl);
    }
    var clampedAngle = Math.max(-90, Math.min(90, target.angle));
    marker.element.style.left = (50 + clampedAngle / 1.8) + "%";
    marker.element.style.zIndex = String(count - index);
    marker.element.className = "sp-locator-marker" + (Math.abs(target.angle) > 90 ? " is-behind" : "");
    marker.element.title = target.displayName + " " + Math.round(target.distance) + "m";
  }

  function renderLocatorSnapshot(snapshot) {
    if (!snapshot || snapshot.active !== true || !Array.isArray(snapshot.targets)) {
      clearLocatorMarkers();
      return;
    }
    var validTargets = snapshot.targets.filter(function (target) {
      return target
        && typeof target.id === "string"
        && typeof target.displayName === "string"
        && typeof target.skinUrl === "string"
        && typeof target.angle === "number"
        && isFinite(target.angle)
        && typeof target.distance === "number"
        && isFinite(target.distance);
    });
    var seen = Object.create(null);
    validTargets.forEach(function (target, index) {
      seen[target.id] = true;
      var marker = locatorMarkers[target.id];
      if (!marker) {
        marker = createLocatorMarker(target);
        locatorMarkers[target.id] = marker;
      }
      updateLocatorMarker(marker, target, index, validTargets.length);
    });
    Object.keys(locatorMarkers).forEach(function (id) {
      if (seen[id]) return;
      removeLocatorMarker(locatorMarkers[id]);
      delete locatorMarkers[id];
    });
    locatorHasTargets = validTargets.length > 0;
    updateLocatorHudLayout();
    updateLocatorHudVisibility();
  }

  function locatorScreenIsVisible() {
    return !currentScreenName || /GuiChat$/.test(currentScreenName);
  }

  function updateLocatorHudVisibility() {
    if (!locatorRoot) return;
    locatorRoot.style.display = locatorHasTargets && locatorScreenIsVisible() ? "block" : "none";
  }

  function updateLocatorHudLayout() {
    if (!locatorRoot) return;
    var canvas = document.querySelector && document.querySelector("#game_frame canvas, canvas");
    if (!canvas || typeof canvas.getBoundingClientRect !== "function") {
      locatorRoot.style.display = "none";
      return;
    }
    var bounds = canvas.getBoundingClientRect();
    if (!(bounds.width > 0 && bounds.height > 0)) {
      locatorRoot.style.display = "none";
      return;
    }
    var displayWidth = canvas.width || bounds.width;
    var displayScale = displayWidth > 0 ? bounds.width / displayWidth : 1;
    var pixel = Math.max(1, locatorGuiScale * displayScale);
    var width = Math.min(182 * pixel, Math.max(40 * pixel, bounds.width - 16 * pixel));
    locatorRoot.style.left = bounds.left + "px";
    locatorRoot.style.top = bounds.top + "px";
    locatorRoot.style.width = bounds.width + "px";
    locatorRoot.style.height = bounds.height + "px";
    locatorRoot.style.setProperty("--sp-locator-pixel", pixel + "px");
    locatorRoot.style.setProperty("--sp-locator-width", width + "px");
  }

  function pollLocatorHud() {
    if (locatorRequestPending || typeof window.fetch !== "function") return;
    locatorRequestPending = true;
    window.fetch("/api/game/locator", { credentials: "same-origin", cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("locator unavailable");
        return response.json();
      })
      .then(function (snapshot) {
        locatorRequestPending = false;
        locatorFailureCount = 0;
        renderLocatorSnapshot(snapshot);
      }, function () {
        locatorRequestPending = false;
        locatorFailureCount++;
        if (locatorFailureCount >= 3) clearLocatorMarkers();
      });
  }

  function installLocatorHud() {
    if (locatorRoot || !document.createElement || !document.body) return;
    injectLocatorHudStyles();
    locatorRoot = document.createElement("div");
    locatorRoot.id = "spawnpoint-player-locator";
    locatorRoot.setAttribute("aria-hidden", "true");
    var track = document.createElement("div");
    track.className = "sp-locator-track";
    locatorMarkerLayer = document.createElement("div");
    locatorMarkerLayer.className = "sp-locator-markers";
    track.appendChild(locatorMarkerLayer);
    locatorRoot.appendChild(track);
    document.body.appendChild(locatorRoot);
    updateLocatorHudLayout();
    pollLocatorHud();
    if (typeof window.setInterval === "function") window.setInterval(pollLocatorHud, 200);
  }

  function injectTPAPickerStyles() {
    if (!document.createElement || !document.head || document.getElementById("spawnpoint-tpa-style")) return;
    var style = document.createElement("style");
    style.id = "spawnpoint-tpa-style";
    style.textContent = [
      "#spawnpoint-tpa-picker{position:fixed;display:none;align-items:flex-end;box-sizing:border-box;padding:0 max(10px,env(safe-area-inset-right)) max(42px,calc(env(safe-area-inset-bottom) + 10px)) max(10px,env(safe-area-inset-left));pointer-events:none;z-index:2147483100;font:14px/1.2 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}",
      "#spawnpoint-tpa-picker .sp-tpa-list{display:flex;max-width:100%;gap:6px;padding:7px;overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;pointer-events:auto;background:rgba(0,0,0,.76);border:1px solid rgba(255,255,255,.28);box-shadow:0 2px 0 rgba(0,0,0,.45)}",
      "#spawnpoint-tpa-picker button{flex:0 0 auto;min-height:44px;padding:8px 12px;touch-action:manipulation;color:#fff;background:#315d35;border:1px solid #79a86f;border-radius:0;font:inherit;font-weight:700;cursor:pointer}",
      "#spawnpoint-tpa-picker button:hover,#spawnpoint-tpa-picker button:focus-visible{background:#427949;outline:2px solid #fff;outline-offset:1px}",
      "#spawnpoint-tpa-picker .sp-tpa-empty{padding:6px 9px;color:#ddd;white-space:nowrap}",
    ].join("");
    document.head.appendChild(style);
  }

  function tpaDraftIsActive() {
    return desktopChatInputActive && /^\/tpa\s*$/i.test(chatDraft);
  }

  function updateTPAPickerLayout() {
    if (!tpaRoot) return;
    var canvas = document.querySelector && document.querySelector("#game_frame canvas, canvas");
    if (!canvas || typeof canvas.getBoundingClientRect !== "function") return;
    var bounds = canvas.getBoundingClientRect();
    tpaRoot.style.left = bounds.left + "px";
    tpaRoot.style.top = bounds.top + "px";
    tpaRoot.style.width = bounds.width + "px";
    tpaRoot.style.height = bounds.height + "px";
  }

  function dispatchClientText(text, input) {
    if (!text || !input || typeof input.dispatchEvent !== "function" || typeof window.InputEvent !== "function") return false;
    dispatchingIMECommit = true;
    try {
      input.dispatchEvent(new window.InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: "insertText",
      }));
      return true;
    } finally {
      dispatchingIMECommit = false;
    }
  }

  function sendTPAToPlayer(gameUsername) {
    if (!/^[A-Za-z0-9_]{1,32}$/.test(gameUsername)) return;
    var input = document.querySelector && document.querySelector("._eaglercraftX_text_input_element");
    if (!input) return;
    if (typeof input.focus === "function") input.focus({ preventScroll: true });
    chatDraft += " " + gameUsername;
    updateTPAPickerVisibility();
    setTimeout(function () {
      if (!dispatchClientText(" " + gameUsername, input)) return;
      setTimeout(function () {
        if (typeof input.blur === "function") input.blur();
        dispatchMinecraftKey("Enter", "Enter", 13);
        chatDraft = "";
      }, 20);
    }, 20);
  }

  function renderTPAPlayers() {
    if (!tpaList) return;
    while (tpaList.firstChild) tpaList.removeChild(tpaList.firstChild);
    if (!tpaPlayers.length) {
      var empty = document.createElement("span");
      empty.className = "sp-tpa-empty";
      empty.textContent = "접속 중인 다른 플레이어가 없어요.";
      tpaList.appendChild(empty);
      return;
    }
    tpaPlayers.forEach(function (player) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = player.displayName;
      button.title = "/tpa " + player.gameUsername;
      button.onmousedown = function (event) { event.preventDefault(); };
      button.onclick = function (event) {
        event.preventDefault();
        sendTPAToPlayer(player.gameUsername);
      };
      tpaList.appendChild(button);
    });
  }

  function fetchTPAPlayers() {
    if (tpaRequestPending || typeof window.fetch !== "function") return;
    tpaRequestPending = true;
    window.fetch("/api/game/players", { credentials: "same-origin", cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("players unavailable");
        return response.json();
      })
      .then(function (snapshot) {
        tpaRequestPending = false;
        tpaPlayersLoaded = true;
        tpaPlayers = snapshot && Array.isArray(snapshot.players) ? snapshot.players.filter(function (player) {
          return player
            && typeof player.gameUsername === "string"
            && /^[A-Za-z0-9_]{1,32}$/.test(player.gameUsername)
            && typeof player.displayName === "string";
        }) : [];
        renderTPAPlayers();
        updateTPAPickerVisibility();
      }, function () {
        tpaRequestPending = false;
      });
  }

  function updateTPAPickerVisibility() {
    if (!tpaRoot) return;
    var visible = tpaDraftIsActive();
    tpaRoot.style.display = visible ? "flex" : "none";
    if (visible && !tpaPickerWasActive) tpaPlayersLoaded = false;
    tpaPickerWasActive = visible;
    if (visible && !tpaPlayersLoaded) fetchTPAPlayers();
  }

  function installTPAPicker() {
    if (tpaRoot || !document.createElement || !document.body) return;
    injectTPAPickerStyles();
    tpaRoot = document.createElement("div");
    tpaRoot.id = "spawnpoint-tpa-picker";
    tpaList = document.createElement("div");
    tpaList.className = "sp-tpa-list";
    tpaRoot.appendChild(tpaList);
    document.body.appendChild(tpaRoot);
    updateTPAPickerLayout();
  }

  function trackChatDraftKey(event) {
    if (!event || event.type !== "keydown" || event.repeat) return;
    var key = typeof event.key === "string" ? event.key : "";
    if (!desktopChatInputActive) {
      if (key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) lastChatSlashAt = Date.now();
      return;
    }
    if (event.isComposing || event.keyCode === 229 || event.which === 229 || composingInput) return;
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) chatDraft += key;
    else if (key === "Backspace") chatDraft = chatDraft.slice(0, -1);
    updateTPAPickerVisibility();
  }

  function hasClass(element, className) {
    return !!element && !!element.classList && element.classList.contains(className);
  }

  function isClientTextInput(element) {
    return hasClass(element, "_eaglercraftX_text_input_element");
  }

  function configureClientTextInput(input) {
    if (!input || input.__spawnpointIMEConfigured) return;
    input.__spawnpointIMEConfigured = true;
    input.type = "text";
    input.lang = "ko-KR";
    input.inputMode = "text";
    input.autocapitalize = "off";
    input.spellcheck = false;
  }

  function findClientTextInput() {
    return document.querySelector && document.querySelector("input._eaglercraftX_text_input_element");
  }

  function enableClientTextInput(forceOpen) {
    var zone = document.querySelector && document.querySelector("._eaglercraftX_keyboard_open_zone");
    if (!zone) return;
    var focusRequested = forceOpen === true || desktopChatInputActive;
    var input = findClientTextInput();
    if (input) {
      configureClientTextInput(input);
      if (focusRequested) {
        if (document.activeElement !== input && typeof input.focus === "function") input.focus();
      } else if (document.activeElement === input && typeof input.blur === "function") {
        input.blur();
      }
      return;
    }
    if (!focusRequested && zone.style && zone.style.display === "none") return;
    if (typeof zone.dispatchEvent !== "function") return;
    var TouchEventConstructor = typeof window.Event === "function" ? window.Event : null;
    if (TouchEventConstructor) zone.dispatchEvent(new TouchEventConstructor("touchend", { bubbles: true, cancelable: true }));
    input = findClientTextInput();
    if (input) {
      configureClientTextInput(input);
      if (focusRequested && document.activeElement !== input && typeof input.focus === "function") input.focus();
    }
  }

  function releaseDesktopChatInput() {
    var input = findClientTextInput();
    if (input && document.activeElement === input && typeof input.blur === "function") input.blur();
  }

  function dispatchMinecraftKey(key, code, keyCode) {
    var canvas = document.querySelector && document.querySelector("#game_frame canvas, canvas");
    if (!canvas || typeof canvas.dispatchEvent !== "function" || typeof window.KeyboardEvent !== "function") return;
    if (typeof canvas.focus === "function") canvas.focus();
    setTimeout(function () {
      var init = {
        key: key,
        code: code,
        keyCode: keyCode,
        which: keyCode,
        charCode: keyCode,
        bubbles: true,
        cancelable: true,
      };
      canvas.dispatchEvent(new window.KeyboardEvent("keydown", init));
      canvas.dispatchEvent(new window.KeyboardEvent("keyup", init));
    }, 0);
  }

  function detectMobileTouchCapability() {
    var navigatorObject = window.navigator || {};
    var userAgent = typeof navigatorObject.userAgent === "string" ? navigatorObject.userAgent : "";
    if (/android|iphone|ipad|ipod|mobi|tablet/i.test(userAgent)) return true;
    // iPadOS can report a desktop Macintosh UA. Do not use maxTouchPoints by
    // itself because that would replace native pointer lock on hybrid laptops.
    if (/macintosh/i.test(userAgent) && typeof navigatorObject.maxTouchPoints === "number" && navigatorObject.maxTouchPoints > 1) return true;
    try {
      return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    } catch (_error) {
      return false;
    }
  }

  function findMinecraftCanvas() {
    return document.querySelector && document.querySelector("#game_frame canvas, canvas");
  }

  function mobileGameplayIsActive() {
    return mobileSessionStarted && !currentScreenName;
  }

  function dispatchMobileKeyboardState(key, code, keyCode, pressed) {
    var canvas = findMinecraftCanvas();
    if (!canvas || typeof canvas.dispatchEvent !== "function" || typeof window.KeyboardEvent !== "function") return;
    if (typeof canvas.focus === "function") canvas.focus();
    var event = new window.KeyboardEvent(pressed ? "keydown" : "keyup", {
      key: key,
      code: code,
      keyCode: keyCode,
      which: keyCode,
      charCode: keyCode,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(event);
  }

  function dispatchMobileKeyPulse(key, code, keyCode) {
    dispatchMobileKeyboardState(key, code, keyCode, true);
    // The client samples pressed keys on its next game tick. A synchronous
    // keydown/keyup pair can disappear between frames on slower phones.
    setTimeout(function () { dispatchMobileKeyboardState(key, code, keyCode, false); }, 90);
  }

  function setMobileKeyState(key, code, keyCode, pressed) {
    if (pressed) {
      if (mobileHeldKeys[code]) return;
      mobileHeldKeys[code] = { key: key, code: code, keyCode: keyCode };
    } else {
      if (!mobileHeldKeys[code]) return;
      delete mobileHeldKeys[code];
    }
    dispatchMobileKeyboardState(key, code, keyCode, pressed);
  }

  function mobileMousePoint(point) {
    var canvas = findMinecraftCanvas();
    if (!canvas || typeof canvas.getBoundingClientRect !== "function") return null;
    var bounds = canvas.getBoundingClientRect();
    return {
      canvas: canvas,
      clientX: point && typeof point.clientX === "number" ? point.clientX : bounds.left + bounds.width / 2,
      clientY: point && typeof point.clientY === "number" ? point.clientY : bounds.top + bounds.height / 2,
      screenX: point && typeof point.screenX === "number" ? point.screenX : 0,
      screenY: point && typeof point.screenY === "number" ? point.screenY : 0,
    };
  }

  function dispatchMobileMouseState(button, pressed, point) {
    var target = mobileMousePoint(point);
    if (!target || typeof window.MouseEvent !== "function") return;
    if (pressed) {
      if (mobileHeldMouseButtons[button]) return;
      mobileHeldMouseButtons[button] = true;
    } else {
      if (!mobileHeldMouseButtons[button]) return;
      delete mobileHeldMouseButtons[button];
    }
    var buttonMask = button === 0 ? 1 : button === 1 ? 4 : 2;
    target.canvas.dispatchEvent(new window.MouseEvent(pressed ? "mousedown" : "mouseup", {
      bubbles: true,
      cancelable: true,
      button: button,
      buttons: pressed ? buttonMask : 0,
      clientX: target.clientX,
      clientY: target.clientY,
      screenX: target.screenX,
      screenY: target.screenY,
    }));
  }

  function dispatchMobileCanvasClick(point) {
    var target = mobileMousePoint(point);
    if (!target || typeof window.MouseEvent !== "function") return;
    ["mousedown", "mouseup", "click"].forEach(function (eventName) {
      target.canvas.dispatchEvent(new window.MouseEvent(eventName, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: eventName === "mousedown" ? 1 : 0,
        clientX: target.clientX,
        clientY: target.clientY,
        screenX: target.screenX,
        screenY: target.screenY,
      }));
    });
  }

  function dispatchMobileMouseMove(point, movementX, movementY, buttons) {
    var target = mobileMousePoint(point);
    if (!target || typeof window.MouseEvent !== "function") return;
    var moveEvent = new window.MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      buttons: buttons || 0,
      clientX: target.clientX,
      clientY: target.clientY,
      screenX: target.screenX,
      screenY: target.screenY,
      movementX: movementX,
      movementY: movementY,
    });
    // Safari and older Chromium builds ignore movement values in the event
    // initializer. The legacy client reads these exact properties for camera
    // rotation, so define them directly when the browser permits it.
    try {
      Object.defineProperty(moveEvent, "movementX", { configurable: true, value: movementX });
      Object.defineProperty(moveEvent, "movementY", { configurable: true, value: movementY });
    } catch (_error) {
      // The constructor values remain available in browsers with read-only properties.
    }
    target.canvas.dispatchEvent(moveEvent);
  }

  function dispatchMobileWheel(direction) {
    var canvas = findMinecraftCanvas();
    if (!canvas || typeof canvas.dispatchEvent !== "function") return;
    var WheelEventConstructor = typeof window.WheelEvent === "function" ? window.WheelEvent : window.MouseEvent;
    if (typeof WheelEventConstructor !== "function") return;
    canvas.dispatchEvent(new WheelEventConstructor("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode: 0,
      deltaY: direction * 100,
      wheelDeltaY: direction * -120,
    }));
  }

  function releaseMobileHeldControls() {
    Object.keys(mobileHeldKeys).forEach(function (code) {
      var held = mobileHeldKeys[code];
      delete mobileHeldKeys[code];
      dispatchMobileKeyboardState(held.key, held.code, held.keyCode, false);
    });
    Object.keys(mobileHeldMouseButtons).forEach(function (button) {
      var numericButton = Number(button);
      delete mobileHeldMouseButtons[button];
      var target = mobileMousePoint(null);
      if (!target || typeof window.MouseEvent !== "function") return;
      target.canvas.dispatchEvent(new window.MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        button: numericButton,
        buttons: 0,
        clientX: target.clientX,
        clientY: target.clientY,
      }));
    });
  }

  function updateMobileControlsVisibility() {
    if (!mobileControlsRoot) return;
    var available = mobileSessionStarted && !!findMinecraftCanvas();
    var gameplay = available && mobileGameplayIsActive();
    mobileControlsRoot.style.display = available ? "block" : "none";
    mobileControlsRoot.className = gameplay ? "is-gameplay" : "is-menu";
    if (!gameplay) releaseMobileHeldControls();
  }

  function dispatchMobilePointerLockChange() {
    if (typeof document.dispatchEvent !== "function" || typeof window.Event !== "function") return;
    document.dispatchEvent(new window.Event("pointerlockchange"));
  }

  function setMobileFakePointerLock(element) {
    mobileFakePointerLockElement = element || null;
    if (element) mobileSessionStarted = true;
    dispatchMobilePointerLockChange();
    updateMobileControlsVisibility();
  }

  function installMobilePointerLockShim() {
    if (!mobileTouchCapable) return;
    function requestMobilePointerLock() {
      setMobileFakePointerLock(this);
    }
    function exitMobilePointerLock() {
      setMobileFakePointerLock(null);
    }
    try {
      Object.defineProperty(document, "pointerLockElement", {
        configurable: true,
        get: function () { return mobileFakePointerLockElement; },
      });
      Object.defineProperty(document, "exitPointerLock", {
        configurable: true,
        value: exitMobilePointerLock,
      });
    } catch (_error) {
      document.exitPointerLock = exitMobilePointerLock;
    }
    var elementPrototype = window.Element && window.Element.prototype;
    if (elementPrototype) {
      try {
        Object.defineProperty(elementPrototype, "requestPointerLock", {
          configurable: true,
          value: requestMobilePointerLock,
        });
      } catch (_error) {
        elementPrototype.requestPointerLock = requestMobilePointerLock;
      }
    }
  }

  function prepareMobileCanvasPointerLock() {
    if (!mobileTouchCapable) return;
    var canvas = findMinecraftCanvas();
    if (!canvas || canvas.__spawnpointMobilePointerLock) return;
    canvas.__spawnpointMobilePointerLock = true;
    var requestMobilePointerLock = function () { setMobileFakePointerLock(canvas); };
    try {
      Object.defineProperty(canvas, "requestPointerLock", {
        configurable: true,
        value: requestMobilePointerLock,
      });
    } catch (_error) {
      canvas.requestPointerLock = requestMobilePointerLock;
    }
  }

  function mobileTouchWithId(touchList, identifier) {
    if (!touchList) return null;
    for (var index = 0; index < touchList.length; index++) {
      if (touchList[index].identifier === identifier) return touchList[index];
    }
    return null;
  }

  function handleMobileCanvasTouchStart(event) {
    var canvas = findMinecraftCanvas();
    if (!mobileSessionStarted || !canvas || event.target !== canvas || mobileLookTouchId !== null) return;
    var touch = event.changedTouches && event.changedTouches[0];
    if (!touch) return;
    mobileLookTouchId = touch.identifier;
    mobileLookStartX = mobileLookPreviousX = touch.clientX;
    mobileLookStartY = mobileLookPreviousY = touch.clientY;
    mobileLookMoved = false;
    mobileGuiTouchActive = !mobileGameplayIsActive();
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (mobileGuiTouchActive) dispatchMobileMouseState(0, true, touch);
  }

  function handleMobileCanvasTouchMove(event) {
    var canvas = findMinecraftCanvas();
    if (!canvas || event.target !== canvas || mobileLookTouchId === null) return;
    var touch = mobileTouchWithId(event.targetTouches || event.touches, mobileLookTouchId);
    if (!touch) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    var movementX = touch.clientX - mobileLookPreviousX;
    var movementY = touch.clientY - mobileLookPreviousY;
    if (Math.abs(touch.clientX - mobileLookStartX) > 4 || Math.abs(touch.clientY - mobileLookStartY) > 4) {
      mobileLookMoved = true;
    }
    dispatchMobileMouseMove(touch, movementX * 1.35, movementY * 1.35, mobileGuiTouchActive ? 1 : 0);
    mobileLookPreviousX = touch.clientX;
    mobileLookPreviousY = touch.clientY;
  }

  function handleMobileCanvasTouchEnd(event) {
    var canvas = findMinecraftCanvas();
    if (!canvas || event.target !== canvas || mobileLookTouchId === null) return;
    var touch = mobileTouchWithId(event.changedTouches, mobileLookTouchId);
    if (!touch) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (mobileGuiTouchActive) {
      dispatchMobileMouseState(0, false, touch);
      if (event.type !== "touchcancel") {
        var target = mobileMousePoint(touch);
        if (target && typeof window.MouseEvent === "function") {
          target.canvas.dispatchEvent(new window.MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            button: 0,
            buttons: 0,
            clientX: target.clientX,
            clientY: target.clientY,
            screenX: target.screenX,
            screenY: target.screenY,
          }));
        }
      }
    } else if (!mobileLookMoved && event.type !== "touchcancel") {
      dispatchMobileCanvasClick(touch);
    }
    mobileLookTouchId = null;
    mobileLookMoved = false;
    mobileGuiTouchActive = false;
  }

  function preventMobileControlDefault(event) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    if (event && typeof event.stopPropagation === "function") event.stopPropagation();
  }

  function setMobileButtonPressed(button, pressed) {
    if (!button) return;
    if (button.classList && typeof button.classList.toggle === "function") button.classList.toggle("is-pressed", pressed);
    button.setAttribute("aria-pressed", pressed ? "true" : "false");
  }

  function createMobileButton(label, accessibleLabel, actionName) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = accessibleLabel;
    button.className = "sp-mobile-button";
    button.setAttribute("aria-label", accessibleLabel);
    button.setAttribute("data-sp-control", actionName);
    button.oncontextmenu = function (event) { preventMobileControlDefault(event); };
    return button;
  }

  function bindMobileHoldButton(button, press, release) {
    var active = false;
    function start(event) {
      preventMobileControlDefault(event);
      if (active) return;
      active = true;
      setMobileButtonPressed(button, true);
      press();
    }
    function end(event) {
      preventMobileControlDefault(event);
      if (!active) return;
      active = false;
      setMobileButtonPressed(button, false);
      release();
    }
    button.ontouchstart = start;
    button.ontouchend = end;
    button.ontouchcancel = end;
    button.onmousedown = start;
    button.onmouseup = end;
    button.onmouseleave = end;
  }

  function bindMobilePulseButton(button, action) {
    var lastTouchAt = 0;
    button.ontouchstart = function (event) {
      preventMobileControlDefault(event);
      lastTouchAt = Date.now();
      setMobileButtonPressed(button, true);
      action();
    };
    button.ontouchend = function (event) {
      preventMobileControlDefault(event);
      setMobileButtonPressed(button, false);
    };
    button.ontouchcancel = button.ontouchend;
    button.onclick = function (event) {
      preventMobileControlDefault(event);
      if (Date.now() - lastTouchAt < 700) return;
      action();
    };
  }

  function dispatchMobileBackAction() {
    if (desktopChatInputActive || /GuiChat$/.test(currentScreenName)) {
      chatEscapeHandledAt = Date.now();
      dismissClientChat();
      var input = findClientTextInput();
      if (input && document.activeElement === input && typeof input.blur === "function") input.blur();
      return;
    }
    dispatchRelayedBackquote(null);
  }

  function appendMobileKeyButton(parent, label, accessibleLabel, actionName, key, code, keyCode) {
    var button = createMobileButton(label, accessibleLabel, actionName);
    bindMobileHoldButton(button, function () {
      setMobileKeyState(key, code, keyCode, true);
    }, function () {
      setMobileKeyState(key, code, keyCode, false);
    });
    parent.appendChild(button);
    return button;
  }

  function injectMobileControlStyles() {
    if (!document.createElement || !document.head || document.getElementById("spawnpoint-mobile-control-style")) return;
    var style = document.createElement("style");
    style.id = "spawnpoint-mobile-control-style";
    style.textContent = [
      "#spawnpoint-mobile-controls{position:fixed;inset:0;display:none;z-index:2147483200;pointer-events:none;--sp-touch:clamp(44px,13dvh,54px);font:700 12px/1 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}",
      "#spawnpoint-mobile-controls .sp-mobile-gameplay,#spawnpoint-mobile-controls .sp-mobile-menu{pointer-events:none}",
      "#spawnpoint-mobile-controls.is-gameplay .sp-mobile-menu,#spawnpoint-mobile-controls.is-menu .sp-mobile-gameplay{display:none}",
      "#spawnpoint-mobile-controls .sp-mobile-toolbar{position:absolute;top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));display:flex;gap:6px}",
      "#spawnpoint-mobile-controls .sp-mobile-menu{position:absolute;top:max(8px,env(safe-area-inset-top));left:50%;display:flex;gap:6px;transform:translateX(-50%)}",
      "#spawnpoint-mobile-controls .sp-mobile-move{position:absolute;left:max(8px,env(safe-area-inset-left));bottom:max(8px,env(safe-area-inset-bottom));display:grid;grid-template:repeat(3,var(--sp-touch))/repeat(3,var(--sp-touch));gap:5px}",
      "#spawnpoint-mobile-controls .sp-mobile-actions{position:absolute;right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));display:grid;grid-template:repeat(2,var(--sp-touch))/repeat(3,var(--sp-touch));gap:5px}",
      "#spawnpoint-mobile-controls .sp-mobile-button{box-sizing:border-box;display:grid;place-items:center;width:var(--sp-touch);height:var(--sp-touch);min-width:44px;min-height:44px;margin:0;padding:4px;pointer-events:auto;touch-action:none;border:1px solid rgba(255,255,255,.72);border-radius:9px;color:#fff;background:rgba(12,17,13,.72);box-shadow:0 2px 0 rgba(0,0,0,.48);font:inherit;text-align:center;text-shadow:0 1px 1px #000;outline:none}",
      "#spawnpoint-mobile-controls .sp-mobile-toolbar .sp-mobile-button,#spawnpoint-mobile-controls .sp-mobile-menu .sp-mobile-button{width:auto;padding-inline:12px}",
      "#spawnpoint-mobile-controls .sp-mobile-button.is-pressed,#spawnpoint-mobile-controls .sp-mobile-button:active{background:rgba(73,119,70,.94);border-color:#d7f0ca;box-shadow:none;transform:translateY(2px)}",
      "#spawnpoint-mobile-controls [data-sp-control=forward]{grid-column:2;grid-row:1}",
      "#spawnpoint-mobile-controls [data-sp-control=left]{grid-column:1;grid-row:2}",
      "#spawnpoint-mobile-controls [data-sp-control=sprint]{grid-column:2;grid-row:2;font-size:10px}",
      "#spawnpoint-mobile-controls [data-sp-control=right]{grid-column:3;grid-row:2}",
      "#spawnpoint-mobile-controls [data-sp-control=back]{grid-column:2;grid-row:3}",
      "#spawnpoint-mobile-controls [data-sp-control=attack]{grid-column:1;grid-row:1}",
      "#spawnpoint-mobile-controls [data-sp-control=jump]{grid-column:2;grid-row:1}",
      "#spawnpoint-mobile-controls [data-sp-control=use]{grid-column:3;grid-row:1}",
      "#spawnpoint-mobile-controls [data-sp-control=hotbar-previous]{grid-column:1;grid-row:2}",
      "#spawnpoint-mobile-controls [data-sp-control=sneak]{grid-column:2;grid-row:2;font-size:10px}",
      "#spawnpoint-mobile-controls [data-sp-control=hotbar-next]{grid-column:3;grid-row:2}",
      "@media (max-height:360px){#spawnpoint-mobile-controls{--sp-touch:44px;font-size:11px}#spawnpoint-mobile-controls .sp-mobile-move,#spawnpoint-mobile-controls .sp-mobile-actions{gap:4px}}",
    ].join("");
    document.head.appendChild(style);
  }

  function installMobileControls() {
    if (!mobileTouchCapable || !document.createElement || !document.body) return;
    injectMobileControlStyles();
    if (mobileControlsRoot) {
      if (mobileControlsRoot.parentNode !== document.body) document.body.appendChild(mobileControlsRoot);
      prepareMobileCanvasPointerLock();
      updateMobileControlsVisibility();
      return;
    }
    mobileControlsRoot = document.createElement("div");
    mobileControlsRoot.id = "spawnpoint-mobile-controls";

    var toolbar = document.createElement("div");
    toolbar.className = "sp-mobile-gameplay sp-mobile-toolbar";
    var menuButton = createMobileButton("메뉴", "게임 메뉴 열기", "menu");
    bindMobilePulseButton(menuButton, function () { dispatchRelayedBackquote(null); });
    toolbar.appendChild(menuButton);
    var chatButton = createMobileButton("채팅", "채팅 열기", "chat");
    bindMobilePulseButton(chatButton, function () { dispatchMobileKeyPulse("t", "KeyT", 84); });
    toolbar.appendChild(chatButton);
    var inventoryButton = createMobileButton("가방", "보관함 열기", "inventory");
    bindMobilePulseButton(inventoryButton, function () { dispatchMobileKeyPulse("e", "KeyE", 69); });
    toolbar.appendChild(inventoryButton);
    mobileControlsRoot.appendChild(toolbar);

    var move = document.createElement("div");
    move.className = "sp-mobile-gameplay sp-mobile-move";
    appendMobileKeyButton(move, "▲", "앞으로 이동", "forward", "w", "KeyW", 87);
    appendMobileKeyButton(move, "◀", "왼쪽으로 이동", "left", "a", "KeyA", 65);
    appendMobileKeyButton(move, "달리기", "달리기", "sprint", "Control", "ControlLeft", 17);
    appendMobileKeyButton(move, "▶", "오른쪽으로 이동", "right", "d", "KeyD", 68);
    appendMobileKeyButton(move, "▼", "뒤로 이동", "back", "s", "KeyS", 83);
    mobileControlsRoot.appendChild(move);

    var actions = document.createElement("div");
    actions.className = "sp-mobile-gameplay sp-mobile-actions";
    var attackButton = createMobileButton("부수기", "공격 또는 부수기", "attack");
    bindMobileHoldButton(attackButton, function () { dispatchMobileMouseState(0, true, null); }, function () { dispatchMobileMouseState(0, false, null); });
    actions.appendChild(attackButton);
    appendMobileKeyButton(actions, "점프", "점프", "jump", " ", "Space", 32);
    var useButton = createMobileButton("놓기", "놓기 또는 사용", "use");
    bindMobileHoldButton(useButton, function () { dispatchMobileMouseState(2, true, null); }, function () { dispatchMobileMouseState(2, false, null); });
    actions.appendChild(useButton);
    var previousButton = createMobileButton("이전", "이전 빠른 선택 칸", "hotbar-previous");
    bindMobilePulseButton(previousButton, function () { dispatchMobileWheel(-1); });
    actions.appendChild(previousButton);
    appendMobileKeyButton(actions, "숙이기", "웅크리기", "sneak", "Shift", "ShiftLeft", 16);
    var nextButton = createMobileButton("다음", "다음 빠른 선택 칸", "hotbar-next");
    bindMobilePulseButton(nextButton, function () { dispatchMobileWheel(1); });
    actions.appendChild(nextButton);
    mobileControlsRoot.appendChild(actions);

    var menu = document.createElement("div");
    menu.className = "sp-mobile-menu";
    var backButton = createMobileButton("뒤로", "이전 화면으로", "menu-back");
    bindMobilePulseButton(backButton, dispatchMobileBackAction);
    menu.appendChild(backButton);
    var keyboardButton = createMobileButton("키보드", "화면 키보드 열기", "keyboard");
    bindMobilePulseButton(keyboardButton, function () { enableClientTextInput(true); });
    menu.appendChild(keyboardButton);
    mobileControlsRoot.appendChild(menu);

    document.body.appendChild(mobileControlsRoot);
    prepareMobileCanvasPointerLock();
    updateMobileControlsVisibility();
  }

  function installMobileTouchSupport() {
    if (!mobileTouchCapable) return;
    installMobilePointerLockShim();
    if (document.addEventListener) {
      document.addEventListener("touchstart", handleMobileCanvasTouchStart, { capture: true, passive: false });
      document.addEventListener("touchmove", handleMobileCanvasTouchMove, { capture: true, passive: false });
      document.addEventListener("touchend", handleMobileCanvasTouchEnd, { capture: true, passive: false });
      document.addEventListener("touchcancel", handleMobileCanvasTouchEnd, { capture: true, passive: false });
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) releaseMobileHeldControls();
      });
    }
    if (typeof window.addEventListener === "function") {
      window.addEventListener("blur", releaseMobileHeldControls);
    }
  }

  function relayClientTextInputKey(event) {
    if (!isClientTextInput(event.target) || event.key !== "Enter") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    chatDraft = "";
    updateTPAPickerVisibility();
    var input = event.target;
    if (typeof input.blur === "function") input.blur();
    dispatchMinecraftKey("Enter", "Enter", 13);
  }

  function isRelayedBackquote(event) {
    return !!event && event.__spawnpointRelayedBackquote === true;
  }

  function isBackquoteEvent(event) {
    return !!event && (event.code === "Backquote" || event.key === "`" || event.keyCode === 192 || event.which === 192);
  }

  function isClientTextKeyboardEvent(event) {
    if (!event) return false;
    if (!isClientTextInput(event.target) && !isClientTextInput(document.activeElement)) return false;
    if (event.isComposing || composingInput || event.keyCode === 229 || event.which === 229) return true;

    var key = typeof event.key === "string" ? event.key : "";
    if (key === "`") return true;
    switch (key) {
    case "Alt":
    case "AltGraph":
    case "CapsLock":
    case "Control":
    case "Convert":
    case "Dead":
    case "HangulMode":
    case "HanjaMode":
    case "JunjaMode":
    case "KanaMode":
    case "KanjiMode":
    case "Meta":
    case "ModeChange":
    case "NonConvert":
    case "Process":
    case "Shift":
    case "Unidentified":
      return true;
    default:
      return false;
    }
  }

  function keyboardRelayTarget(sourceTarget) {
    if (sourceTarget && typeof sourceTarget.dispatchEvent === "function") return sourceTarget;
    var canvas = document.querySelector && document.querySelector("#game_frame canvas, canvas");
    if (canvas && typeof canvas.dispatchEvent === "function") {
      if (typeof canvas.focus === "function") canvas.focus();
      return canvas;
    }
    return document.body && typeof document.body.dispatchEvent === "function" ? document.body : null;
  }

  function dispatchRelayedBackquote(sourceTarget) {
    var target = keyboardRelayTarget(sourceTarget);
    if (!target || typeof window.KeyboardEvent !== "function") return;
    ["keydown", "keypress", "keyup"].forEach(function (eventName) {
      var relayedEvent = new window.KeyboardEvent(eventName, {
        key: "`",
        code: "Backquote",
        keyCode: 192,
        which: 192,
        charCode: eventName === "keypress" ? 96 : 0,
        bubbles: true,
        cancelable: true,
      });
      try {
        Object.defineProperty(relayedEvent, "__spawnpointRelayedBackquote", { value: true });
      } catch (_error) {
        relayedEvent.__spawnpointRelayedBackquote = true;
      }
      target.dispatchEvent(relayedEvent);
    });
  }

  function dismissClientChat() {
    var canvas = document.querySelector && document.querySelector("#game_frame canvas, canvas");
    if (!canvas || typeof canvas.dispatchEvent !== "function" || typeof window.MouseEvent !== "function") return;
    var bounds = canvas.getBoundingClientRect();
    // The 1.12 client draws Exit Chat as a 100x20 control against the canvas's
    // top-right edge. Click its center in CSS pixels, including on 2x displays.
    var clientX = (typeof bounds.right === "number" ? bounds.right : bounds.left + bounds.width) - 50;
    var clientY = bounds.top + 12;
    ["mousedown", "mouseup", "click"].forEach(function (eventName) {
      canvas.dispatchEvent(new window.MouseEvent(eventName, {
        bubbles: true,
        cancelable: true,
        clientX: clientX,
        clientY: clientY,
        button: 0,
        buttons: eventName === "mousedown" ? 1 : 0,
      }));
    });
  }

  function relayNativeEscape(event) {
    trackChatDraftKey(event);
    var isEscape = event.key === "Escape" || event.code === "Escape" || event.keyCode === 27 || event.which === 27;
    if (!isEscape || isRelayedBackquote(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== "keydown" || event.repeat) return;
    if (document.pointerLockElement) nativeEscapePending = true;
    var sourceTarget = event.target;
    if (isClientTextInput(sourceTarget) || desktopChatInputActive) {
      chatEscapeHandledAt = Date.now();
      dismissClientChat();
      if (isClientTextInput(sourceTarget) && document.activeElement === sourceTarget && typeof sourceTarget.blur === "function") {
        sourceTarget.blur();
      }
      return;
    }
    chatEscapeHandledAt = 0;
    dispatchRelayedBackquote(sourceTarget);
  }

  function blockClientBackquote(event) {
    if (isRelayedBackquote(event)) return;
    if (isClientTextInput(event.target)) return;
    if (!isBackquoteEvent(event)) return;
    // The vendored client listens on window capture before document receives
    // the key. Spawnpoint installs this first and keeps the document listener
    // as a fallback, so Backquote is no longer a second pause key.
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function eventCaptureFlag(options) {
    return options === true || !!(options && typeof options === "object" && options.capture);
  }

  function installKeyboardListenerGuard(target) {
    if (!target || target.__spawnpointKeyboardListenerGuarded || typeof target.addEventListener !== "function") return;
    var originalAddEventListener = target.addEventListener;
    var originalRemoveEventListener = typeof target.removeEventListener === "function" ? target.removeEventListener : null;
    var recordsByTarget = typeof window.WeakMap === "function" ? new window.WeakMap() : null;
    if (!recordsByTarget) return;

    function recordsFor(actualTarget) {
      var records = recordsByTarget.get(actualTarget);
      if (!records) {
        records = [];
        recordsByTarget.set(actualTarget, records);
      }
      return records;
    }

    target.addEventListener = function (type, listener, options) {
      var eventName = typeof type === "string" ? type.toLowerCase() : "";
      if ((eventName !== "keydown" && eventName !== "keyup" && eventName !== "keypress") || !listener) {
        return originalAddEventListener.call(this, type, listener, options);
      }
      var capture = eventCaptureFlag(options);
      var records = recordsFor(this);
      var record = null;
      for (var index = 0; index < records.length; index++) {
        var candidate = records[index];
        if (candidate.type === eventName && candidate.listener === listener && candidate.capture === capture) {
          record = candidate;
          break;
        }
      }
      if (!record) {
        record = {
          type: eventName,
          listener: listener,
          capture: capture,
          wrapped: function (event) {
            // The runtime's global keyboard listener cancels every key and then
            // ignores beforeinput events emitted within 10ms. While its real
            // text input is focused, let the browser own text and IME keys so
            // macOS and Windows can compose through beforeinput exactly once.
            if (isClientTextKeyboardEvent(event)) return;
            if (!isRelayedBackquote(event) && !isClientTextInput(event.target) && isBackquoteEvent(event)) {
              event.preventDefault();
              event.stopImmediatePropagation();
              return;
            }
            if (typeof listener === "function") return listener.call(this, event);
            if (listener && typeof listener.handleEvent === "function") return listener.handleEvent.call(listener, event);
          },
        };
        records.push(record);
      }
      return originalAddEventListener.call(this, type, record.wrapped, options);
    };

    if (originalRemoveEventListener) {
      target.removeEventListener = function (type, listener, options) {
        var eventName = typeof type === "string" ? type.toLowerCase() : "";
        var capture = eventCaptureFlag(options);
        var records = recordsByTarget.get(this);
        if (records && listener) {
          for (var index = 0; index < records.length; index++) {
            var record = records[index];
            if (record.type === eventName && record.listener === listener && record.capture === capture) {
              return originalRemoveEventListener.call(this, type, record.wrapped, options);
            }
          }
        }
        return originalRemoveEventListener.call(this, type, listener, options);
      };
    }
    target.__spawnpointKeyboardListenerGuarded = true;
  }

  function findPropertyDescriptor(target, propertyName) {
    var owner = target;
    while (owner) {
      var descriptor = Object.getOwnPropertyDescriptor(owner, propertyName);
      if (descriptor) return descriptor;
      owner = Object.getPrototypeOf(owner);
    }
    return null;
  }

  function installKeyboardPropertyGuard(target, propertyName) {
    if (!target || !Object.defineProperty) return;
    var descriptor = findPropertyDescriptor(target, propertyName);
    if (!descriptor || typeof descriptor.set !== "function") return;
    var originalHandler = typeof descriptor.get === "function" ? descriptor.get.call(target) : null;
    var assignedHandler = typeof originalHandler === "function" ? originalHandler : null;
    var nativeSetter = descriptor.set;
    try {
      Object.defineProperty(target, propertyName, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: function () { return assignedHandler; },
        set: function (handler) {
          assignedHandler = typeof handler === "function" ? handler : null;
          if (!assignedHandler) {
            nativeSetter.call(target, null);
            return;
          }
          var runtimeHandler = assignedHandler;
          nativeSetter.call(target, function (event) {
            if (isClientTextKeyboardEvent(event)) return;
            if (!isRelayedBackquote(event) && !isClientTextInput(event.target) && isBackquoteEvent(event)) {
              event.preventDefault();
              event.stopImmediatePropagation();
              return;
            }
            return runtimeHandler.call(this, event);
          });
        },
      });
      if (assignedHandler) target[propertyName] = assignedHandler;
    } catch (_error) {
      // Some browsers expose a non-configurable event property. The wrapped
      // addEventListener path still guards the runtime in that case.
    }
  }

  function installRuntimeKeyboardGuards() {
    installKeyboardListenerGuard(window);
    installKeyboardListenerGuard(document);
    if (window.EventTarget && window.EventTarget.prototype) installKeyboardListenerGuard(window.EventTarget.prototype);
    ["onkeydown", "onkeypress", "onkeyup"].forEach(function (propertyName) {
      installKeyboardPropertyGuard(window, propertyName);
      installKeyboardPropertyGuard(document, propertyName);
    });
  }

  var backquoteEventNames = ["keydown", "keyup", "keypress"];
  if (typeof window.addEventListener === "function") {
    backquoteEventNames.forEach(function (eventName) {
      window.addEventListener(eventName, blockClientBackquote, true);
      window.addEventListener(eventName, relayNativeEscape, true);
    });
  }

  function handlePointerLockChange() {
    var locked = !!document.pointerLockElement;
    if (locked) {
      pointerLockActive = true;
      nativeEscapePending = false;
      return;
    }
    if (!pointerLockActive) return;
    pointerLockActive = false;
    var nativeEscapeWasDelivered = nativeEscapePending;
    nativeEscapePending = false;
    setTimeout(function () {
      var documentStillFocused = typeof document.hasFocus !== "function" || document.hasFocus();
      if (!nativeEscapeWasDelivered && documentStillFocused && !currentScreenName && !desktopChatInputActive) {
        // While pointer lock is active, browsers may consume Escape completely.
        // Relay the client's real back action once after the pointer is released.
        dispatchRelayedBackquote(null);
      }
    }, 0);
  }

  function clearRecentIMECommit() {
    recentlyCommittedInput = null;
    recentlyCommittedText = "";
    imeCommitTimer = null;
  }

  function finishComposition(event) {
    if (!isClientTextInput(event.target) || composingInput !== event.target) return;
    // The client runtime also observes compositionend in some browser builds.
    // Consume the native commit before forwarding one normalized beforeinput,
    // otherwise Chrome can deliver the completed Korean text twice.
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    var input = composingInput;
    var text = typeof event.data === "string" && event.data ? event.data : composedText;
    composingInput = null;
    composedText = "";
    if (!text) return;
    chatDraft += text;
    updateTPAPickerVisibility();
    recentlyCommittedInput = input;
    recentlyCommittedText = text;
    if (imeCommitTimer !== null) clearTimeout(imeCommitTimer);
    imeCommitTimer = setTimeout(clearRecentIMECommit, 100);
    if (typeof window.InputEvent !== "function" || typeof input.dispatchEvent !== "function") return;
    dispatchingIMECommit = true;
    try {
      input.dispatchEvent(new window.InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: "insertText",
      }));
      input.value = " ";
      if (typeof input.setSelectionRange === "function") input.setSelectionRange(1, 1);
    } finally {
      dispatchingIMECommit = false;
    }
  }

  function interceptIMEBeforeInput(event) {
    if (dispatchingIMECommit || !isClientTextInput(event.target)) return;
    if (composingInput === event.target || event.isComposing || event.inputType === "insertCompositionText") {
      if (typeof event.data === "string") composedText = event.data;
      event.stopImmediatePropagation();
      return;
    }
    if (recentlyCommittedInput === event.target && event.data === recentlyCommittedText) {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearRecentIMECommit();
    }
  }

  function interceptIMEInput(event) {
    if (!isClientTextInput(event.target)) return;
    if (composingInput === event.target || event.isComposing || recentlyCommittedInput === event.target) {
      event.stopImmediatePropagation();
    }
  }

  if (document.addEventListener) {
    document.addEventListener("compositionstart", function (event) {
      if (!isClientTextInput(event.target)) return;
      composingInput = event.target;
      composedText = "";
    }, true);
    document.addEventListener("compositionupdate", function (event) {
      if (composingInput === event.target && typeof event.data === "string") composedText = event.data;
    }, true);
    document.addEventListener("compositionend", finishComposition, true);
    document.addEventListener("beforeinput", interceptIMEBeforeInput, true);
    document.addEventListener("input", interceptIMEInput, true);
    document.addEventListener("keydown", relayClientTextInputKey, true);
    backquoteEventNames.forEach(function (eventName) {
      document.addEventListener(eventName, blockClientBackquote, true);
    });
    document.addEventListener("pointerlockchange", handlePointerLockChange, true);
    document.addEventListener("pointerup", function (event) {
      if (hasClass(event.target, "_eaglercraftX_keyboard_open_zone")) enableClientTextInput();
    }, true);
  }

  installMobileTouchSupport();

  if (typeof window.MutationObserver === "function" && document.documentElement) {
    var imeObserver = new window.MutationObserver(function () {
      enableClientTextInput(false);
      installMobileControls();
      prepareMobileCanvasPointerLock();
      updateMobileControlsVisibility();
    });
    imeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
      childList: true,
      subtree: true,
    });
  }

  // Install this after Spawnpoint's own listeners and before the vendored
  // runtime script. Later keyboard listeners cannot observe Backquote outside
  // the hidden chat input, even when they bypass normal event propagation.
  installRuntimeKeyboardGuards();
  if (document.body) {
    installLocatorHud();
    installTPAPicker();
    installMobileControls();
  } else if (document.addEventListener) {
    document.addEventListener("DOMContentLoaded", function () {
      installLocatorHud();
      installTPAPicker();
      installMobileControls();
    }, { once: true });
  }
  if (typeof window.addEventListener === "function") window.addEventListener("resize", function () {
    updateLocatorHudLayout();
    updateTPAPickerLayout();
    prepareMobileCanvasPointerLock();
    updateMobileControlsVisibility();
  });

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
