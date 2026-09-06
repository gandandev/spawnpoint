# Minecraft 26 browser prototype

This is an isolated experiment, not a production upgrade. The default launcher now runs **Java Edition 26.2**, using o_xer's **26.2 0.5-dev Wasm-GC browser port** with Paper 26.2 build 121. The old 26.1.2 JavaScript client remains at `/game` only for comparison. The default client no longer needs 26.1.2-to-26.2 content replacement. This is a community development port, not Mojang's desktop executable.

The existing 1.12 service, accounts, plugin and worlds are untouched. The prototype has a new local world and offline test identities. Do not connect the existing portal's inventory editor: it writes the old item format and old player-data path.

## Run

Use Node 22.20+ and JDK 25. Set `JAVA_HOME`, or `MC26_JAVA` and `MC26_JAVAC`, if needed.

```sh
npm ci
npm run prototype:26:prepare
# After accepting https://aka.ms/MinecraftEULA:
MC_EULA=true npm run prototype:26
```

Preparation downloads hash-pinned artifacts to ignored `work/minecraft-26/`, expands Paper and compiles the offline converter. The browser download alone is about 402 MB before browser caching. Preparation does not accept the EULA, create a world or modify production data. A changed upstream artifact fails its checksum instead of silently replacing the pinned build.

Wait for `Done` in both `work/minecraft-26/paper.log` and `proxy.log`, then open <http://127.0.0.1:4262>. Select a Java 26.2 device profile, complete the initial client screens, then select Multiplayer → Direct Connection. Keep the EaglerX connection mode and use the gateway address below. If the list is empty, use Direct Connection with `ws://127.0.0.1:4262/gateway`.

Enter `paper <command>` or `proxy <command>` in the start terminal to use either local console. Enter `stop`, or press Ctrl+C, to save and stop both servers. Starting again reuses this sandbox world; it does not reset a world on every launch. The sandbox uses Peaceful difficulty for repeatable testing.

For a tablet or Gram on the same trusted network:

```sh
npm run prototype:26 -- --lan
```

Open the LAN launch link printed in the terminal on each device. Its temporary token creates a browser cookie; an unauthenticated HTTP or WebSocket request is rejected. The Java server and Velocity ports remain on loopback. This HTTP development mode is for a trusted LAN, not internet hosting. It is separate from Spawnpoint account authentication.

## Performance and controls

Held-item lighting runs entirely in the browser's terrain vertex shaders. Main hand and offhand torches, copper torches, lanterns and soul variants add distance-based block light around the local player's eye position. Existing skylight and placed-block light remain the minimum. There are no light-block packets, world writes, relighting jobs or chunk rebuilds from this feature. The previous `SpawnpointTorchLight.jar` is renamed to `.jar.disabled` when an existing sandbox starts.

This is a local-player terrain effect. It does not illuminate entities, add shadows, simulate light occlusion through walls, or display another player's held light. It also works underwater. Those are current limits of the inexpensive shader implementation. Set `window.__prototype26.lighting = false` in the browser console to compare with lighting disabled.

`npm run prototype:26:client` rebuilds a separate `classes-patched.js` from the hash-pinned original. Starting or preparing the prototype also rebuilds it. Every generated-code anchor must match exactly once. Changes include a model-vertex comparison that tolerates observed float arithmetic drift of roughly 1e-8, eliminating the repeated `Can't find vertex to swap` model-bake exceptions without swallowing unrelated failures.

The retained 26.1.2 comparison profiles start with FOV 90, a 120 FPS cap, Fast graphics, clouds and entity shadows off, no ambient occlusion or biome blending, and deferred chunk updates. Client view distance starts at six chunks, or four on the tablet. The client simulation setting uses its supported minimum of five; the server sends six and simulates four. A trial at 25 outgoing chunks per second did not demonstrate a fresh-join improvement, so the standard 75 rate is retained. The current port repeatedly retries failed music streams, so music starts muted and the music manager skips opening new streams while muted; effect volumes remain unchanged. The AFK 30 FPS cap is disabled while the window is visible; minimized windows can still throttle. These are launch defaults, not FPS guarantees. Video controls can still be changed during play.

The Gram profile limits rendering to about 1.024 million pixels. The tablet profile limits it to 800,000 pixels. Both cap pixel density at 1. The `native` profile retains full browser pixel density for a sharper image. All profiles disable the per-frame GPU completion wait. `native` names a browser resolution profile, not an installed Minecraft app.

