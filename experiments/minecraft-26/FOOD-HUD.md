# 26.2 food HUD experiment

This implements the AppleSkin-style food HUD, inventory tooltips and health prediction on the pinned o_xer 26.2 WASM, without
Fabric or a full game source build. It is opt-in for local verification. Normal
builds continue to use the published CDN client, which has no food hook.

## Build and verify

```sh
GAME_ASSETS_LOCAL=true node --input-type=module -e 'import {build262} from "./experiments/minecraft-26/build-26.2.mjs"; await build262()'
node experiments/minecraft-26/build-bridge.mjs
python3 tools/verify-food-hud.py --check-built
wasm-tools validate --features all work/minecraft-26/client-26.2/classes-spawnpoint.wasm
npm test -- tests/food-hud.test.ts
```

Without `--check-built`, the verifier checks and compiles a temporary patched
module, so it also works when the current build uses the production CDN.

Use the existing isolated 26.2 portal/server setup. The launcher must have a
normal authenticated `launch` query. The old standalone prototype has no account
locator API and is not a server-sync test. Match `MC26_PAPER_PORT` to the isolated
world's `server.properties`; this machine's existing portal-smoke fixture uses
25585. The normal server defaults to 25575.

Local builds use local EPK/WASM URLs and Brotli quality 4. This command neither
publishes assets nor edits `cdn-release.json`. Run normal `build262()` to restore
the CDN launcher after testing.

## Native boundary and server data

`patch-food-hud.py` runs after `patch-client.py`, including its native math
adaptations. It adds five mutable externref callbacks and changes four guarded
functions: 38284 (food HUD), 38283 (hearts), 1796 (container item tooltip), and
10357 (final tooltip position). Hooks run after coroutine-local restoration.
Body hashes and instruction anchors are pinned in the patch. The verifier
checks every other function and section, and rejects stale or duplicate patches.

The tooltip hook reads the hovered ItemStack's effective FOOD and CONSUMABLE
components directly from the native component map. It does not use held-item
server data or guess values from item names. The final tooltip layout supplies
its actual rectangle and current GUI width, including after a GUI scale change.
The extra panel sits below the native tooltip, or above it near the bottom edge.
Non-food and hidden tooltips cannot reuse a previous food's values.

The existing authenticated `/api/game/locator` response carries only the viewer's
food state. Paper reads saturation, exhaustion and each hand's effective FOOD and
CONSUMABLE components on the main thread, plus health, maximum health, natural
regeneration, and relevant active effects. Guaranteed regeneration from foods
such as golden apples contributes to the estimate. Harmful or uncertain health
consumption effects suppress the prediction. Recovery values are not a hard-coded
item table. Saturation is an absolute increment, capped by food level.

The browser draws AppleSkin saturation outlines, pulsing hunger/saturation
recovery and an exhaustion line in a small pointer-transparent canvas. It uses
native coordinates and derives current GUI scale from the native right edge.
A callback timeout hides it when F1, creative or a mount suppresses native hunger.
Menu transitions hide it immediately; server snapshots expire after one second.
A client/server food-level mismatch hides the overlay until synchronization.
Health prediction simulates resting food exhaustion, caps the result at maximum
health, and supports multiple heart rows. It batches tiny saturation increments
to avoid hanging on custom food values. Existing natural healing is not shown as
new healing from an ordinary held food. Peaceful difficulty and active poison,
wither, hunger or regeneration suppress the forecast. This estimates eventual
healing while resting, not healing time or damage during combat.

All three overlays have `pointer-events: none` and no focusable controls. Each
has an independent freshness timer. Tooltip display does not require the hunger
HUD to render in an inventory screen. Drawing failures stay inside JS callbacks.

## Limits

This is not full AppleSkin: status-effect tooltip previews and Fabric integration
are absent. Food tooltips currently cover native container/inventory tooltips. Hunger preview textures
are the pinned vanilla sprites; user resource-pack overrides and hunger-effect
variants are not mirrored. At zero saturation the native hunger icons can jitter;
the callbacks report the baseline, not each icon's random offset. The same
limitation applies to low-health heart jitter. Heart sprites use vanilla artwork. Offhand
preview indicates its food value, but does not predict whether an interactable
main-hand item or targeted block will consume the use action first. Network state
updates at the existing 200 ms interval, not every game tick.

The hook is deliberately not in the published asset pipeline yet. A production
release needs explicit inclusion of this patch in the asset source hash and
publish build, then a new immutable CDN release and portal deployment.

## Earlier basic HUD evidence, 2026-09-06

- Actual authenticated Paper 26.2 join and terrain rendering in Chromium.
- With bread held, the API returned food 10, saturation 0 and bread recovery
  nutrition 5, saturation 6. Native HUD coordinates placed the 81 by 12 canvas at
  CSS left 620, top 636, width 162, height 24 in the 1200 by 714 game viewport.
- Consuming one bread through native game input changed food 10 to 15 and
  saturation 0 to 6. Switching to a tool removed the food recovery preview.
- F1 hid both the native HUD and the overlay; toggling back restored the overlay.
- A temporary use-key binding was needed after the test window closed and
  Chromium rejected pointer lock. The saved binding was restored after the test.
- Full suite: 347 tests passed. After adding the local/publish exclusion guard,
  the food HUD and asset build suites passed all 9 targeted tests. Typecheck,
  frontend/server build and the modern Paper plugin build passed. The plugin
  retains its pre-existing deprecation warnings.
- `wasm-tools validate --features all`, V8 WebAssembly compilation and
  `tools/verify-food-hud.py` passed. The verifier's patched SHA-256 is
  `5eca3d24eaa607d804a2bd836794b4d341e576596ee7def826ab61d657eb8830`.

Screenshots are under ignored `output/playwright/food262-preview.png` and
`output/playwright/food262-verified.png`. This is desktop browser evidence, not
a tablet performance measurement or full AppleSkin validation.


## Tooltip and health verification, 2026-09-06

- A separate local Paper fixture avoided the already-running portal-smoke world.
  Native inventory hover showed bread nutrition 5 and saturation 6. A stick with
  custom FOOD and CONSUMABLE components showed nutrition 7 and saturation 3.5.
  Hovering a non-food item removed the panel. The actual tooltip's hit target was
  the underlying game canvas.
- At health 11.499998, food 15, saturation 6 and exhaustion 3.6000066, bread
  predicted health 20 and displayed four translucent hearts at the native heart
  row. Holding a tool hid them; bread restored them after server synchronization.
  Disabling natural regeneration hid them, and F1 hid both HUD canvases.
- Eating bread through native use input raised food to 20 and started healing.
  Resting then reached health 20, matching the prediction. Chromium pointer-lock
  rejection required a temporary use-key binding; the original settings were
  restored and reloaded afterward.
- A Chromium fixture covered a real button and canvas with all three visible
  overlays. Pointer-down, click and wheel reached the targets; none reached the
  overlays. This tests the browser input path, not mobile-device interaction.
- All 10 food HUD tests, TypeScript checks, modern Paper compilation and guarded
  WASM checks passed. The common CDN source-hash test failed because other current
  asset-source changes are not reflected in the published manifest; the other
  four asset-build tests passed. No CDN manifest was rewritten for this feature.
- Screenshots: `output/playwright/food262-tooltip.png` and
  `output/playwright/food262-health.png`. This remains a local opt-in build.
