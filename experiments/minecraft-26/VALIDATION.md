# Local validation, 2026-09-05

Environment: Apple M4 Mac, headed Chromium through Playwright, JDK 25. These are local development results. Neither the LG Gram nor Galaxy Tab S7 FE was connected for testing.

- Prepared every pinned artifact and expanded Paper without starting the server. Repeated preparation verified cached SHA-256 hashes successfully.
- Started Paper 26.2 build 121 and Velocity 3.5.1 with EaglerXServer 1.1.1, ViaVersion 5.11.0 and ViaBackwards 5.11.0. The 26.1.2 browser client joined through the HTTP WebSocket gateway and rendered fresh terrain.
- The Gram profile produced a 1200x714 canvas instead of 2400x1428 at the same CSS viewport. The tablet profile produced 1159x689, within the 800,000-pixel budget. Both launch with `finishOnSwap=false`.
- The in-game F3 display showed 60 FPS in a standing tablet-profile scene on the M4 at 42.5, 65, -17.5. Opening inventory showed 38 FPS with the default menu blur. These are individual screenshots, not average FPS, frame-time distributions or a controlled before/after benchmark. No target-device FPS claim follows from them.
- The seeded prototype server appeared in Multiplayer. Experimental touch overlay buttons opened inventory and hid the movement controls while a menu was open. Physical multi-touch, drag/look, long play, heat and memory behavior remain unverified.
- Synthetic 1.12.2 fixtures passed inventory, nested shulker items, enchantments, names/lore, book content, armor/offhand, wool variant, XP, source-hash, spawn reset, map-pixel, overwrite-refusal and version-refusal tests. The modern map-index codec returned a next map ID greater than the imported map IDs. A test caught an extra data wrapper in the first counter implementation; the corrected converter passed.
- Installed only synthetic fixtures into the stopped local sandbox. Player logged in at the configured new spawn with the expected items and XP. After a clean server save and shutdown, `--verify-player` passed for inventory, equipment, Ender Chest and XP. Paper's equivalent plain-text component serialization is normalized for comparison. The corrected map counter was installed while stopped.
- LAN mode rejected requests without the launch cookie, invalid Host headers, unauthenticated WebSocket upgrades and cross-origin WebSocket upgrades. Authenticated HTTP and same-origin WebSocket upgrades passed.
- Existing project checks passed: 304 tests in 28 files, TypeScript checks, legacy plugin build/tests and application build. A first test run needed `prepare:clients` to generate the ignored legacy HTML file in this new worktree; all tests passed after generation.
- `git diff --check` passed. No production deployment, world reset or account change occurred.

Local evidence is kept in ignored `work/minecraft-26/` (transfer-test.log, saved-player-verification.log, join-rehearsal-paper.log, tests.log, typecheck.log, plugin-build.log, build.log) and `output/playwright/minecraft-26/` (imported-inventory.png, tablet-profile-m4-fps.png).

## Held-item lighting follow-up

Added the small `SpawnpointTorchLight` Paper plugin and wired it into prototype preparation. It sends viewer-only light block changes; no Fabric mod or client source patch is required. The source uses one main-thread task at a four-tick interval, limits viewers to 48 blocks and sent chunks, skips out-of-height sources, merges overlapping sources by maximum light level, restores real block data after removal and clears viewer state on quit/disable.

In a closed, dark stone test room, the browser visibly lit the floor and walls when a torch was selected. Switching to an empty hotbar slot returned the same scene to darkness. Swapping the torch to the offhand kept it lit. Walking moved the light. `/torchlight off` darkened the scene while the torch remained held, and `/torchlight on` restored lighting. `execute if block` confirmed the source position remained server-side air. The existing upstream client startup warnings and pointer-lock errors remained; Paper reported no lighting-plugin errors.

The synthetic Player save was restored from the earlier inventory export after gameplay testing. The original production save and account data were never connected. Screenshots are in `output/playwright/minecraft-26/torch-{empty-hand,main-hand,offhand,removed,moving}.png`; server evidence is in `work/minecraft-26/torch-rehearsal-paper.log`.

Preparation/build, the migration tests, all 304 project tests, type checks, the legacy plugin build and application build passed again. Physical Gram/Tab FPS, multiple viewers and long sessions with moving lights remain unmeasured. Air-at-head-height and block-step motion are documented limitations.

The final plugin build was restarted and tested again after adding sent-chunk and world-height guards. Lighting was enabled after reconnect and worked in the dark room. The restored synthetic Player received 16 test torches in an empty slot, kept the imported equipment and XP, and was returned to the surface spawn. The test browser was closed so another device can join as Player. Final-build evidence is `output/playwright/minecraft-26/torch-final-build.png`.

## Performance and client-lighting follow-up, 2026-09-05

The earlier server-lighting implementation above is superseded. `build-client.mjs` now verifies the original client SHA-256 and checks each patch anchor before writing a separate generated client. `client-renderer.js` adds local-player terrain lighting in three terrain shader variants. The server light plugin source/build command is removed, and existing plugin jars are retired on prototype startup.