GUI scale is automatic at each game resize. It targets the MacBook's scale 4 at DPR 2, using approximately two CSS pixels per GUI pixel, with an integer scale and a minimum usable 320 by 240 GUI area. Lower framebuffer resolutions use a smaller scale number to retain a similar apparent size. Very small portrait displays prioritize fitting the menus.

For frame measurements, call `window.__prototype26.startMeasurement()` and later `window.__prototype26.stopMeasurement()`. The bounded buffer records intervals at the client's actual display-swap path, not an independent animation callback. Results include mean FPS, p95/p99 frame intervals, the longest interval and pauses over 100 ms. Keep the game focused with no menus open. Compare both a fresh join and movement after joining. Hosting Paper and Velocity on the same Mac consumes resources, so do not equate these results with a native-game benchmark on an otherwise idle computer.

Fabulously Optimized is a useful reference, but its `.jar` mods cannot load into this compiled TeaVM JavaScript client. Sodium replaces chunk rendering, Entity Culling skips hidden entities, and ImmediatelyFast batches drawing. Adopting those implementations requires a compatible source build, browser graphics changes and new correctness/performance tests. None of those mods is installed or claimed here.

Touch controls provide movement, drag to look, jump, crouch, attack, use, inventory, Escape and hotbar selection. Menus use touch mouse events. These are experimental controls, not a verified Galaxy Tab test. The current public client also has upstream audio problems. No 60/120 FPS target is claimed until measured on the actual devices.

For a fair comparison, use the same location, direction, time of day, window size, render distance and video settings in both profiles. Warm up chunk rendering, then record at least 60 seconds standing still and 60 seconds walking through terrain. Use the in-game F3 FPS display, not a JavaScript animation callback count. Record frame dips, heat and memory pressure as well as the average. Developer-machine screenshots are not device benchmarks.

## Reset terrain while preserving carried items

The converter supports vanilla-compatible **1.12.2, DataVersion 1343**, to this pinned **26.2** build. It uses Paper's own player data converter, then copies only the fields needed for carried items and XP. It exports a new directory, never overwrites an existing directory and never installs anything into a server.

Preserved: inventory/hotbar, armor, offhand, Ender Chest, selected slot, XP and score. Item conversion includes legacy item variants, durability, enchantments, names/lore, written books and nested shulker contents. Filled-map files and their ID counter move to the modern data paths. Old map pixels describe the old terrain and can update when explored in the new world.

Reset: all terrain in all three dimensions, placed blocks and chest contents, old location/bed/vehicle, health/hunger, effects, game mode, advancements and statistics. Put items from ordinary chests into inventory, shulker boxes or the Ender Chest **before** the final backup. Plugin-managed inventories or custom mod items need a separate rehearsal.

1. Stop the old service cleanly after players have logged out. Back up the entire persistent volume, including all worlds, account database and plugin files. Keep an untouched rollback copy. Never run this against a live save.
2. Create a separate 26.2 world with the desired seed. Visit and prepare a safe arrival point with solid ground and two clear blocks above it. Run `setworldspawn X Y Z` there, then stop the new server cleanly. The converter uses that exact configured spawn, it cannot inspect terrain or find a safe position by itself.
3. Export from the stopped backup and stopped fresh world:

   ```sh
   npm run prototype:26:transfer -- \
     --old-world /absolute/backup/world \
     --fresh-world /absolute/new-server/world \
     --output /absolute/new-transfer-directory
   ```

4. Require a completed `transfer-report.json`, then check the player UUID list, item totals and XP. Keep the same game usernames, case, UUID calculation and login identity mapping. Preserve the portal's account database separately; this tool does not move accounts. Changing offline/online UUID handling can make an intact inventory appear missing.
5. While the new server is stopped, copy the export's `world/players/data/*.dat` into its `world/players/data/`, and merge the exported `world/data/` map files into its `world/data/`. Back up any existing files first. Do not copy old `level.dat`, region files, dimension folders or old raw player files. Do not leave test players or test maps with conflicting UUIDs/IDs in the destination.
6. Start only the rehearsal server. Log in as each real identity and check inventory, armor/offhand, Ender Chest, named/enchanted item data, nested contents, maps and XP. Save, stop, restart and check again. Compare against the backup, not just the item-total report. Only cut over production after this rehearsal and the modern portal/plugin changes pass. Roll back with the complete old backup if needed.

The export paths use Paper 26.2's new layout. In particular, player data is `world/players/data/`, not the old `world/playerdata/`. Maps live under `world/data/minecraft/maps/`. Terrain remains entirely from the new 26.2 world.

