import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { root, work } from './common.mjs';

// Derive shared HUD and touch controls from the maintained portal implementation.
// The 26.2 client owns its chat input and compressed settings.
export async function buildPortalBridge262() {
  let source = await fs.readFile(path.join(root, 'public/game/portal-bridge.js'), 'utf8');
  function replaceOnce(before, after) {
    if (source.split(before).length !== 2) throw Error('Portal bridge anchor changed: ' + before.slice(0, 70));
    source = source.replace(before, after);
  }
  function replaceFunction(name, body) {
    const ast = ts.createSourceFile('bridge.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let match;
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
        if (match) throw Error('Ambiguous bridge function ' + name);
        match = node;
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    if (!match?.body) throw Error('Missing bridge function ' + name);
    source = source.slice(0, match.body.pos) + ' {\n' + body + '\n  }' + source.slice(match.body.end);
  }
  replaceOnce('var storageNamespace = "_spawnpoint_" + account.toLowerCase();', 'var storageNamespace = options.localStorageNamespace;');
  replaceOnce('if (touchRenderDevice) {\n    var cssPixelCount', 'if (false) {\n    var cssPixelCount');
  const start = source.indexOf('  var gameSettingsPreparation = Promise.resolve();');
  const end = source.indexOf('  // WASM-GC uses these hooks', start);
  if (start < 0 || end < 0) throw Error('Settings preparation anchor changed');
  source = source.slice(0, start) + '  var resourcePackManager = null;\n  window.__spawnpointPrepareClient = window.spawnpoint262SettingsReady;\n\n' + source.slice(end);
  replaceFunction('applySpawnpointGameSettings', '    return encodedGameSettings;');
  replaceFunction('dispatchRelayedBackquote', '    dispatchMinecraftKey("Escape", "Escape", 27, true);');
  replaceFunction('enableClientTextInput', '    return;');
  replaceFunction('installMobileChatComposer', '    return;');
  replaceFunction('showMobileChatComposer', '    return;');
  replaceFunction('openClientChat', '    if (currentScreenName) return false;\n    if (initialValue === "/") dispatchMinecraftKey("/", "Slash", 191, true);\n    else dispatchMinecraftKey("t", "KeyT", 84, true);\n    return true;');
  replaceFunction('installRuntimeKeyboardGuards', '    return;');
  const listenersStart = source.indexOf('  if (document.addEventListener) {\n    document.addEventListener("compositionstart"');
  const listenersEnd = source.indexOf('  installMobileTouchSupport();', listenersStart);
  if (listenersStart < 0 || listenersEnd < 0) throw Error('Native input listener boundary changed');
  source = source.slice(0, listenersStart) + source.slice(listenersEnd);
  replaceOnce('  if (typeof window.addEventListener === "function") {\n    backquoteEventNames.forEach', '  if (false) {\n    backquoteEventNames.forEach');
  replaceOnce('    var locatorWasReady = locatorScreenObserved;', `    var originalScreen = screenName;
    var simple = typeof screenName === "string" ? screenName.split(".").pop() : "";
    var aliases = { PauseScreen: "GuiIngameMenu", ChatScreen: "GuiChat", DeathScreen: "GuiGameOver", TitleScreen: "GuiMainMenu", JoinMultiplayerScreen: "GuiMultiplayer", ConnectScreen: "GuiConnecting", DisconnectedScreen: "GuiDisconnected" };
    screenName = aliases[simple] || screenName;
    window.__spawnpoint262.screen = originalScreen;
    var locatorWasReady = locatorScreenObserved;`);
  // The first-launch profile editor is still upstream. It must not navigate out.
  replaceOnce('if (typeof screenName === "string" && /GuiScreenEditProfile$/.test(screenName)) {', 'if (false) {');
  replaceOnce('  options.localesURI = "/game/lang-v2";', '  // Use the current-version language assets.');
  replaceOnce('  options.allowVoiceClient = true;', '  options.allowVoiceClient = false;');
  replaceOnce('  history.replaceState(null, "", window.location.pathname);', '  // Keep launch identity available to the 26.2 adapter.');
  await fs.writeFile(path.join(work, 'client-26.2/portal-bridge-26.2.js'), source);
}