Verified in headed Chrome 152 on the Apple M4 Mac, with Paper and Velocity running on the same computer:

- Main-hand torch lights terrain, choosing an empty slot darkens it, and swapping 16 torches into the offhand restores light. The shader reads the real client inventory and player eye position. Screenshots: `client-torch-on.png`, `client-torch-off.png`, `client-torch-offhand.png` in `output/playwright/minecraft-26/`.
- Full-density 1200x714 CSS / 2400x1428 framebuffer starts at GUI scale 4, FOV 90 and six chunks. A 480x800 portrait viewport fits the inventory at scale 1. Moving back to a DPR 1 desktop uses scale 2 to preserve the same CSS size. Screenshots: `gui-portrait.png`, `gui-desktop.png`. Unit tests also cover the tablet pixel budget and a display-density change.
- Captured model-bake failures differed by about 1e-8 in coordinates that should identify the same corner. Before the tolerance patch, the captured performance-2 logs contain 260 vertex exceptions and thousands of stack-trace lines across two starts. Performance-3/4 logs contain zero matching vertex exceptions. Distinct vertices and nonfinite values remain non-matches in regression tests.
- The original music volume setting alone did not stop failed stream retries. The final build adds a guarded check in the music manager before opening a new muted stream. It retains active-track handling and allows playback after unmuting.
- The generated-client route now revalidates its ETag. A live HEAD returned 200 with `no-cache`, followed by 304 for the matching ETag. This avoids retaining an old client script after a rebuild.

The 60 FPS minimum and 120 FPS stretch target are **not achieved or claimed**. Measurements use intervals at the client's display-swap function, not a separate requestAnimationFrame loop. These short exploratory runs had changing positions/time and are not controlled A/B benchmarks. They used the native-resolution browser profile, FOV 90 and the local Java server. Music volume was zero and the visible-window AFK cap was disabled for the warm/moving runs. The final explicit muted-stream guard was added after these movement measurements, so its full gameplay performance remains unmeasured.

| Run | Duration | Mean FPS | p99 interval | Maximum interval | Pauses over 100 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Warm standing, standard server chunk rate | 32.09 s | 60.00 | 28.0 ms | 36.7 ms | 0 |
| Walking four directions, standard rate | 16.02 s | 56.44 | 50.0 ms | 249.5 ms | 3 |
| Fresh join, trial 25 chunks/s | 18.16 s | 36.84 | 140.3 ms | 2538.7 ms | 19 |
| Walking another area, trial 25 chunks/s | 16.07 s | 44.93 | 118.5 ms | 652.7 ms | 8 |

The send-rate experiment showed no demonstrated benefit and was removed. The runtime config is restored to the default 75 chunks/s. Profiling found WebGL error queries and the port's temporary-buffer allocation/address lookup/copy paths among the active CPU work. GPU buffer mapping and world chunk generation/rendering need deeper work; those paths were not bypassed or declared fixed. No Galaxy Tab S7 FE or Gram measurements were made.

Validation: six focused Node regression tests pass; generated JavaScript syntax checks, type checks and the application build pass. The full existing suite passed 303 tests and hit one 5-second timeout in the unrelated legacy `split-client-bundle` test while the game/server were active. Both tests in that file passed in an isolated rerun in 1.43 seconds. `git diff --check` passes. No production data, deployment, or inventory migration was performed in this follow-up.

Final `performance-5` check: music manager guard enabled, standard 75 chunks/s restored. A fresh browser launch compiled all three lighting shader variants, selected GUI scale 4, and produced zero vertex exceptions and zero music-stream attempts in the captured startup log. The final fresh gameplay join measured 48.36 mean FPS over 18.82 s, p99 99.2 ms, maximum 170.1 ms and nine pauses above 100 ms. This used the default sandbox Player identity at its saved location; no movement or item action was made on that login. It is a different view from the earlier PerfTest runs, so the smaller maximum is not evidence of a controlled speedup. The no-wait 60 FPS requirement still fails.

At the same final saved position, a 20-second full-density standing run averaged 40.86 FPS (p99 49.7 ms, max 88.6 ms, no pauses above 100 ms). A temporary diagnostic DPR 1.5 override gave 55.16 FPS at 1800x1071 (p99 25.6 ms, max 40.9 ms); DPR 1 gave 58.50 FPS at 1200x714 (p99 27.3 ms, max 33.2 ms). Both reduced-resolution runs had no pauses above 100 ms. These were sequential runs with the same local server, not proof of a guaranteed minimum. The overrides existed only in the test browser. The launcher keeps full density for `native` and the existing smaller pixel budgets for performance profiles.

The client rejected simulation distance 4 because its slider range begins at 5. The launch default is corrected to 5 and covered by a regression test. Paper still simulates four chunks.


## 2026-09-05: actual 26.2 browser client