```sh
npm run prototype:26:test
```

This creates synthetic legacy fixtures and verifies conversion, nested items, names, books, equipment, maps/counters, XP, source hashes, position reset and refusal to overwrite. It is not a test of your actual world backup. Logs and fixtures remain under `work/minecraft-26/` for inspection.

After a rehearsal login and a clean stop, compare each exported player file with the server's saved file:

```sh
npm run prototype:26:transfer -- \
  --expected /absolute/export/world/players/data/UUID.dat \
  --verify-player /absolute/new-server/world/players/data/UUID.dat
```

This checks inventory, equipment, Ender Chest and XP. It allows Paper's equivalent plain-text serialization, such as `{text:"name"}` becoming `"name"`. Do not move, consume or drop items before this comparison. An intentional change will fail it.

## Sources and remaining production work

- [Browser distribution credited to q13x](https://github.com/ghjjhghj/Eaglercraft-26.1.2), an upstream proof of concept; assets are downloaded locally, not committed here.
- [Paper downloads](https://papermc.io/downloads/paper) and [Paper getting started](https://docs.papermc.io/paper/getting-started/).
- [EaglerXServer](https://github.com/lax1dude/eaglerxserver), [ViaVersion](https://github.com/ViaVersion/ViaVersion), [ViaBackwards](https://github.com/ViaVersion/ViaBackwards).
- [Fabulously Optimized mod list](https://github.com/Fabulously-Optimized/fabulously-optimized/blob/main/INCLUDED-MODS.md), [Sodium](https://github.com/CaffeineMC/sodium), [ImmediatelyFast](https://github.com/RaphiMC/ImmediatelyFast), [Entity Culling](https://github.com/tr7zw/EntityCulling).

Production still needs a validated stable 26.2 browser build, physical device testing, account-authenticated routing, a modern Spawnpoint plugin, modern admin inventory handling, and a real-volume inventory rehearsal. The existing plugin contains 1.12-specific materials and server internals, so it must not be dropped into this server unchanged.

## Java Edition 26.2 browser replacement (2026-09-05)

The launcher defaults to `/262/`. `artifacts-26.2.json` pins the mirrored upstream HTML, Wasm images, runtime, decoder and assets by SHA-256. `prepare.mjs` downloads them; `build-26.2.mjs` verifies every file, creates a local launcher without the mirror analytics script, and provides the uncompressed Wasm fallback. Both preparation and startup build the launcher. No upstream game bytes or assets are committed. Source: <https://eymenwsmc.site/262/> (credits o_xer).

The new runtime uses its own chunk mesh workers and separate browser storage (`_spawnpoint262`), so old browser settings and singleplayer worlds are not overwritten. Existing server player files and terrain remain untouched; use the same player name to reconnect to an existing offline sandbox identity. The inventory migration tools above are unchanged.

`profile-26.2.js` seeds compressed 26.2 options before main starts: FOV 90, Fast graphics, clouds off, minimized-only idle limit, music volume zero. Each launch sets `enableVsync:true` and `maxFps:260`, which is Minecraft 26.2's unlimited sentinel rather than a 260 FPS ceiling. Browser presentation follows the active display without our previous fixed 60/120 FPS cap. Other saved preferences are preserved. GUI scale is chosen at each launch from viewport size and render density: native DPR 2 maps to 4, DPR 1 to 2, constrained by the minimum GUI size. This is launch-time sizing; live resize handling is not yet ported. Upstream Fast preset clamps view distance back to four in the observed run, despite a requested six for desktop. Music can still emit an empty sound-event warning.

The new client forces typed WebSocket URLs to WSS. The local adapter corrects only `/gateway` on the exact current HTTP host to WS; other hosts and HTTPS launches remain unchanged. Browser runtime and server logs confirmed a successful Java 26.2 multiplayer join and terrain rendering. A displayed 60 FPS screenshot is not a sustained FPS benchmark.

**Compatibility limit:** the older JS model/muting hooks, actual-frame measurement hook and client torch shader described above belong to the retained 26.1.2 comparison client. They are not applied to the new Wasm runtime. Held-torch dynamic lighting on 26.2 is pending. No server lighting plugin is installed or enabled. Target-device 60/120 FPS and live GUI resize remain unverified.

Validation: `node --test experiments/minecraft-26/client-26.2.test.mjs` covers compressed option persistence, subsequent user preferences, GUI sizing, and exact-host WebSocket rewriting.
