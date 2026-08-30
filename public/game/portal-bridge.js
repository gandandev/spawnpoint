(function () {
  "use strict";
  var query = new URLSearchParams(window.location.search);
  var account = query.get("account") || "player";
  var launchId = query.get("launch") || "";
  var options = window.eaglercraftXOpts || window.eaglercraftXOptsHints;
  var hostname = (window.location.hostname || "").toLowerCase().replace(/\.$/, "");
  var siteName = hostname === "예게.서버.한국" || hostname === "xn--o79a769b.xn--hk3b17f.xn--3e0b707e"
    ? "예게.서버.한국"
    : hostname === "베이컨.서버.한국" || hostname === "xn--9k3b21rt2f.xn--hk3b17f.xn--3e0b707e"
      ? "베이컨.서버.한국"
      : "spawnpoint";
  var storageNamespace = "_spawnpoint_" + account.toLowerCase();
  var profileDismissTimer = null;

  if (!options || !launchId) {
    document.addEventListener("DOMContentLoaded", function () {
      document.body.innerHTML = "<main style='display:grid;place-items:center;height:100%;background:#111411;color:#d8ddcf;font:14px monospace'>open this client from " + siteName + " after logging in</main>";
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
    gameSettings = setGameSetting(gameSettings, "lang", "ko_kr", true);
    gameSettings = setGameSetting(gameSettings, "autoJump", "false", false);
    gameSettings = setGameSetting(gameSettings, "fov", "0.5", false);
    gameSettings = setGameSetting(gameSettings, "enableDynamicLights", "true", false);
    gameSettings = setGameSetting(gameSettings, "ao", "2", false);
    gameSettings = setGameSetting(gameSettings, "tutorialStep", "none", true);
    gameSettings = setGameSetting(gameSettings, "acknowledgeDisclaimer", "true", true);
    return typeof window.btoa === "function" ? window.btoa(gameSettings) : encodeBase64(gameSettings);
  }

  // Seed Spawnpoint's per-account defaults in the same GameSettings blob the
  // client writes. Existing user choices stay intact, except for the portal's
  // Korean-language contract, disabled vanilla tutorial, and acknowledged
  // first-run disclaimer.
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
    }, 50);
  }

  function requestPortalMenu() {
    if (window.parent && window.parent !== window && typeof window.parent.postMessage === "function") {
      window.parent.postMessage({ type: "spawnpoint:return-to-menu", launchId: launchId }, window.location.origin);
    } else if (window.location && typeof window.location.replace === "function") {
      window.location.replace("/");
    }
  }

  existingHooks.screenChanged = function (screenName, scaledWidth, scaledHeight, realWidth, realHeight, scaleFactor) {
    if (existingScreenChangedHook) {
      existingScreenChangedHook.call(this, screenName, scaledWidth, scaledHeight, realWidth, realHeight, scaleFactor);
    }
    var previousScreenName = currentScreenName;
    currentScreenName = typeof screenName === "string" ? screenName : "";
    // A single Escape can close a client screen and then reach gameplay again
    // during the same browser key press. Undo only that duplicate pause menu.
    var duplicatePauseMenu = uiEscapeSourceScreen && /GuiIngameMenu$/.test(currentScreenName)
      && !/GuiIngameMenu$/.test(uiEscapeSourceScreen) && Date.now() - uiEscapeHandledAt < 1_000;
    setDesktopGameCursorHidden(!currentScreenName || duplicatePauseMenu);
    if (duplicatePauseMenu) {
      clearUiEscapeSuppression();
      setTimeout(function () { dispatchRelayedBackquote(null); }, 0);
    }
    if (typeof scaleFactor === "number" && isFinite(scaleFactor) && scaleFactor > 0) {
      locatorGuiScale = scaleFactor;
    }
    updateMobileScreenMetrics(scaledWidth, scaledHeight, realWidth, realHeight, scaleFactor);
    updateLocatorHudLayout();
    updateLocatorHudVisibility();
    updateTPAPickerLayout();
    updateMobileControlsVisibility();
    if (typeof screenName === "string" && /GuiScreenEditProfile$/.test(screenName)) {
      // The stock GuiMainMenu button remains the real canvas control. Its
      // native action opens GuiScreenEditProfile, which is the signal to leave
      // the embedded client. Other profile-editor paths still close normally.
      if (/GuiMainMenu$/.test(previousScreenName)) requestPortalMenu();
      else dismissProfileEditor(scaledHeight);
    }
    if (typeof screenName === "string" && /GuiGameOver$/.test(screenName)) {
      releasePointerLockForDeathScreen();
    }
    if (typeof screenName === "string" && /GuiChat$/.test(screenName)) {
      portalChatActive = false;
      desktopChatInputActive = true;
      chatDraft = pendingClientChatValue !== null
        ? pendingClientChatValue
        : Date.now() - lastChatSlashAt < 500 ? "/" : "";
      pendingClientChatValue = null;
      beginChatHistoryNavigation();
      updateTPAPickerVisibility();
      // Keep a native input as a fallback if another client path opens GuiChat.
      showMobileChatComposer(chatDraft, !mobileTouchCapable);
      if (!mobileChatComposer) enableClientTextInput(true);
    } else if (desktopChatInputActive && !portalChatActive) {
      desktopChatInputActive = false;
      pendingClientChatValue = null;
      chatDraft = "";
      updateTPAPickerVisibility();
      hideMobileChatComposer();
      releaseDesktopChatInput();
    }
  };

  // WASM-GC u2 casts every optional hook to a function without checking null.
  // Keep its older adapter from crashing when only storage hooks are supplied.
  if (typeof existingHooks.crashReportShow !== "function") existingHooks.crashReportShow = function () {};
  options.hooks = existingHooks;

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
  var uiEscapeSourceScreen = "";
  var uiEscapeHandledAt = 0;
  var uiEscapeClearTimer = null;
  var locatorGuiScale = 2;
  var locatorRoot = null;
  var locatorMarkerLayer = null;
  var locatorMarkers = Object.create(null);
  var locatorHasTargets = false;
  var locatorRequestPending = false;
  var locatorFailureCount = 0;
  var chatDraft = "";
  var lastChatSlashAt = 0;
  var pendingClientChatValue = null;
  var sentChatHistory = [];
  var sentChatHistoryIndex = 0;
  var sentChatHistoryDraft = "";
  var tpaRoot = null;
  var tpaList = null;
  var tpaPlayers = [];
  var tpaPlayersLoaded = false;
  var tpaRequestPending = false;
  var tpaPickerWasActive = false;
  var mobileTouchCapable = detectMobileTouchCapability();
  var mobileControlsRoot = null;
  var mobileChatComposer = null;
  var mobileChatInput = null;
  var mobileChatStatus = null;
  var mobileChatSendButton = null;
  var mobileChatComposing = false;
  var mobileChatSending = false;
  var portalChatActive = false;
  var clientKeyboardZoneObservedOpen = false;
  var mobileSessionStarted = false;
  var mobileFakePointerLockElement = null;
  var mobileLookTouchId = null;
  var mobileLookStartX = 0;
  var mobileLookStartY = 0;
  var mobileLookPreviousX = 0;
  var mobileLookPreviousY = 0;
  var mobileLookMoved = false;
  var mobileLookFromControl = false;
  var mobileGuiTouchActive = false;
  var mobileLookAttackTimer = null;
  var mobileLookAttackHeld = false;
  var mobileLookAttackPoint = null;
  var mobileHotbarTouchId = null;
  var mobileHotbarSlot = -1;
  var mobileScreenScaledWidth = 0;
  var mobileScreenScaledHeight = 0;
  var mobileScreenRealWidth = 0;
  var mobileScreenRealHeight = 0;
  var mobileScreenScaleFactor = 0;
  var mobileSprintEnabled = false;
  var mobileControlLayoutStorageKey = "spawnpoint_mobile_control_layout_v1";
  var mobileLookSensitivityStorageKey = "spawnpoint_mobile_look_sensitivity";
  var mobileControlLayoutStore = readMobileControlLayoutStore();
  var mobileControlLayout = findMobileControlLayoutForViewport(mobileControlLayoutStore, mobileViewportDimensions());
  var mobileControlScale = mobileControlLayout && isFinite(Number(mobileControlLayout.scale))
    ? clampMobileValue(Number(mobileControlLayout.scale), 0.8, 1.5)
    : 1;
  var mobileLookSensitivity = readMobileLookSensitivity();
  var mobileEditableControls = [];
  var mobileControlEditMode = false;
  var mobileControlsHidden = false;
  var mobileControlGesture = null;
  var mobileControlLayoutDirty = false;
  var mobileControlEditorListenersInstalled = false;
  var mobileScaleDownButton = null;
  var mobileScaleUpButton = null;
  var mobileEditButton = null;
  var mobileHideButton = null;
  var mobileSensitivityInput = null;
  var mobileSensitivityValue = null;
  var mobileForwardSequence = 0;
  var mobileForwardPressed = false;
  var mobileForwardPrimingDown = false;
  var mobileHeldKeys = Object.create(null);
  var mobileHeldMouseButtons = Object.create(null);

  function injectLocatorHudStyles() {
    if (!document.createElement || !document.head || document.getElementById("spawnpoint-locator-style")) return;
    var style = document.createElement("style");
    style.id = "spawnpoint-locator-style";
    style.textContent = [
      "#spawnpoint-player-locator{position:fixed;display:none;pointer-events:none;z-index:2147483000;background:none!important;image-rendering:auto!important;--sp-locator-pixel:2px;--sp-locator-width:364px}",
      "#spawnpoint-player-locator .sp-locator-track{position:absolute;left:50%;top:calc(var(--sp-locator-pixel)*8);width:var(--sp-locator-width);height:calc(var(--sp-locator-pixel)*5);transform:translateX(-50%);background:#050505;box-shadow:0 var(--sp-locator-pixel) 0 rgba(0,0,0,.35);image-rendering:pixelated}",
      "#spawnpoint-player-locator .sp-locator-track:before{content:'';position:absolute;inset:var(--sp-locator-pixel);background:#294b31;border-top:var(--sp-locator-pixel) solid #426f48;box-sizing:border-box}",
      "#spawnpoint-player-locator .sp-locator-track:after{content:'';position:absolute;left:50%;top:var(--sp-locator-pixel);width:var(--sp-locator-pixel);height:calc(var(--sp-locator-pixel)*3);transform:translateX(-50%);background:#8eaa7c}",
      "#spawnpoint-player-locator .sp-locator-markers{position:absolute;inset:0;overflow:visible;z-index:1}",
      "#spawnpoint-player-locator .sp-locator-marker{position:absolute;top:50%;width:calc(var(--sp-locator-pixel)*10);height:calc(var(--sp-locator-pixel)*10);transform:translate(-50%,-50%)}",
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
    if (!document.createElement || !document.body) return;
    injectLocatorHudStyles();
    if (locatorRoot) {
      if (locatorRoot.parentNode !== document.body) {
        document.body.appendChild(locatorRoot);
        updateLocatorHudLayout();
        updateLocatorHudVisibility();
      }
      return;
    }
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
    return desktopChatInputActive && /^\/(?:tpa|티피에이|티피요청|텔포)\s*$/i.test(chatDraft);
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
    if (mobileChatComposerIsVisible() && mobileChatInput) {
      mobileChatInput.value = chatDraft + " " + gameUsername;
      updateMobileChatDraft();
      submitMobileChat();
      return;
    }
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
    if (isMobileChatInput(event.target) || event.__spawnpointMobileChatForwarded === true) return;
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

  function isMobileChatInput(element) {
    return !!mobileChatInput && element === mobileChatInput;
  }

  function mobileChatComposerIsVisible() {
    return !!mobileChatComposer && mobileChatComposer.style.display !== "none";
  }

  function clientKeyboardZoneIsOpen(zone) {
    return !!zone && !!zone.style && zone.style.display !== "none";
  }

  function configureClientTextInput(input) {
    if (!input) return;
    if (input.type !== "text") input.type = "text";
    if (input.lang !== "ko-KR") input.lang = "ko-KR";
    if (input.inputMode !== "text") input.inputMode = "text";
    if (input.autocapitalize !== "off") input.autocapitalize = "off";
    if (input.autocomplete !== "off") input.autocomplete = "off";
    if (input.spellcheck !== false) input.spellcheck = false;
  }

  function findClientTextInput() {
    return document.querySelector && document.querySelector("input._eaglercraftX_text_input_element");
  }

  function enableClientTextInput(forceOpen) {
    var zone = document.querySelector && document.querySelector("._eaglercraftX_keyboard_open_zone");
    if (!zone) return;
    var mobileComposerVisible = mobileChatComposerIsVisible();
    var keyboardZoneOpen = clientKeyboardZoneIsOpen(zone);
    if (keyboardZoneOpen) clientKeyboardZoneObservedOpen = true;
    var focusRequested = !mobileComposerVisible
      && (forceOpen === true || desktopChatInputActive || keyboardZoneOpen);
    var input = findClientTextInput();
    if (input) {
      configureClientTextInput(input);
      if (mobileComposerVisible) {
        if (document.activeElement !== mobileChatInput && typeof mobileChatInput.focus === "function") mobileChatInput.focus();
        return;
      }
      if (focusRequested) {
        if (document.activeElement !== input && typeof input.focus === "function") input.focus();
      } else if (!clientKeyboardZoneObservedOpen && document.activeElement === input && typeof input.blur === "function") {
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
      if (mobileComposerVisible && document.activeElement !== mobileChatInput && typeof mobileChatInput.focus === "function") {
        mobileChatInput.focus();
      } else if (focusRequested && document.activeElement !== input && typeof input.focus === "function") {
        input.focus();
      }
    }
  }

  function releaseDesktopChatInput() {
    var input = findClientTextInput();
    if (input && document.activeElement === input && typeof input.blur === "function") input.blur();
    clientKeyboardZoneObservedOpen = false;
  }

  function dispatchMinecraftKey(key, code, keyCode, preserveFocus) {
    var canvas = document.querySelector && document.querySelector("#game_frame canvas, canvas");
    if (!canvas || typeof canvas.dispatchEvent !== "function" || typeof window.KeyboardEvent !== "function") return;
    if (!preserveFocus && typeof canvas.focus === "function") canvas.focus();
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
      ["keydown", "keyup"].forEach(function (eventName) {
        var event = new window.KeyboardEvent(eventName, init);
        if (preserveFocus) {
          try {
            Object.defineProperty(event, "__spawnpointMobileControl", { value: true });
          } catch (_error) {
            event.__spawnpointMobileControl = true;
          }
        }
        canvas.dispatchEvent(event);
      });
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
    return mobileSessionStarted && !currentScreenName && !portalChatActive;
  }

  function setMobileChatStatus(message, isError) {
    if (!mobileChatStatus) return;
    mobileChatStatus.textContent = message || "";
    mobileChatStatus.style.display = message ? "block" : "none";
    mobileChatStatus.setAttribute("data-error", isError ? "true" : "false");
  }

  function setMobileChatSending(sending) {
    mobileChatSending = sending;
    if (mobileChatInput) mobileChatInput.readOnly = sending;
    if (mobileChatSendButton) mobileChatSendButton.disabled = sending;
  }

  function restorePortalGameFocus() {
    var canvas = findMinecraftCanvas();
    if (!canvas) return;
    if (typeof canvas.focus === "function") canvas.focus();
    if (document.pointerLockElement === canvas) return;
    if (typeof canvas.requestPointerLock !== "function") return;
    try {
      var request = canvas.requestPointerLock();
      if (request && typeof request.catch === "function") request.catch(function () {});
    } catch (_error) {
      // The canvas still keeps keyboard focus if pointer lock is unavailable.
    }
  }

  function setDesktopGameCursorHidden(hidden) {
    if (mobileTouchCapable) return;
    var canvas = findMinecraftCanvas();
    if (canvas && canvas.style) canvas.style.cursor = hidden ? "none" : "";
  }

  function screenClosesToGameplayWithEscape(screenName) {
    return /Gui(?:Chat|IngameMenu|ScreenBook|EditSign|ScreenAdvancements)$/.test(screenName)
      || /\.gui\.inventory\.[^.]+$/.test(screenName);
  }

  function restoreGameplayForUiEscape() {
    if (!screenClosesToGameplayWithEscape(currentScreenName)) return;
    // Pointer lock requests made later from the synthetic Backquote event have
    // no browser user activation. Arc rejects that request, then the client
    // retries after 3.1 seconds. Re-lock during the physical Escape instead.
    setDesktopGameCursorHidden(true);
    restorePortalGameFocus();
  }

  function releasePointerLockForDeathScreen() {
    var canvas = findMinecraftCanvas();
    if (document.pointerLockElement && typeof document.exitPointerLock === "function") {
      try {
        document.exitPointerLock();
      } catch (_error) {
        // The death screen remains usable even if this browser already released it.
      }
    }
    if (canvas && document.activeElement === canvas && typeof canvas.blur === "function") canvas.blur();
  }

  function closePortalChat(restoreFocus) {
    portalChatActive = false;
    desktopChatInputActive = false;
    chatDraft = "";
    updateTPAPickerVisibility();
    hideMobileChatComposer();
    releaseDesktopChatInput();
    updateMobileControlsVisibility();
    if (restoreFocus) restorePortalGameFocus();
  }

  function openClientChat(initialValue, focusInput) {
    if (mobileChatSending || currentScreenName || !findMinecraftCanvas()) return false;
    var value = typeof initialValue === "string" ? initialValue : "";
    pendingClientChatValue = value;
    desktopChatInputActive = true;
    chatDraft = value;
    beginChatHistoryNavigation();
    updateTPAPickerVisibility();
    setMobileChatStatus("", false);
    showMobileChatComposer(chatDraft, focusInput !== false);
    updateMobileControlsVisibility();
    if (value === "/") dispatchMinecraftKey("/", "Slash", 191, true);
    else dispatchMinecraftKey("t", "KeyT", 84, true);
    return true;
  }

  function updateMobileScreenMetrics(scaledWidth, scaledHeight, realWidth, realHeight, scaleFactor) {
    if (typeof scaledWidth === "number" && isFinite(scaledWidth) && scaledWidth > 0) mobileScreenScaledWidth = scaledWidth;
    if (typeof scaledHeight === "number" && isFinite(scaledHeight) && scaledHeight > 0) mobileScreenScaledHeight = scaledHeight;
    if (typeof realWidth === "number" && isFinite(realWidth) && realWidth > 0) mobileScreenRealWidth = realWidth;
    if (typeof realHeight === "number" && isFinite(realHeight) && realHeight > 0) mobileScreenRealHeight = realHeight;
    if (typeof scaleFactor === "number" && isFinite(scaleFactor) && scaleFactor > 0) mobileScreenScaleFactor = scaleFactor;
  }

  function dispatchMobileKeyboardState(key, code, keyCode, pressed) {
    var canvas = findMinecraftCanvas();
    if (!canvas || typeof canvas.dispatchEvent !== "function" || typeof window.KeyboardEvent !== "function") return;
    // Keep the real mobile chat field focused while a delayed pulse releases.
    // Refocusing the canvas on keyup closes the iOS and Android keyboards.
    if (pressed && typeof canvas.focus === "function") canvas.focus();
    var event = new window.KeyboardEvent(pressed ? "keydown" : "keyup", {
      key: key,
      code: code,
      keyCode: keyCode,
      which: keyCode,
      charCode: keyCode,
      bubbles: true,
      cancelable: true,
    });
    try {
      Object.defineProperty(event, "__spawnpointMobileControl", { value: true });
    } catch (_error) {
      event.__spawnpointMobileControl = true;
    }
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

  function cancelMobileForwardPrime() {
    mobileForwardSequence++;
    mobileForwardPressed = false;
    if (!mobileForwardPrimingDown) return;
    mobileForwardPrimingDown = false;
    dispatchMobileKeyboardState("w", "KeyW", 87, false);
  }

  function pressMobileForward() {
    cancelMobileForwardPrime();
    mobileForwardPressed = true;
    if (!mobileSprintEnabled) {
      setMobileKeyState("w", "KeyW", 87, true);
      return;
    }
    var sequence = ++mobileForwardSequence;
    mobileForwardPrimingDown = true;
    dispatchMobileKeyboardState("w", "KeyW", 87, true);
    // Keep both halves longer than one 50ms game tick so the client samples
    // a real release between the two W presses, even on a quick tap.
    setTimeout(function () {
      if (sequence !== mobileForwardSequence) return;
      mobileForwardPrimingDown = false;
      dispatchMobileKeyboardState("w", "KeyW", 87, false);
      setTimeout(function () {
        if (sequence !== mobileForwardSequence) return;
        if (mobileForwardPressed) {
          setMobileKeyState("w", "KeyW", 87, true);
          return;
        }
        mobileForwardPrimingDown = true;
        dispatchMobileKeyboardState("w", "KeyW", 87, true);
        setTimeout(function () {
          if (sequence !== mobileForwardSequence) return;
          mobileForwardPrimingDown = false;
          dispatchMobileKeyboardState("w", "KeyW", 87, false);
        }, 90);
      }, 70);
    }, 70);
  }

  function releaseMobileForward() {
    mobileForwardPressed = false;
    setMobileKeyState("w", "KeyW", 87, false);
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

  function mobileHotbarSlotAt(point) {
    if (!point || !mobileGameplayIsActive()) return -1;
    var canvas = findMinecraftCanvas();
    if (!canvas || typeof canvas.getBoundingClientRect !== "function") return -1;
    var bounds = canvas.getBoundingClientRect();
    var displayWidth = mobileScreenRealWidth || canvas.width || bounds.width;
    var displayHeight = mobileScreenRealHeight || canvas.height || bounds.height;
    var scaleFactor = mobileScreenScaleFactor || locatorGuiScale || 1;
    var scaledWidth = mobileScreenScaledWidth || Math.ceil(displayWidth / scaleFactor);
    var scaledHeight = mobileScreenScaledHeight || Math.ceil(displayHeight / scaleFactor);
    if (!displayWidth || !displayHeight || !bounds.width || !bounds.height) return -1;

    var guiPixelWidth = scaleFactor * bounds.width / displayWidth;
    var guiPixelHeight = scaleFactor * bounds.height / displayHeight;
    var hotbarLeft = bounds.left + (Math.floor(scaledWidth / 2) - 91) * guiPixelWidth;
    var hotbarTop = bounds.top + (scaledHeight - 22) * guiPixelHeight;
    var hotbarHeight = 22 * guiPixelHeight;
    var verticalHitSlop = Math.max(0, (44 - hotbarHeight) / 2);
    var slotLeft = hotbarLeft + guiPixelWidth;
    var slotWidth = 20 * guiPixelWidth;
    var slotAreaWidth = slotWidth * 9;
    if (point.clientX < slotLeft || point.clientX >= slotLeft + slotAreaWidth) return -1;
    if (point.clientY < hotbarTop - verticalHitSlop || point.clientY >= hotbarTop + hotbarHeight + verticalHitSlop) return -1;
    return Math.min(8, Math.floor((point.clientX - slotLeft) / slotWidth));
  }

  function selectMobileHotbarSlot(slot) {
    if (slot < 0 || slot > 8) return;
    var number = slot + 1;
    dispatchMobileKeyPulse(String(number), "Digit" + number, 49 + slot);
  }

  function dispatchMobileMouseState(button, pressed, point) {
    var target = mobileMousePoint(point);
    if (!target || typeof window.MouseEvent !== "function") return false;
    if (pressed) {
      if (mobileHeldMouseButtons[button]) return false;
      mobileHeldMouseButtons[button] = true;
    } else {
      if (!mobileHeldMouseButtons[button]) return false;
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
    return true;
  }

  function clearMobileLookAttack(release, point) {
    if (mobileLookAttackTimer !== null) {
      window.clearTimeout(mobileLookAttackTimer);
      mobileLookAttackTimer = null;
    }
    if (release && mobileLookAttackHeld) dispatchMobileMouseState(0, false, point || mobileLookAttackPoint);
    mobileLookAttackHeld = false;
    mobileLookAttackPoint = null;
  }

  function primeMobileLookAttack(touch) {
    clearMobileLookAttack(true, touch);
    mobileLookAttackPoint = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      screenX: touch.screenX,
      screenY: touch.screenY,
    };
    mobileLookAttackTimer = window.setTimeout(function () {
      mobileLookAttackTimer = null;
      if (mobileLookTouchId === null || mobileLookMoved || mobileGuiTouchActive || !mobileGameplayIsActive()) return;
      mobileLookAttackHeld = dispatchMobileMouseState(0, true, mobileLookAttackPoint);
    }, 180);
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

  function mobileHeldMouseButtonMask() {
    var mask = 0;
    if (mobileHeldMouseButtons[0]) mask |= 1;
    if (mobileHeldMouseButtons[1]) mask |= 4;
    if (mobileHeldMouseButtons[2]) mask |= 2;
    return mask;
  }

  function releaseMobileHeldControls() {
    cancelMobileForwardPrime();
    clearMobileLookAttack(true, null);
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
    mobileHotbarTouchId = null;
    mobileHotbarSlot = -1;
    mobileLookTouchId = null;
    mobileLookMoved = false;
    mobileLookFromControl = false;
    mobileGuiTouchActive = false;
  }

  function updateMobileControlsVisibility() {
    if (!mobileControlsRoot) return;
    var available = mobileSessionStarted && !!findMinecraftCanvas();
    var gameplay = available && mobileGameplayIsActive();
    var chatMode = portalChatActive || desktopChatInputActive || /GuiChat$/.test(currentScreenName) || mobileChatComposerIsVisible();
    if (!gameplay && mobileControlEditMode) finishMobileControlEditing();
    mobileControlsRoot.style.display = available ? "block" : "none";
    mobileControlsRoot.className = (chatMode ? "is-chat" : gameplay ? "is-gameplay" : "is-menu")
      + (mobileControlEditMode ? " is-editing" : "")
      + (mobileControlsHidden ? " are-controls-hidden" : "");
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
    if (!canvas) return;
    // The client writes `touch-action: pan-x pan-y` while creating its canvas.
    // Keep canvas drags inside the game so mobile sliders do not turn into a
    // browser pan and get cancelled halfway through the gesture.
    if (canvas.style && canvas.style.touchAction !== "none") canvas.style.touchAction = "none";
    if (canvas.__spawnpointMobilePointerLock) return;
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

  function mobileLookControlFromTarget(target) {
    if (!mobileControlsRoot || mobileControlEditMode || !mobileGameplayIsActive()) return null;
    var node = target;
    while (node && node !== mobileControlsRoot) {
      var name = mobileControlName(node);
      if (/^(forward|left|sprint|right|drop|back|attack|use|jump|sneak)$/.test(name)) return node;
      if (name) return null;
      node = node.parentNode;
    }
    return null;
  }

  function handleMobileCanvasTouchStart(event) {
    var canvas = findMinecraftCanvas();
    if (!mobileSessionStarted || !canvas || mobileHotbarTouchId !== null) return;
    var fromControl = event.target !== canvas && !!mobileLookControlFromTarget(event.target);
    if (event.target !== canvas && !fromControl) return;
    if (mobileLookTouchId !== null) {
      // A second finger on the canvas keeps the usual move-and-look gesture,
      // even when the first finger is still holding a control button.
      if (event.target !== canvas || !mobileLookFromControl) return;
    }
    var touch = event.changedTouches && event.changedTouches[0];
    if (!touch) return;
    var hotbarSlot = fromControl ? -1 : mobileHotbarSlotAt(touch);
    if (hotbarSlot >= 0) {
      mobileHotbarTouchId = touch.identifier;
      mobileHotbarSlot = hotbarSlot;
      if (typeof event.preventDefault === "function") event.preventDefault();
      return;
    }
    mobileLookTouchId = touch.identifier;
    mobileLookStartX = mobileLookPreviousX = touch.clientX;
    mobileLookStartY = mobileLookPreviousY = touch.clientY;
    mobileLookMoved = false;
    mobileLookFromControl = fromControl;
    mobileGuiTouchActive = !fromControl && !mobileGameplayIsActive();
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (fromControl) return;
    if (mobileGuiTouchActive) dispatchMobileMouseState(0, true, touch);
    else primeMobileLookAttack(touch);
  }

  function handleMobileCanvasTouchMove(event) {
    var canvas = findMinecraftCanvas();
    if (!canvas || (!mobileLookFromControl && event.target !== canvas)) return;
    if (mobileHotbarTouchId !== null) {
      var hotbarTouch = mobileTouchWithId(event.targetTouches || event.touches, mobileHotbarTouchId);
      if (!hotbarTouch) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      mobileHotbarSlot = mobileHotbarSlotAt(hotbarTouch);
      return;
    }
    if (mobileLookTouchId === null) return;
    var touch = mobileTouchWithId(event.targetTouches || event.touches, mobileLookTouchId);
    if (!touch) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    var movementX = touch.clientX - mobileLookPreviousX;
    var movementY = touch.clientY - mobileLookPreviousY;
    if (Math.abs(touch.clientX - mobileLookStartX) > 12 || Math.abs(touch.clientY - mobileLookStartY) > 12) {
      mobileLookMoved = true;
      if (!mobileLookAttackHeld) clearMobileLookAttack(false, touch);
    }
    dispatchMobileMouseMove(
      touch,
      movementX * mobileLookSensitivity,
      movementY * mobileLookSensitivity,
      mobileGuiTouchActive ? 1 : mobileHeldMouseButtonMask()
    );
    mobileLookPreviousX = touch.clientX;
    mobileLookPreviousY = touch.clientY;
  }

  function handleMobileCanvasTouchEnd(event) {
    var canvas = findMinecraftCanvas();
    if (!canvas || (!mobileLookFromControl && event.target !== canvas)) return;
    if (mobileHotbarTouchId !== null) {
      var hotbarTouch = mobileTouchWithId(event.changedTouches, mobileHotbarTouchId);
      if (!hotbarTouch) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      mobileHotbarSlot = mobileHotbarSlotAt(hotbarTouch);
      if (event.type !== "touchcancel") selectMobileHotbarSlot(mobileHotbarSlot);
      mobileHotbarTouchId = null;
      mobileHotbarSlot = -1;
      return;
    }
    if (mobileLookTouchId === null) return;
    var touch = mobileTouchWithId(event.changedTouches, mobileLookTouchId);
    if (!touch) return;
    if (typeof event.preventDefault === "function") event.preventDefault();
    if (mobileLookFromControl) {
      // The button's own touchend handler releases its key or mouse button.
      // This path only owns the camera gesture.
    } else if (mobileGuiTouchActive) {
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
      if (mobileLookAttackHeld) clearMobileLookAttack(true, touch);
      else {
        clearMobileLookAttack(false, touch);
        dispatchMobileCanvasClick(touch);
      }
    } else {
      clearMobileLookAttack(true, touch);
    }
    mobileLookTouchId = null;
    mobileLookMoved = false;
    mobileLookFromControl = false;
    mobileGuiTouchActive = false;
  }

  function preventMobileControlDefault(event) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    if (event && typeof event.stopPropagation === "function") event.stopPropagation();
  }

  function setMobileButtonPressed(button, pressed) {
    if (!button) return;
    if (button.classList && typeof button.classList.toggle === "function") button.classList.toggle("is-pressed", pressed);
  }

  function setMobileToggleState(button, enabled) {
    if (!button) return;
    if (button.classList && typeof button.classList.toggle === "function") button.classList.toggle("is-toggled", enabled);
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
  }

  function clampMobileValue(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function mobileControlProfileMatchesViewport(profile, viewport) {
    var width = Number(profile && profile.width);
    var height = Number(profile && profile.height);
    if (!isFinite(width) || width <= 0 || !isFinite(height) || height <= 0) return false;
    if ((width >= height) !== (viewport.width >= viewport.height)) return false;
    var widthChange = Math.abs(viewport.width - width) / width;
    var heightChange = Math.abs(viewport.height - height) / height;
    var aspect = width / height;
    var aspectChange = Math.abs(viewport.width / viewport.height - aspect) / aspect;
    // Browser chrome and small viewport changes reuse and scale one layout.
    // Rotation, tablets, and other materially different screens get a profile.
    return Math.max(widthChange, heightChange) < 0.25 && aspectChange < 0.18;
  }

  function findMobileControlLayoutForViewport(store, viewport) {
    if (!store || !Array.isArray(store.profiles)) return null;
    var match = null;
    var bestScore = Infinity;
    store.profiles.forEach(function (profile) {
      if (!mobileControlProfileMatchesViewport(profile, viewport)) return;
      var width = Number(profile.width);
      var height = Number(profile.height);
      var score = Math.abs(viewport.width - width) / width + Math.abs(viewport.height - height) / height;
      if (score < bestScore) {
        match = profile;
        bestScore = score;
      }
    });
    return match;
  }

  function readMobileControlLayoutStore() {
    try {
      var savedLayout = JSON.parse(window.localStorage.getItem(mobileControlLayoutStorageKey) || "null");
      if (savedLayout && savedLayout.version === 2 && Array.isArray(savedLayout.profiles)) {
        return { version: 2, profiles: savedLayout.profiles };
      }
      if (savedLayout && savedLayout.version === 1 && savedLayout.controls && typeof savedLayout.controls === "object") {
        var viewport = mobileViewportDimensions();
        return {
          version: 2,
          profiles: [{ width: viewport.width, height: viewport.height, scale: 1, controls: savedLayout.controls }],
        };
      }
    } catch (_error) {
      // Start from the default layout when stored JSON is invalid.
    }
    return { version: 2, profiles: [] };
  }

  function readMobileLookSensitivity() {
    try {
      var savedSensitivity = Number(window.localStorage.getItem(mobileLookSensitivityStorageKey));
      return isFinite(savedSensitivity) && savedSensitivity >= 0.5 && savedSensitivity <= 4.05 ? savedSensitivity : 1.35;
    } catch (_error) {
      return 1.35;
    }
  }

  function mobileViewportDimensions() {
    // Use the layout viewport here. visualViewport shrinks for the software
    // keyboard and must not select a different control profile.
    var width = window.innerWidth;
    var height = window.innerHeight;
    if (!isFinite(width) || width <= 0) width = document.documentElement && document.documentElement.clientWidth;
    if (!isFinite(height) || height <= 0) height = document.documentElement && document.documentElement.clientHeight;
    return {
      width: isFinite(width) && width > 0 ? width : 390,
      height: isFinite(height) && height > 0 ? height : 844,
    };
  }

  function mobileControlName(button) {
    if (!button) return "";
    if (typeof button.getAttribute === "function") return button.getAttribute("data-sp-control") || "";
    return button["data-sp-control"] || "";
  }

  function mobileControlIsEditable(button) {
    return mobileEditableControls.indexOf(button) !== -1;
  }

  function mobileControlRect(button) {
    if (button && typeof button.getBoundingClientRect === "function") {
      var bounds = button.getBoundingClientRect();
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
      }
    }
    var style = button && button.style ? button.style : {};
    return {
      left: Number.parseFloat(style.left) || 0,
      top: Number.parseFloat(style.top) || 0,
      width: Number.parseFloat(style.width) || 44,
      height: Number.parseFloat(style.height) || 44,
    };
  }

  function clearMobileControlInlineLayout() {
    mobileEditableControls.forEach(function (button) {
      if (!button || !button.style) return;
      button.style.position = "";
      button.style.left = "";
      button.style.top = "";
      button.style.right = "";
      button.style.bottom = "";
      button.style.width = "";
      button.style.height = "";
      button.style.zIndex = "";
      button.setAttribute("data-sp-custom-position", "false");
    });
    if (mobileControlsRoot) mobileControlsRoot.setAttribute("data-sp-custom-layout", "false");
  }

  function setMobileControlFixedRect(button, left, top, width, height) {
    if (!button || !button.style) return;
    var viewport = mobileViewportDimensions();
    width = clampMobileValue(width, 35, Math.max(35, viewport.width - 8));
    height = clampMobileValue(height, 35, Math.max(35, viewport.height - 8));
    left = clampMobileValue(left, 4, Math.max(4, viewport.width - width - 4));
    top = clampMobileValue(top, 4, Math.max(4, viewport.height - height - 4));
    button.style.position = "fixed";
    button.style.left = Math.round(left) + "px";
    button.style.top = Math.round(top) + "px";
    button.style.right = "auto";
    button.style.bottom = "auto";
    button.style.width = Math.round(width) + "px";
    button.style.height = Math.round(height) + "px";
    button.style.zIndex = "2";
    button.setAttribute("data-sp-custom-position", "true");
    if (mobileControlsRoot) mobileControlsRoot.setAttribute("data-sp-custom-layout", "true");
  }

  function mobileControlLayoutIsDefault() {
    return !mobileControlLayoutDirty
      && (!mobileControlLayout || !mobileControlLayout.controls || typeof mobileControlLayout.controls !== "object");
  }

  function mobileControlViewportScale(profile, viewport) {
    var width = Number(profile && profile.width);
    var height = Number(profile && profile.height);
    if (!isFinite(width) || width <= 0 || !isFinite(height) || height <= 0) return 1;
    return clampMobileValue(Math.min(viewport.width / width, viewport.height / height), 0.65, 1.75);
  }

  function applyMobileControlScale() {
    if (!mobileControlsRoot || !mobileControlsRoot.style) return;
    var viewport = mobileViewportDimensions();
    var baseSize = clampMobileValue(viewport.height * 0.13, 44, 54);
    var touchSize = clampMobileValue(baseSize * mobileControlScale, 35, 81);
    touchSize = Math.round(touchSize * 10) / 10;
    mobileControlsRoot.style.setProperty("--sp-touch", touchSize + "px");
    mobileControlsRoot.setAttribute("data-sp-control-scale", String(mobileControlScale));
  }

  function updateMobileDefaultLayoutState() {
    var isDefault = mobileControlLayoutIsDefault();
    if (mobileControlsRoot) mobileControlsRoot.setAttribute("data-sp-default-layout", isDefault ? "true" : "false");
    if (mobileScaleDownButton) mobileScaleDownButton.disabled = !isDefault || mobileControlScale <= 0.8;
    if (mobileScaleUpButton) mobileScaleUpButton.disabled = !isDefault || mobileControlScale >= 1.5;
  }

  function persistMobileControlLayoutStore() {
    try {
      if (mobileControlLayoutStore.profiles.length) {
        window.localStorage.setItem(mobileControlLayoutStorageKey, JSON.stringify(mobileControlLayoutStore));
      } else {
        window.localStorage.removeItem(mobileControlLayoutStorageKey);
      }
    } catch (_error) {
      // The current session still keeps every active profile when storage is blocked.
    }
  }

  function ensureMobileControlLayoutProfile() {
    if (mobileControlLayout && mobileControlLayoutStore.profiles.indexOf(mobileControlLayout) !== -1) {
      return mobileControlLayout;
    }
    mobileControlLayout = {};
    mobileControlLayoutStore.profiles.push(mobileControlLayout);
    return mobileControlLayout;
  }

  function removeActiveMobileControlLayoutProfile() {
    var index = mobileControlLayoutStore.profiles.indexOf(mobileControlLayout);
    if (index !== -1) mobileControlLayoutStore.profiles.splice(index, 1);
    mobileControlLayout = null;
  }

  function applyMobileControlLayout() {
    applyMobileControlScale();
    if (mobileControlLayoutIsDefault()) {
      updateMobileDefaultLayoutState();
      return;
    }
    var viewport = mobileViewportDimensions();
    var viewportScale = mobileControlViewportScale(mobileControlLayout, viewport);
    mobileEditableControls.forEach(function (button) {
      var item = mobileControlLayout.controls[mobileControlName(button)];
      if (!item) return;
      var width = Number(item.width) * viewportScale;
      var height = Number(item.height) * viewportScale;
      var x = Number(item.x);
      var y = Number(item.y);
      if (![width, height, x, y].every(function (value) { return isFinite(value); })) return;
      width = clampMobileValue(width, 35, Math.max(35, viewport.width - 8));
      height = clampMobileValue(height, 35, Math.max(35, viewport.height - 8));
      setMobileControlFixedRect(
        button,
        clampMobileValue(x, 0, 1) * Math.max(0, viewport.width - width),
        clampMobileValue(y, 0, 1) * Math.max(0, viewport.height - height),
        width,
        height
      );
    });
    updateMobileDefaultLayoutState();
  }

  function saveMobileControlLayout() {
    var viewport = mobileViewportDimensions();
    var controls = {};
    mobileEditableControls.forEach(function (button) {
      var name = mobileControlName(button);
      if (!name) return;
      var bounds = mobileControlRect(button);
      controls[name] = {
        x: clampMobileValue(bounds.left / Math.max(1, viewport.width - bounds.width), 0, 1),
        y: clampMobileValue(bounds.top / Math.max(1, viewport.height - bounds.height), 0, 1),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      };
    });
    var profile = ensureMobileControlLayoutProfile();
    profile.width = viewport.width;
    profile.height = viewport.height;
    profile.scale = mobileControlScale;
    profile.controls = controls;
    mobileControlLayoutDirty = false;
    persistMobileControlLayoutStore();
    updateMobileDefaultLayoutState();
  }

  function saveMobileDefaultControlScale() {
    if (!mobileControlLayoutIsDefault()) return;
    var viewport = mobileViewportDimensions();
    if (Math.abs(mobileControlScale - 1) < 0.001) {
      if (mobileControlLayout) removeActiveMobileControlLayoutProfile();
    } else {
      var profile = ensureMobileControlLayoutProfile();
      profile.width = viewport.width;
      profile.height = viewport.height;
      profile.scale = mobileControlScale;
      delete profile.controls;
    }
    persistMobileControlLayoutStore();
    updateMobileDefaultLayoutState();
  }

  function promoteMobileControlsForEditing() {
    var boundsByControl = mobileEditableControls.map(function (button) {
      return mobileControlRect(button);
    });
    mobileEditableControls.forEach(function (button, index) {
      var bounds = boundsByControl[index];
      setMobileControlFixedRect(button, bounds.left, bounds.top, bounds.width, bounds.height);
    });
  }

  function updateMobileEditButton() {
    if (!mobileEditButton) return;
    setMobileToggleState(mobileEditButton, mobileControlEditMode);
    mobileEditButton.title = mobileControlEditMode ? "컨트롤 편집 끝내기" : "컨트롤 편집";
    mobileEditButton.setAttribute("aria-label", mobileEditButton.title);
  }

  function updateMobileHideButton() {
    if (!mobileHideButton) return;
    mobileHideButton.innerHTML = mobileControlIconMarkup(mobileControlsHidden ? "show-controls" : "hide-controls");
    mobileHideButton.title = mobileControlsHidden ? "컨트롤 보이기" : "컨트롤 숨기기";
    mobileHideButton.setAttribute("aria-label", mobileHideButton.title);
    mobileHideButton.setAttribute("aria-pressed", mobileControlsHidden ? "true" : "false");
  }

  function finishMobileControlEditing() {
    mobileControlGesture = null;
    mobileControlEditMode = false;
    if (mobileControlLayoutIsDefault()) {
      clearMobileControlInlineLayout();
      applyMobileControlScale();
    }
    updateMobileEditButton();
    updateMobileDefaultLayoutState();
  }

  function setMobileControlEditMode(editing) {
    if (editing === mobileControlEditMode) return;
    releaseMobileHeldControls();
    if (!editing) {
      finishMobileControlEditing();
      updateMobileControlsVisibility();
      return;
    }
    mobileControlsHidden = false;
    mobileControlEditMode = true;
    mobileControlLayoutDirty = false;
    if (mobileControlLayout && mobileControlLayout.controls) applyMobileControlLayout();
    else {
      clearMobileControlInlineLayout();
      applyMobileControlScale();
      promoteMobileControlsForEditing();
    }
    updateMobileEditButton();
    updateMobileHideButton();
    updateMobileDefaultLayoutState();
    updateMobileControlsVisibility();
  }

  function toggleMobileControlsHidden() {
    if (mobileControlEditMode) finishMobileControlEditing();
    mobileControlsHidden = !mobileControlsHidden;
    releaseMobileHeldControls();
    updateMobileHideButton();
    updateMobileControlsVisibility();
  }

  function resetMobileControlLayout() {
    if (mobileControlLayout) removeActiveMobileControlLayoutProfile();
    mobileControlScale = 1;
    mobileControlLayoutDirty = false;
    persistMobileControlLayoutStore();
    clearMobileControlInlineLayout();
    applyMobileControlScale();
    if (mobileControlEditMode) promoteMobileControlsForEditing();
    updateMobileDefaultLayoutState();
  }

  function adjustMobileDefaultControlScale(delta) {
    if (!mobileControlEditMode || !mobileControlLayoutIsDefault()) return;
    var nextScale = clampMobileValue(Math.round((mobileControlScale + delta) * 10) / 10, 0.8, 1.5);
    if (nextScale === mobileControlScale) return;
    mobileControlScale = nextScale;
    clearMobileControlInlineLayout();
    applyMobileControlScale();
    promoteMobileControlsForEditing();
    saveMobileDefaultControlScale();
  }

  function syncMobileControlLayoutForViewport() {
    if (mobileControlGesture) return;
    var nextLayout = findMobileControlLayoutForViewport(mobileControlLayoutStore, mobileViewportDimensions());
    if (nextLayout !== mobileControlLayout) {
      mobileControlGesture = null;
      mobileControlLayoutDirty = false;
      mobileControlLayout = nextLayout;
      mobileControlScale = mobileControlLayout && isFinite(Number(mobileControlLayout.scale))
        ? clampMobileValue(Number(mobileControlLayout.scale), 0.8, 1.5)
        : 1;
      clearMobileControlInlineLayout();
    }
    if (mobileControlLayout && mobileControlLayout.controls) {
      applyMobileControlLayout();
    } else {
      clearMobileControlInlineLayout();
      applyMobileControlScale();
      if (mobileControlEditMode) promoteMobileControlsForEditing();
      updateMobileDefaultLayoutState();
    }
  }

  function updateMobileSensitivityDisplay() {
    if (mobileSensitivityInput) mobileSensitivityInput.value = String(mobileLookSensitivity);
    if (mobileSensitivityValue) mobileSensitivityValue.textContent = Math.round(mobileLookSensitivity / 1.35 * 100) + "%";
  }

  function setMobileLookSensitivity(value) {
    value = Number(value);
    if (!isFinite(value)) return;
    mobileLookSensitivity = clampMobileValue(value, 0.5, 4.05);
    updateMobileSensitivityDisplay();
    try {
      window.localStorage.setItem(mobileLookSensitivityStorageKey, String(mobileLookSensitivity));
    } catch (_error) {
      // The selected sensitivity still works for this session when storage is blocked.
    }
  }

  function mobileEditorEventPoint(event, identifier) {
    if (event && (event.touches || event.changedTouches)) {
      var touch = mobileTouchWithId(event.touches || event.changedTouches, identifier);
      if (!touch && event.changedTouches && event.changedTouches.length) touch = event.changedTouches[0];
      if (!touch) return null;
      return { x: touch.clientX, y: touch.clientY, identifier: touch.identifier };
    }
    if (!event || typeof event.clientX !== "number" || typeof event.clientY !== "number") return null;
    return { x: event.clientX, y: event.clientY, identifier: null };
  }

  function beginMobileControlGesture(button, mode, event) {
    if (!mobileControlEditMode) return;
    var firstTouch = event && event.changedTouches && event.changedTouches[0];
    var point = mobileEditorEventPoint(event, firstTouch ? firstTouch.identifier : null);
    if (!point) return;
    preventMobileControlDefault(event);
    if (event && typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    var bounds = mobileControlRect(button);
    setMobileControlFixedRect(button, bounds.left, bounds.top, bounds.width, bounds.height);
    mobileControlGesture = {
      button: button,
      mode: mode,
      identifier: point.identifier,
      startX: point.x,
      startY: point.y,
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    };
  }

  function moveMobileControlGesture(event) {
    if (!mobileControlGesture) return;
    var point = mobileEditorEventPoint(event, mobileControlGesture.identifier);
    if (!point) return;
    preventMobileControlDefault(event);
    var deltaX = point.x - mobileControlGesture.startX;
    var deltaY = point.y - mobileControlGesture.startY;
    if (deltaX === 0 && deltaY === 0) return;
    if (mobileControlGesture.mode === "resize") {
      var viewport = mobileViewportDimensions();
      setMobileControlFixedRect(
        mobileControlGesture.button,
        mobileControlGesture.left,
        mobileControlGesture.top,
        clampMobileValue(
          mobileControlGesture.width + deltaX,
          35,
          Math.max(35, viewport.width - mobileControlGesture.left - 4)
        ),
        clampMobileValue(
          mobileControlGesture.height + deltaY,
          35,
          Math.max(35, viewport.height - mobileControlGesture.top - 4)
        )
      );
    } else {
      setMobileControlFixedRect(
        mobileControlGesture.button,
        mobileControlGesture.left + deltaX,
        mobileControlGesture.top + deltaY,
        mobileControlGesture.width,
        mobileControlGesture.height
      );
    }
    mobileControlLayoutDirty = true;
    updateMobileDefaultLayoutState();
  }

  function endMobileControlGesture(event) {
    if (!mobileControlGesture) return;
    if (mobileControlGesture.identifier !== null && event && event.changedTouches) {
      if (!mobileTouchWithId(event.changedTouches, mobileControlGesture.identifier)) return;
    }
    preventMobileControlDefault(event);
    var changed = mobileControlLayoutDirty;
    mobileControlGesture = null;
    if (changed) saveMobileControlLayout();
  }

  function installMobileControlEditorInteractions() {
    if (mobileControlEditorListenersInstalled || !document.addEventListener) return;
    mobileControlEditorListenersInstalled = true;
    document.addEventListener("touchmove", moveMobileControlGesture, { capture: true, passive: false });
    document.addEventListener("touchend", endMobileControlGesture, { capture: true, passive: false });
    document.addEventListener("touchcancel", endMobileControlGesture, { capture: true, passive: false });
    document.addEventListener("mousemove", moveMobileControlGesture, true);
    document.addEventListener("mouseup", endMobileControlGesture, true);
  }

  function registerMobileEditableControl(button) {
    if (!button) return button;
    button.setAttribute("data-sp-editable", "true");
    var handle = document.createElement("span");
    handle.className = "sp-mobile-resize-handle";
    handle.setAttribute("aria-hidden", "true");
    handle.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 14h8V6M10 14h4v-4"/></svg>';
    button.appendChild(handle);
    mobileEditableControls.push(button);
    if (typeof button.addEventListener === "function") {
      button.addEventListener("touchstart", function (event) {
        beginMobileControlGesture(button, event.target === handle ? "resize" : "move", event);
      }, { capture: true, passive: false });
      button.addEventListener("mousedown", function (event) {
        beginMobileControlGesture(button, event.target === handle ? "resize" : "move", event);
      }, true);
    }
    return button;
  }

  var mobileForwardPixelRows = [
    "................",
    "................",
    "................",
    "................",
    "................",
    ".......##.......",
    "......####......",
    ".....######.....",
    "....###..###....",
    "...###....###...",
    "...##......##...",
    "................",
    "................",
    "................",
    "................",
    "................",
  ];
  var mobilePixelRowsByAction = {
    sprint: [
      "................",
      "................",
      "................",
      "................",
      "...##...##......",
      "...###..###.....",
      "....###..###....",
      ".....###..###...",
      ".....###..###...",
      "....###..###....",
      "...###..###.....",
      "...##...##......",
      "................",
      "................",
      "................",
      "................",
    ],
    jump: [
      "................",
      "................",
      ".......##.......",
      "......####......",
      ".....######.....",
      "....########....",
      "....##.##.##....",
      ".......##.......",
      ".......##.......",
      ".......##.......",
      ".......##.......",
      "................",
      "................",
      "...##########...",
      "...##########...",
      "................",
    ],
    sneak: [
      "................",
      "................",
      ".......##.......",
      ".......##.......",
      ".......##.......",
      ".......##.......",
      ".......##.......",
      "....##.##.##....",
      "....########....",
      ".....######.....",
      "......####......",
      ".......##.......",
      "................",
      "...##########...",
      "...##########...",
      "................",
    ],
    attack: [
      "................",
      "............###.",
      "...........####.",
      "..........#####.",
      ".........#####..",
      "........#####...",
      ".......#####....",
      "..##..#####...#.",
      "..########...###",
      "...######.....#.",
      "....####........",
      "...#####........",
      "..###.###.......",
      ".###...##.......",
      ".##.............",
      "................",
    ],
    use: [
      "................",
      ".......##.......",
      ".......##.......",
      ".......##.......",
      ".......##.......",
      ".......##.......",
      "................",
      ".#####....#####.",
      ".#####....#####.",
      "................",
      ".......##.......",
      ".......##.......",
      ".......##.......",
      ".......##.......",
      ".......##.......",
      "................",
    ],
  };

  function rotateMobilePixelRows(rows) {
    var rotated = [];
    for (var y = 0; y < 16; ++y) {
      var row = "";
      for (var x = 0; x < 16; ++x) row += rows[15 - x].charAt(y);
      rotated.push(row);
    }
    return rotated;
  }

  function mobileControlPixelRows(actionName) {
    if (actionName === "forward") return mobileForwardPixelRows;
    if (actionName === "right") return rotateMobilePixelRows(mobileForwardPixelRows);
    if (actionName === "back") return rotateMobilePixelRows(rotateMobilePixelRows(mobileForwardPixelRows));
    if (actionName === "left") {
      return rotateMobilePixelRows(rotateMobilePixelRows(rotateMobilePixelRows(mobileForwardPixelRows)));
    }
    return mobilePixelRowsByAction[actionName] || null;
  }

  function mobilePixelIconBody(rows) {
    var body = "";
    for (var y = 0; y < rows.length; ++y) {
      var x = 0;
      while (x < rows[y].length) {
        if (rows[y].charAt(x) !== "#") {
          ++x;
          continue;
        }
        var start = x;
        while (x < rows[y].length && rows[y].charAt(x) === "#") ++x;
        body += '<rect x="' + start + '" y="' + y + '" width="' + (x - start) + '" height="1"/>';
      }
    }
    return body;
  }

  function mobileControlIconMarkup(actionName) {
    var rows = mobileControlPixelRows(actionName);
    if (rows) {
      return '<svg class="sp-mobile-icon sp-mobile-pixel-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false" shape-rendering="crispEdges">' + mobilePixelIconBody(rows) + '</svg>';
    }
    if (actionName === "edit-controls") {
      return '<svg class="sp-mobile-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    }
    if (actionName === "hide-controls") {
      return '<svg class="sp-mobile-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 2 20 20"/><path d="M6.7 6.7C4.9 8 3.4 9.8 2.5 12c1.7 4.2 5.4 7 9.5 7 1.5 0 2.9-.4 4.2-1"/><path d="M10.7 5.1c.4-.1.9-.1 1.3-.1 4.1 0 7.8 2.8 9.5 7-.5 1.2-1.2 2.3-2.1 3.3"/><path d="M14.1 14.1A3 3 0 0 1 9.9 9.9"/></svg>';
    }
    if (actionName === "show-controls") {
      return '<svg class="sp-mobile-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
    }
    return "";
  }

  function createMobileButton(label, accessibleLabel, actionName) {
    var button = document.createElement("button");
    button.type = "button";
    var iconMarkup = mobileControlIconMarkup(actionName);
    if (iconMarkup) button.innerHTML = iconMarkup;
    else button.textContent = label;
    button.title = accessibleLabel;
    button.className = "sp-mobile-button";
    if (actionName === "menu" || actionName === "chat" || actionName === "drop" || actionName === "inventory") {
      button.className += " sp-mobile-key-label";
    }
    button.setAttribute("aria-label", accessibleLabel);
    button.setAttribute("data-sp-control", actionName);
    button.oncontextmenu = function (event) { preventMobileControlDefault(event); };
    return button;
  }

  function bindMobileHoldButton(button, press, release) {
    var active = false;
    function start(event) {
      preventMobileControlDefault(event);
      if (mobileControlEditMode && mobileControlIsEditable(button)) return;
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
      if (mobileControlEditMode && mobileControlIsEditable(button)) return;
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
      if (mobileControlEditMode && mobileControlIsEditable(button)) return;
      if (Date.now() - lastTouchAt < 700) return;
      action();
    };
  }

  function updateMobileChatDraft() {
    if (!mobileChatInput) return;
    chatDraft = typeof mobileChatInput.value === "string" ? mobileChatInput.value : "";
    updateTPAPickerVisibility();
  }

  function beginChatHistoryNavigation() {
    sentChatHistoryIndex = sentChatHistory.length;
    sentChatHistoryDraft = chatDraft;
  }

  function rememberSentChat(message) {
    if (!message) return;
    if (sentChatHistory[sentChatHistory.length - 1] !== message) sentChatHistory.push(message);
    if (sentChatHistory.length > 50) sentChatHistory.shift();
    sentChatHistoryIndex = sentChatHistory.length;
    sentChatHistoryDraft = "";
  }

  function navigateSentChatHistory(direction) {
    if (!mobileChatInput || !sentChatHistory.length) return;
    if (sentChatHistoryIndex === sentChatHistory.length) {
      sentChatHistoryDraft = typeof mobileChatInput.value === "string" ? mobileChatInput.value : "";
    }
    sentChatHistoryIndex = Math.max(0, Math.min(sentChatHistory.length, sentChatHistoryIndex + direction));
    mobileChatInput.value = sentChatHistoryIndex === sentChatHistory.length
      ? sentChatHistoryDraft
      : sentChatHistory[sentChatHistoryIndex];
    updateMobileChatDraft();
    if (typeof mobileChatInput.setSelectionRange === "function") {
      var end = mobileChatInput.value.length;
      mobileChatInput.setSelectionRange(end, end);
    }
  }

  function updateMobileChatComposerLayout() {
    if (!mobileChatComposer || !mobileChatComposerIsVisible()) return;
    var viewport = window.visualViewport;
    var windowHeight = typeof window.innerHeight === "number" ? window.innerHeight : 0;
    if (!viewport || !windowHeight || typeof viewport.height !== "number") {
      mobileChatComposer.style.bottom = "max(8px,env(safe-area-inset-bottom))";
      return;
    }
    var viewportBottom = (typeof viewport.offsetTop === "number" ? viewport.offsetTop : 0) + viewport.height;
    var keyboardInset = Math.max(0, Math.round(windowHeight - viewportBottom));
    mobileChatComposer.style.bottom = "calc(" + keyboardInset + "px + max(8px,env(safe-area-inset-bottom)))";
  }

  function showMobileChatComposer(initialValue, focusInput) {
    injectMobileControlStyles();
    installMobileChatComposer();
    if (!mobileChatComposer || !mobileChatInput) return;
    mobileChatComposer.setAttribute("data-sp-platform", mobileTouchCapable ? "touch" : "desktop");
    var wasHidden = !mobileChatComposerIsVisible();
    mobileChatComposer.style.display = "flex";
    if (wasHidden) {
      var value = typeof initialValue === "string" ? initialValue : "";
      mobileChatInput.value = value;
      chatDraft = value;
    }
    updateMobileChatComposerLayout();
    if (focusInput && document.activeElement !== mobileChatInput && typeof mobileChatInput.focus === "function") {
      try {
        mobileChatInput.focus({ preventScroll: true });
      } catch (_error) {
        mobileChatInput.focus();
      }
    }
  }

  function hideMobileChatComposer() {
    if (!mobileChatComposer || !mobileChatInput) return;
    mobileChatComposer.style.display = "none";
    mobileChatComposing = false;
    if (document.activeElement === mobileChatInput && typeof mobileChatInput.blur === "function") mobileChatInput.blur();
    updateMobileControlsVisibility();
  }

  function submitMobileChat() {
    if (!mobileChatComposerIsVisible() || !mobileChatInput || mobileChatSending || mobileChatComposing) return;
    var message = typeof mobileChatInput.value === "string" ? mobileChatInput.value.trim() : "";
    if (!message) {
      if (portalChatActive) closePortalChat(true);
      else if (desktopChatInputActive || /GuiChat$/.test(currentScreenName)) dispatchMobileBackAction();
      else hideMobileChatComposer();
      return;
    }
    if (message === "/") {
      setMobileChatStatus("명령어를 입력하세요.", true);
      return;
    }
    if (typeof window.fetch !== "function") {
      setMobileChatStatus("채팅 연결을 사용할 수 없어요.", true);
      return;
    }

    var submittedFromPortal = portalChatActive;
    setMobileChatStatus("", false);
    setMobileChatSending(true);
    // Desktop pointer lock needs the Enter or click gesture. Mobile uses the
    // local pointer-lock shim, so it can keep its software keyboard open while
    // the request is pending.
    if (submittedFromPortal && !mobileTouchCapable) closePortalChat(true);

    window.fetch("/api/game/chat", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ launchId: launchId, message: message }),
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok || !body || body.sent !== true) {
          var errorMessage = body && body.error && typeof body.error.message === "string"
            ? body.error.message
            : "채팅을 보내지 못했어요.";
          throw new Error(errorMessage);
        }
        return body;
      });
    }).then(function () {
      setMobileChatSending(false);
      rememberSentChat(message);
      if (submittedFromPortal && portalChatActive) closePortalChat(true);
      else if (!submittedFromPortal) {
        dismissClientChat();
        desktopChatInputActive = false;
        chatDraft = "";
        updateTPAPickerVisibility();
        hideMobileChatComposer();
        restorePortalGameFocus();
      }
    }).catch(function (error) {
      setMobileChatSending(false);
      if (submittedFromPortal && !portalChatActive) openClientChat(message, true);
      else if (mobileChatInput && typeof mobileChatInput.focus === "function") mobileChatInput.focus();
      setMobileChatStatus(error && typeof error.message === "string" ? error.message : "채팅을 보내지 못했어요.", true);
    });
  }

  function installMobileChatComposer() {
    if (!document.createElement || !document.body) return;
    if (mobileChatComposer) {
      if (mobileChatComposer.parentNode !== document.body) document.body.appendChild(mobileChatComposer);
      return;
    }
    mobileChatComposer = document.createElement("div");
    mobileChatComposer.id = "spawnpoint-mobile-chat";
    mobileChatComposer.style.display = "none";
    mobileChatComposer.setAttribute("role", "group");
    mobileChatComposer.setAttribute("aria-label", "채팅 입력 도구");

    mobileChatInput = document.createElement("input");
    mobileChatInput.type = "text";
    mobileChatInput.lang = "ko-KR";
    mobileChatInput.inputMode = "text";
    mobileChatInput.autocapitalize = "off";
    mobileChatInput.autocomplete = "off";
    mobileChatInput.enterKeyHint = "send";
    mobileChatInput.spellcheck = false;
    mobileChatInput.maxLength = 256;
    mobileChatInput.placeholder = "채팅 입력";
    mobileChatInput.setAttribute("aria-label", "채팅 입력");
    mobileChatInput.oncompositionstart = function () { mobileChatComposing = true; };
    mobileChatInput.oncompositionend = function () {
      mobileChatComposing = false;
      updateMobileChatDraft();
    };
    mobileChatInput.oninput = function (event) {
      if (!mobileChatComposing && !(event && event.isComposing)) updateMobileChatDraft();
    };
    mobileChatInput.onkeydown = function (event) {
      if (event && typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
      if (event && !mobileChatComposing && !event.isComposing && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        if (typeof event.preventDefault === "function") event.preventDefault();
        navigateSentChatHistory(event.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (!event || event.key !== "Enter" || mobileChatComposing || event.isComposing || event.keyCode === 229) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      submitMobileChat();
    };
    mobileChatInput.onkeypress = function (event) {
      if (event && typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    };
    mobileChatInput.onkeyup = mobileChatInput.onkeypress;
    mobileChatComposer.appendChild(mobileChatInput);

    mobileChatSendButton = createMobileButton("전송", "채팅 전송", "chat-send");
    bindMobilePulseButton(mobileChatSendButton, submitMobileChat);
    mobileChatComposer.appendChild(mobileChatSendButton);

    mobileChatStatus = document.createElement("span");
    mobileChatStatus.className = "sp-chat-status";
    mobileChatStatus.style.display = "none";
    mobileChatStatus.setAttribute("role", "status");
    mobileChatStatus.setAttribute("aria-live", "polite");
    mobileChatComposer.appendChild(mobileChatStatus);
    document.body.appendChild(mobileChatComposer);
  }

  function dispatchMobileBackAction() {
    if (portalChatActive) {
      closePortalChat(true);
      return;
    }
    if (desktopChatInputActive || /GuiChat$/.test(currentScreenName)) {
      markUiEscape(currentScreenName || "GuiChat");
      dismissClientChat();
      hideMobileChatComposer();
      var input = findClientTextInput();
      if (input && document.activeElement === input && typeof input.blur === "function") input.blur();
      return;
    }
    if (currentScreenName && !/GuiIngameMenu$/.test(currentScreenName)) markUiEscape(currentScreenName);
    else clearUiEscapeSuppression();
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
    return registerMobileEditableControl(button);
  }

  function injectMobileControlStyles() {
    if (!document.createElement || !document.head || document.getElementById("spawnpoint-mobile-control-style")) return;
    var style = document.createElement("style");
    style.id = "spawnpoint-mobile-control-style";
    style.textContent = [
      "@font-face{font-family:\"Spawnpoint Mark\";src:url(\"/game/fonts/Galmuri11.woff2\") format(\"woff2\");font-display:swap}",
      "#spawnpoint-mobile-controls{position:fixed;inset:0;display:none;z-index:2147483200;pointer-events:none;--sp-touch:clamp(44px,13dvh,54px);--sp-press-duration:150ms;--sp-press-ease:cubic-bezier(.22,1,.36,1);font:700 12px/1 \"Spawnpoint Mark\",monospace;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}",
      "#spawnpoint-mobile-controls .sp-mobile-gameplay{pointer-events:none}",
      "#spawnpoint-mobile-controls.is-menu .sp-mobile-gameplay{display:none}",
      "#spawnpoint-mobile-controls .sp-mobile-button.sp-mobile-chat-only{display:none}",
      "#spawnpoint-mobile-controls.is-chat .sp-mobile-gameplay{display:none}",
      "#spawnpoint-mobile-controls.is-chat .sp-mobile-button.sp-mobile-chat-only{position:absolute;top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));display:grid}",
      "#spawnpoint-mobile-controls .sp-mobile-tools{position:absolute;top:max(8px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right));display:flex;gap:5px}",
      "#spawnpoint-mobile-controls .sp-mobile-button.sp-mobile-default-scale{display:none}",
      "#spawnpoint-mobile-controls.is-editing[data-sp-default-layout=true] .sp-mobile-button.sp-mobile-default-scale{display:grid}",
      "#spawnpoint-mobile-controls .sp-mobile-editor{position:absolute;top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));display:none;align-items:center;gap:7px;box-sizing:border-box;min-height:44px;padding:6px 7px;pointer-events:auto;color:#fff;background:rgba(3,6,4,.78);border:1px solid rgba(255,255,255,.32);border-radius:6px;font:700 11px/1.1 \"Spawnpoint Mark\",monospace}",
      "#spawnpoint-mobile-controls.is-editing .sp-mobile-editor{display:flex}",
      "#spawnpoint-mobile-controls .sp-mobile-sensitivity{display:grid;grid-template-columns:auto auto;align-items:center;gap:4px 7px;white-space:nowrap}",
      "#spawnpoint-mobile-controls .sp-mobile-sensitivity output{justify-self:end;color:rgba(255,255,255,.75)}",
      "#spawnpoint-mobile-controls .sp-mobile-sensitivity input{grid-column:1/3;width:min(34vw,150px);height:18px;margin:0;padding:0;pointer-events:auto;touch-action:pan-x;accent-color:#eef7e9}",
      "#spawnpoint-mobile-controls .sp-mobile-reset{box-sizing:border-box;min-width:64px;min-height:44px;margin:0;padding:7px;pointer-events:auto;touch-action:manipulation;border:0;border-radius:5px;color:#fff;background:rgba(8,12,10,.62);font:inherit}",
      "#spawnpoint-mobile-controls .sp-mobile-move{position:absolute;left:max(8px,env(safe-area-inset-left));bottom:max(8px,env(safe-area-inset-bottom));display:grid;grid-template:repeat(3,var(--sp-touch))/repeat(3,var(--sp-touch));gap:5px}",
      "#spawnpoint-mobile-controls .sp-mobile-actions{position:absolute;right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));display:grid;grid-template:repeat(2,var(--sp-touch))/repeat(3,var(--sp-touch));gap:5px}",
      "#spawnpoint-mobile-controls.are-controls-hidden .sp-mobile-move,#spawnpoint-mobile-controls.are-controls-hidden .sp-mobile-actions{display:none}",
      "#spawnpoint-mobile-controls .sp-mobile-button,#spawnpoint-mobile-chat .sp-mobile-button{box-sizing:border-box;display:grid;place-items:center;width:var(--sp-touch,44px);height:var(--sp-touch,44px);min-width:35px;min-height:35px;margin:0;padding:4px;pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent;border:0;border-radius:6px;outline:0;color:#fff;background:rgba(8,12,10,.46);box-shadow:none;font:inherit;text-align:center;transform:scale(1);transform-origin:center;transition:transform var(--sp-press-duration,150ms) var(--sp-press-ease,cubic-bezier(.22,1,.36,1)),background-color var(--sp-press-duration,150ms) var(--sp-press-ease,cubic-bezier(.22,1,.36,1));will-change:transform,background-color}",
      "#spawnpoint-mobile-controls .sp-mobile-icon,#spawnpoint-mobile-chat .sp-mobile-icon{display:block;width:24px;height:24px;pointer-events:none}",
      "#spawnpoint-mobile-controls .sp-mobile-pixel-icon{fill:currentColor;stroke:none;image-rendering:pixelated}",
      "#spawnpoint-mobile-controls .sp-mobile-key-label{font-weight:900;text-shadow:1px 0 0 currentColor}",
      "#spawnpoint-mobile-controls .sp-mobile-tools .sp-mobile-button{width:44px;height:44px;min-width:44px;min-height:44px}",
      "#spawnpoint-mobile-controls .sp-mobile-tools .sp-mobile-icon{width:20px;height:20px}",
      "#spawnpoint-mobile-controls .sp-mobile-default-scale:disabled{opacity:.42}",
      "#spawnpoint-mobile-controls .sp-mobile-button.is-toggled{background:rgba(5,9,7,.74)}",
      "#spawnpoint-mobile-controls .sp-mobile-button.is-pressed,#spawnpoint-mobile-controls .sp-mobile-button:active,#spawnpoint-mobile-chat .sp-mobile-button.is-pressed,#spawnpoint-mobile-chat .sp-mobile-button:active{background:rgba(2,5,3,.82);transform:scale(.94)}",
      "#spawnpoint-mobile-controls .sp-mobile-button.is-toggled.is-pressed,#spawnpoint-mobile-controls .sp-mobile-button.is-toggled:active{background:rgba(0,3,1,.92)}",
      "#spawnpoint-mobile-controls .sp-mobile-resize-handle{position:absolute;right:1px;bottom:1px;display:none;width:19px;height:19px;place-items:center;pointer-events:none;color:#fff;background:rgba(2,5,3,.82);border-radius:4px 0 4px 0}",
      "#spawnpoint-mobile-controls .sp-mobile-resize-handle svg{display:block;width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:square;stroke-linejoin:miter;pointer-events:none}",
      "#spawnpoint-mobile-controls.is-editing [data-sp-editable=true]{cursor:move;outline:1px solid rgba(255,255,255,.82);outline-offset:-1px;transform:none}",
      "#spawnpoint-mobile-controls.is-editing [data-sp-editable=true] .sp-mobile-resize-handle{display:grid;pointer-events:auto;cursor:nwse-resize}",
      "#spawnpoint-mobile-controls [data-sp-custom-position=true] .sp-mobile-icon{width:clamp(24px,42%,40px);height:clamp(24px,42%,40px)}",
      "#spawnpoint-mobile-chat{position:fixed;left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));z-index:2147483300;display:none;align-items:stretch;gap:6px;padding:0;background:transparent;border:0;border-radius:0;box-shadow:none;pointer-events:auto;font:400 16px/1.2 \"Spawnpoint Mark\",monospace}",
      "#spawnpoint-mobile-chat input{box-sizing:border-box;min-width:0;min-height:44px;flex:1;margin:0;padding:9px 11px;border:1px solid rgba(255,255,255,.32);border-radius:0;outline:none;color:#fff;background:rgba(3,6,4,.72);caret-color:#fff;font:400 16px/1.35 \"Spawnpoint Mark\",monospace;-webkit-user-select:text;user-select:text}",
      "#spawnpoint-mobile-chat input:focus{border-color:rgba(231,247,222,.78);box-shadow:inset 0 0 0 1px rgba(121,168,111,.38)}",
      "#spawnpoint-mobile-chat .sp-mobile-button{flex:0 0 auto;width:64px;height:auto;min-width:64px;min-height:44px;border:1px solid rgba(255,255,255,.32);border-radius:0;background:rgba(3,6,4,.72);font:400 16px/1 \"Spawnpoint Mark\",monospace}",
      "#spawnpoint-mobile-chat .sp-mobile-button:disabled{opacity:.55;cursor:wait}",
      "#spawnpoint-mobile-chat .sp-chat-status{position:absolute;left:0;right:0;bottom:calc(100% + 6px);display:none;box-sizing:border-box;padding:7px 9px;color:#eef7e9;background:rgba(28,46,31,.84);border:1px solid rgba(255,255,255,.32);border-radius:0;font:400 13px/1.3 \"Spawnpoint Mark\",monospace}",
      "#spawnpoint-mobile-chat .sp-chat-status[data-error=true]{color:#fff1ef;background:rgba(104,28,24,.97);border-color:rgba(255,177,169,.72)}",
      "@media (pointer:fine){#spawnpoint-mobile-chat[data-sp-platform=desktop]{left:12px;right:12px;bottom:12px;gap:7px}#spawnpoint-mobile-chat[data-sp-platform=desktop] input{min-height:40px;padding:7px 10px}#spawnpoint-mobile-chat[data-sp-platform=desktop] .sp-mobile-button{min-width:64px;min-height:40px;cursor:pointer}}",
      "#spawnpoint-mobile-controls [data-sp-control=menu]{grid-column:1;grid-row:1}",
      "#spawnpoint-mobile-controls [data-sp-control=forward]{grid-column:2;grid-row:1}",
      "#spawnpoint-mobile-controls [data-sp-control=chat]{grid-column:3;grid-row:1}",
      "#spawnpoint-mobile-controls [data-sp-control=left]{grid-column:1;grid-row:2}",
      "#spawnpoint-mobile-controls [data-sp-control=sprint]{grid-column:2;grid-row:2}",
      "#spawnpoint-mobile-controls [data-sp-control=right]{grid-column:3;grid-row:2}",
      "#spawnpoint-mobile-controls [data-sp-control=drop]{grid-column:1;grid-row:3}",
      "#spawnpoint-mobile-controls [data-sp-control=back]{grid-column:2;grid-row:3}",
      "#spawnpoint-mobile-controls [data-sp-control=inventory]{grid-column:3;grid-row:3}",
      "#spawnpoint-mobile-controls [data-sp-control=attack]{grid-column:1;grid-row:1/3;height:calc(var(--sp-touch)*2 + 5px)}",
      "#spawnpoint-mobile-controls [data-sp-control=use]{grid-column:2;grid-row:1/3;height:calc(var(--sp-touch)*2 + 5px)}",
      "#spawnpoint-mobile-controls [data-sp-control=jump]{grid-column:3;grid-row:1}",
      "#spawnpoint-mobile-controls [data-sp-control=sneak]{grid-column:3;grid-row:2}",
      "@media (max-height:360px){#spawnpoint-mobile-controls{--sp-touch:44px;font-size:11px}#spawnpoint-mobile-controls .sp-mobile-move,#spawnpoint-mobile-controls .sp-mobile-actions{gap:4px}}",
      "@media (prefers-reduced-motion:reduce){#spawnpoint-mobile-controls .sp-mobile-button,#spawnpoint-mobile-chat .sp-mobile-button{transition:none;will-change:auto}#spawnpoint-mobile-controls .sp-mobile-button.is-pressed,#spawnpoint-mobile-controls .sp-mobile-button:active,#spawnpoint-mobile-chat .sp-mobile-button.is-pressed,#spawnpoint-mobile-chat .sp-mobile-button:active{transform:scale(1)}}",
    ].join("");
    document.head.appendChild(style);
  }

  function installMobileControls() {
    if (!mobileTouchCapable || !document.createElement || !document.body) return;
    injectMobileControlStyles();
    installMobileChatComposer();
    if (mobileControlsRoot) {
      if (mobileControlsRoot.parentNode !== document.body) document.body.appendChild(mobileControlsRoot);
      installMobileControlEditorInteractions();
      prepareMobileCanvasPointerLock();
      updateMobileControlsVisibility();
      return;
    }
    mobileControlsRoot = document.createElement("div");
    mobileControlsRoot.id = "spawnpoint-mobile-controls";

    var chatExitButton = createMobileButton("ESC", "채팅 닫기", "chat-exit");
    chatExitButton.className += " sp-mobile-chat-only sp-mobile-key-label";
    bindMobilePulseButton(chatExitButton, dispatchMobileBackAction);
    mobileControlsRoot.appendChild(chatExitButton);

    var tools = document.createElement("div");
    tools.className = "sp-mobile-gameplay sp-mobile-tools";
    tools.setAttribute("role", "group");
    tools.setAttribute("aria-label", "컨트롤 설정");
    mobileScaleDownButton = createMobileButton("−", "전체 컨트롤 축소", "scale-down");
    mobileScaleDownButton.className += " sp-mobile-default-scale";
    bindMobilePulseButton(mobileScaleDownButton, function () { adjustMobileDefaultControlScale(-0.1); });
    tools.appendChild(mobileScaleDownButton);
    mobileScaleUpButton = createMobileButton("+", "전체 컨트롤 확대", "scale-up");
    mobileScaleUpButton.className += " sp-mobile-default-scale";
    bindMobilePulseButton(mobileScaleUpButton, function () { adjustMobileDefaultControlScale(0.1); });
    tools.appendChild(mobileScaleUpButton);
    mobileEditButton = createMobileButton("편집", "컨트롤 편집", "edit-controls");
    bindMobilePulseButton(mobileEditButton, function () { setMobileControlEditMode(!mobileControlEditMode); });
    tools.appendChild(mobileEditButton);
    mobileHideButton = createMobileButton("숨기기", "컨트롤 숨기기", "hide-controls");
    bindMobilePulseButton(mobileHideButton, toggleMobileControlsHidden);
    tools.appendChild(mobileHideButton);
    mobileControlsRoot.appendChild(tools);
    updateMobileEditButton();
    updateMobileHideButton();

    var editor = document.createElement("div");
    editor.className = "sp-mobile-gameplay sp-mobile-editor";
    editor.setAttribute("role", "group");
    editor.setAttribute("aria-label", "컨트롤 편집 도구");
    var sensitivity = document.createElement("label");
    sensitivity.className = "sp-mobile-sensitivity";
    var sensitivityLabel = document.createElement("span");
    sensitivityLabel.textContent = "마우스 감도";
    sensitivity.appendChild(sensitivityLabel);
    mobileSensitivityValue = document.createElement("output");
    sensitivity.appendChild(mobileSensitivityValue);
    mobileSensitivityInput = document.createElement("input");
    mobileSensitivityInput.type = "range";
    mobileSensitivityInput.min = "0.5";
    mobileSensitivityInput.max = "4.05";
    mobileSensitivityInput.step = "0.05";
    mobileSensitivityInput.setAttribute("aria-label", "마우스 감도");
    mobileSensitivityInput.oninput = function () { setMobileLookSensitivity(mobileSensitivityInput.value); };
    sensitivity.appendChild(mobileSensitivityInput);
    editor.appendChild(sensitivity);
    var resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className = "sp-mobile-reset";
    resetButton.textContent = "배치 초기화";
    resetButton.setAttribute("aria-label", "컨트롤 배치 초기화");
    bindMobilePulseButton(resetButton, resetMobileControlLayout);
    editor.appendChild(resetButton);
    mobileControlsRoot.appendChild(editor);
    updateMobileSensitivityDisplay();

    var move = document.createElement("div");
    move.className = "sp-mobile-gameplay sp-mobile-move";
    var menuButton = createMobileButton("ESC", "게임 메뉴 열기", "menu");
    bindMobilePulseButton(menuButton, function () { dispatchRelayedBackquote(null); });
    move.appendChild(menuButton);
    registerMobileEditableControl(menuButton);
    var forwardButton = createMobileButton("위", "앞으로 이동", "forward");
    bindMobileHoldButton(forwardButton, pressMobileForward, releaseMobileForward);
    move.appendChild(forwardButton);
    registerMobileEditableControl(forwardButton);
    var chatButton = createMobileButton("T", "채팅 열기", "chat");
    bindMobilePulseButton(chatButton, function () {
      // iOS only opens its keyboard when focus happens inside this touch turn.
      openClientChat("", true);
    });
    move.appendChild(chatButton);
    registerMobileEditableControl(chatButton);
    appendMobileKeyButton(move, "왼쪽", "왼쪽으로 이동", "left", "a", "KeyA", 65);
    var sprintButton = createMobileButton("달리기", "자동 달리기", "sprint");
    setMobileToggleState(sprintButton, mobileSprintEnabled);
    bindMobilePulseButton(sprintButton, function () {
      mobileSprintEnabled = !mobileSprintEnabled;
      setMobileToggleState(sprintButton, mobileSprintEnabled);
    });
    move.appendChild(sprintButton);
    registerMobileEditableControl(sprintButton);
    appendMobileKeyButton(move, "오른쪽", "오른쪽으로 이동", "right", "d", "KeyD", 68);
    var dropButton = createMobileButton("Q", "아이템 버리기", "drop");
    bindMobilePulseButton(dropButton, function () { dispatchMobileKeyPulse("q", "KeyQ", 81); });
    move.appendChild(dropButton);
    registerMobileEditableControl(dropButton);
    appendMobileKeyButton(move, "아래", "뒤로 이동", "back", "s", "KeyS", 83);
    var inventoryButton = createMobileButton("E", "보관함 열기", "inventory");
    bindMobilePulseButton(inventoryButton, function () { dispatchMobileKeyPulse("e", "KeyE", 69); });
    move.appendChild(inventoryButton);
    registerMobileEditableControl(inventoryButton);
    mobileControlsRoot.appendChild(move);

    var actions = document.createElement("div");
    actions.className = "sp-mobile-gameplay sp-mobile-actions";
    var attackButton = createMobileButton("부수기", "공격 또는 부수기", "attack");
    bindMobileHoldButton(attackButton, function () { dispatchMobileMouseState(0, true, null); }, function () { dispatchMobileMouseState(0, false, null); });
    actions.appendChild(attackButton);
    registerMobileEditableControl(attackButton);
    var useButton = createMobileButton("놓기", "놓기 또는 사용", "use");
    bindMobileHoldButton(useButton, function () { dispatchMobileMouseState(2, true, null); }, function () { dispatchMobileMouseState(2, false, null); });
    actions.appendChild(useButton);
    registerMobileEditableControl(useButton);
    appendMobileKeyButton(actions, "점프", "점프", "jump", " ", "Space", 32);
    appendMobileKeyButton(actions, "숙이기", "웅크리기", "sneak", "Shift", "ShiftLeft", 16);
    mobileControlsRoot.appendChild(actions);

    document.body.appendChild(mobileControlsRoot);
    applyMobileControlLayout();
    updateMobileDefaultLayoutState();
    installMobileControlEditorInteractions();
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
    if (event.__spawnpointMobileChatForwarded === true || event.__spawnpointMobileControl === true) return false;
    if (isMobileChatInput(event.target) || isMobileChatInput(document.activeElement)) return true;
    if (!isClientTextInput(event.target) && !isClientTextInput(document.activeElement)) return false;
    if (event.isComposing || composingInput || event.keyCode === 229 || event.which === 229) return true;

    var key = typeof event.key === "string" ? event.key : "";
    // A native IME can emit the first printable key before compositionstart or
    // keyCode 229. Let the focused input receive it, otherwise the runtime's
    // preventDefault() stops Korean composition before it begins.
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) return true;
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

  function clearUiEscapeSuppression() {
    uiEscapeSourceScreen = "";
    uiEscapeHandledAt = 0;
    if (uiEscapeClearTimer !== null && typeof window.clearTimeout === "function") {
      window.clearTimeout(uiEscapeClearTimer);
    }
    uiEscapeClearTimer = null;
  }

  function markUiEscape(screenName) {
    clearUiEscapeSuppression();
    uiEscapeSourceScreen = screenName || "GuiScreen";
    uiEscapeHandledAt = Date.now();
  }

  function scheduleUiEscapeSuppressionClear() {
    if (!uiEscapeSourceScreen || typeof window.setTimeout !== "function") return;
    if (uiEscapeClearTimer !== null && typeof window.clearTimeout === "function") {
      window.clearTimeout(uiEscapeClearTimer);
    }
    uiEscapeClearTimer = window.setTimeout(clearUiEscapeSuppression, 150);
  }

  function relayNativeEscape(event) {
    trackChatDraftKey(event);
    var isEscape = event.key === "Escape" || event.code === "Escape" || event.keyCode === 27 || event.which === 27;
    if (!isEscape || isRelayedBackquote(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "keyup") {
      scheduleUiEscapeSuppressionClear();
      return;
    }
    if (event.type !== "keydown" || event.repeat) return;
    if (portalChatActive) {
      markUiEscape("PortalChat");
      closePortalChat(true);
      return;
    }
    var sourceTarget = event.target;
    if (isClientTextInput(sourceTarget) || desktopChatInputActive) {
      markUiEscape(currentScreenName || "GuiChat");
      dismissClientChat();
      hideMobileChatComposer();
      if (isClientTextInput(sourceTarget) && document.activeElement === sourceTarget && typeof sourceTarget.blur === "function") {
        sourceTarget.blur();
      }
      restoreGameplayForUiEscape();
      return;
    }
    if (currentScreenName && !/GuiIngameMenu$/.test(currentScreenName)) markUiEscape(currentScreenName);
    else clearUiEscapeSuppression();
    dispatchRelayedBackquote(sourceTarget);
    restoreGameplayForUiEscape();
  }

  function blockClientBackquote(event) {
    if (isRelayedBackquote(event)) return;
    if (isClientTextInput(event.target) || isMobileChatInput(event.target)) return;
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
    document.addEventListener("pointerup", function (event) {
      if (hasClass(event.target, "_eaglercraftX_keyboard_open_zone")) enableClientTextInput();
    }, true);
  }

  installMobileTouchSupport();

  if (typeof window.MutationObserver === "function" && document.documentElement) {
    var imeObserver = new window.MutationObserver(function () {
      enableClientTextInput(false);
      installLocatorHud();
      installMobileControls();
      prepareMobileCanvasPointerLock();
      updateMobileControlsVisibility();
    });
    imeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "type"],
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
    syncMobileControlLayoutForViewport();
    prepareMobileCanvasPointerLock();
    updateMobileControlsVisibility();
    updateMobileChatComposerLayout();
  });
  if (mobileTouchCapable && window.visualViewport && typeof window.visualViewport.addEventListener === "function") {
    window.visualViewport.addEventListener("resize", updateMobileChatComposerLayout);
    window.visualViewport.addEventListener("scroll", updateMobileChatComposerLayout);
  }

  options.servers = [{ addr: gateway, name: "대 미 덕 마크서버", hideAddress: true }];
  options.joinServer = gateway;
  options.relays = [];
  options.checkRelaysForUpdates = false;
  options.localesURI = "/game/lang-v2";
  options.lang = "ko_kr";
  options.autoJump = false;
  options.localStorageNamespace = storageNamespace;
  options.enableDownloadOfflineButton = false;
  options.openDebugConsoleOnLaunch = false;
  options.allowUpdateSvc = false;
  document.title = siteName + ", " + account;
  history.replaceState(null, "", window.location.pathname);
})();