- Installed hash-pinned 26.2 0.5-dev Wasm port credited to o_xer from eymenwsmc.site/262. Embedded version JSON reports id/name 26.2; options version is 4903; menu shows Minecraft Java Edition and Eaglercraft 26.2 0.5-dev.
- Headed Chrome reached the menu, connected through EaglerX to the existing local Paper 26.2 sandbox, and rendered terrain. Paper logged YeeishYeeg5626 joining at 17:29:01 KST. This was a newly generated test identity; no production player was used.
- Screenshot: output/playwright/minecraft-26/java262-join.png. Its displayed 60 FPS is a point observation, not evidence of sustained 60 or 120 FPS. Server and proxy were running on the same Mac.
- Fixed the port forcing wss:// on the HTTP local gateway with a narrowly scoped same-host adapter. No remote endpoint downgrade.
- Reload verified compressed options fov:0.5 (90), guiScale:2 at render DPR 1, inactivityFpsLimit:minimized, music volume zero. Native-DPR GUI 4 and small-screen constraints covered by focused tests. Upstream Fast preset changes requested view distance six to four.
- The new build does not run the previous JS client-lighting patch. Dynamic held-torch lighting and live GUI resize need a new Wasm implementation. No server lighting enabled.
- Two focused 26.2 tests passed; startup syntax and git diff checks passed. Existing migration tools unchanged.

- Final saved adapter (no console override) reloaded successfully and automatically rejoined at 17:34:12 after the profile screen. Final screenshot: output/playwright/minecraft-26/java262-final-game.png. Eight combined client tests and TypeScript checks passed.

## 2026-09-05: isolated production-data migration preview

- Production was idle before and after the snapshot. All 46 source player-file hashes matched across the copy. SQLite backup copied 57 active accounts without changing the original database. Every saved player UUID maps to an existing account game name.
- Generated a separate Paper 26.2 world and verified solid ground plus two air blocks at spawn (-96, 76, 32). Converted 46 players and 5,873 items to DataVersion 4903, retaining inventory, equipment, Ender Chest and XP while resetting position to spawn. No legacy terrain or old respawn locations were packaged. There were zero legacy maps.
- The private preview package contains 109 hashed files. Uploaded only to the separate preview-26 volume. The installer refuses existing runtime/database paths and leaves the public service in maintenance until hashes are checked and installation completes.
- Passed all 304 existing application tests, type checks, legacy plugin build, full application build, nine focused client/authentication tests, Velocity identity-plugin compilation and synthetic inventory conversion tests. These checks do not prove a cloud gameplay join.
- Railway build logs stopped at image push, but deploymentEvents later identified the actual failure as MIGRATE_VOLUMES. A second build failed during the upstream Paperclip download. The builder then timed out connecting to Mojang. Added bounded preparation retries, a SHA-256-pinned optional Mojang build cache, and explicitly created a Singapore volume after discovering that CLI-created volumes had defaulted to us-west2 regardless of the running service region. The unused failed-migration volume was detached; the verified local package remains the source of truth. A sanitized upload contained source and the verified Mojang jar only, with no account database or world files. No production service was deployed by this task.

- First live browser join exposed a Velocity listener registration failure caused by a default-package class name. That join created an empty QA player instead of using the account inventory; the 46 migrated records stayed untouched. Closed preview access, placed the plugin in a Java package, and added an explicit identity-ready gate to health and WebSocket handling. An isolated real Velocity startup then registered the listeners successfully.
- Archive extraction exposed macOS AppleDouble sidecar files; the installer correctly refused the unexpected player-file count before making changes. Removed only incoming `._*` metadata, reran all hashes, and installed 46 players. Future macOS packaging must use `COPYFILE_DISABLE=1 tar --no-xattrs ...`.

- Final Railway deployment `426a76bf-5012-438d-a409-da011086a793` reached SUCCESS on the explicitly created Singapore volume. Public `/healthz` reports Minecraft 26.2 and server online after both Java processes and identity listeners are ready. Production public health also returned 200 with its server online; this task did not deploy main.
- Headed Chrome connected over public HTTPS/WSS with a short-lived owner-created QA session for one copied account. The browser profile had a different random name, but Velocity and Paper used the copied account game name and expected offline UUID. Paper logged the actual spawn as (-95.5, 76, 32.5). The screenshot `output/playwright/minecraft-26/cloud-262-migrated-inventory.png` shows carried items, armor, offhand and XP in the fresh terrain. No movement, item use or inventory change was made.
- After disconnect, downloaded the real server save, confirmed that it differed from the original export, and passed InventoryVerify for inventory, equipment, Ender Chest, XP and Score. This representative account contains 761 items. Before that join, all 46 migrated player-file hashes still matched their export. The erroneous empty QA save was moved out of active player data.
- Public requests without authentication received 401 for session/client/assets. Wrong credentials returned 401, cross-origin login returned 403, and unauthenticated or cross-origin WebSocket upgrades were rejected. Authenticated session/launcher requests passed. Existing-password verification was covered by the synthetic authentication test; no real user's password was obtained or changed for live QA.
- Removed temporary remote QA session files and the task-specific Railway SSH key. The failed-migration volume was detached and deleted after the correct volume was online. Private source backups remain available. Preview gameplay progress is separate from production and must not silently replace newer main inventories at promotion.
