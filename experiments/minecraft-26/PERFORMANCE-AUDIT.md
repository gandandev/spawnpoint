# 26.2 browser performance audit, 2026-09-06

The browser runs a pinned TeaVM Wasm-GC build, not a Fabric JVM. A Fabric JAR cannot patch this binary. The following table distinguishes comparable changes from ports. No Sodium, Voxy, or Distant Horizons installation is claimed.

The initial [Fabulously Optimized list](https://github.com/Fabulously-Optimized/fabulously-optimized/blob/main/INCLUDED-MODS.md) review used a 26.1.2 web snapshot. The local Prism installation has since verified FO 14.0.0-beta.2 for 26.2; see SOURCE-BUILD.md for exact installed versions. Its performance entries were reviewed individually:

| Mod | Mechanism | This browser build |
| --- | --- | --- |
| Sodium | Replaces terrain rendering and mesh submission. | Existing separate mesh workers retained. A renderer replacement requires source-level integration; not ported. |
| Better Block Entities | Batches block entity rendering. | Not ported. Must preserve animated chests and signs. |
| Dynamic FPS | Reduces background rendering. | Native minimized FPS limit and hidden-tab player-state polling suspension retained. No active-play FPS reduction. |
| Entity Culling | Asynchronously checks visibility behind walls. | Not ported. Browser occlusion work must be profiled before adding workers. |
| FastQuit | Saves singleplayer worlds after returning to the menu. | Not needed for remote multiplayer. Native disconnect returns to the portal. |
| FerriteCore | Shares repeated model/state data to reduce memory. | Existing worker model-table sharing retained. JVM object-layout patches do not apply directly. |
| ImmediatelyFast | Batches immediate rendering and reduces state overhead. | Held-light uniform uploads now occur only when values change. This is a narrow analogous optimization, not the mod's batching renderer. |
| Ixeris | Improves camera-motion frame pacing. | Not ported; input focus fixed independently. |
| Language Reload | Reloads language resources without a full reload. | Not ported. Korean and Galmuri11 ship in the base asset bundle. |
| Lithium | Optimizes simulation and chunk operations. | Not installed on Paper or in the client. Server simulation remains separate. |
| ModernFix-mVUS | Reduces startup work and memory. | Unused integrated-server Wasm download/compilation removed from managed play; client compilation overlaps server boot. No JVM mixins claimed. |
| Remove Reloading Screen | Reloads resource packs in the background. | Extra texture pack removed, so that reload is unnecessary. |

Older entries: Better Beds/FastChest/Enhanced Block Entities overlap the block-entity work above; Hydrogen overlaps model-memory work; LazyDFU defers data conversion; No Fade removes reload transitions; Smooth Boot manages startup contention; Phosphor/Starlight replace light propagation. None is blindly inserted into modern Wasm. Dynamic held light remains client-side and does not change server light propagation.

Primary implementation references: [Sodium](https://github.com/CaffeineMC/sodium), [ImmediatelyFast](https://github.com/RaphiMC/ImmediatelyFast), [EntityCulling](https://github.com/tr7zw/EntityCulling), [FerriteCore](https://github.com/malte0811/FerriteCore), [Lithium](https://github.com/CaffeineMC/lithium), [Dynamic FPS](https://github.com/juliand665/Dynamic-FPS), [LanguageReload](https://github.com/Jerozgen/LanguageReload), [FastQuit](https://github.com/contariaa/FastQuit), [RRLS](https://github.com/dima-dencep/rrls).

## Native Wasm arithmetic, 2026-09-06

The current change applies the narrower principle of eliminating repeated CPU
and host-call overhead. It does **not** install or reproduce all FO mods.
`patch-client.py` now applies `native-math.py` before the existing screen patches.
The asset build also patches the mesh worker, without overwriting either pinned
upstream input. The normal CDN loader keeps its logical `mesh-worker.wasm.br` key
but packages the optimized worker. Local launchers request the optimized worker
explicitly. The food HUD remains a separate local-only hook.

| Module | Math.floor calls | Math.ceil calls | Math.sqrt calls | Total static sites |
| --- | ---: | ---: | ---: | ---: |
| Main client | 1,816 | 615 | 309 | 2,740 |
| Mesh worker | 47 | 52 | 5 | 104 |

Each decoded `call` to the actual `(f64) -> f64` `teavmMath` import becomes its
native `f64.floor`, `f64.ceil`, or `f64.sqrt` instruction followed by `nop`.
The TeaVM runtime supplies JavaScript `Math` for these imports. This eliminates
those calls without approximating arithmetic or changing draw order, geometry,
animation, view distance, or server simulation. Static call-site counts are not
the number of calls executed each frame.

`native-math.json` pins input and output SHA-256 values and instruction offsets.
The patch fails on a different input or a second application. Function indices,
body sizes, and metadata remain unchanged by the math pass. To audit the manifest,
`python3 tools/verify-wasm-native-math.py` independently decodes the pinned inputs
with `wasm-tools dump`, checks every targeted import and call, verifies that all
other bytes remain identical, and validates/compiles both results with wasm-tools
and V8. Do not regenerate offsets with raw byte searches: call-like bytes can
occur inside constants and data.

`python3 tools/verify-wasm-math.py` tests the actual opcode definitions against
JavaScript Math imports. It compares 150,111 results, including signed zero,
infinities, subnormals, adjacent large integers, NaNs, and 50,000 seeded random
64-bit patterns. Non-NaNs must match with `Object.is`; NaN payload bits are not a
contract of this check. Its warmed, alternating synthetic arithmetic benchmark
is a kernel benchmark, not an FPS or world-generation benchmark.

The other FO changes remain scoped as follows:

- Sodium, ImmediatelyFast batching, BBE, Entity Culling and MoreCulling require
  renderer/mesh/visibility lifecycle changes. A matching, working source build
  has not been established; deleting render calls in the binary is not a port.
- Lithium's server simulation changes would have to run on the server, while
  FerriteCore's object sharing needs confirmed object layouts and ownership.
  Neither is supplied by this arithmetic patch.
- Dynamic FPS already has a minimized-window limiter; mouse movement already
  accumulates deltas. Ixeris's Windows raw-input JNI path does not apply here.
- FastQuit addresses an integrated server, which managed multiplayer does not
  run. Language Reload and RRLS do not improve active-play FPS. Partial language
  reload needs complete cache invalidation before it can safely be adopted.
- Sodium Extra trades optional visual work for speed. This change preserves the
  existing visual settings rather than disabling more rendering features.

For an estimate, use the measured fraction of CPU time spent in these operations,
not the number of static patch sites. If that fraction is `p` and the isolated
kernel speedup is `s`, the ideal CPU-bound speedup is `1 / (1 - p + p / s)`.
For `s = 3`, assumed fractions of 1%, 5%, and 10% give roughly 0.7%, 3.4%, and
7.1% improvements. These are conditional scenarios, not measured workload
fractions. GPU-limited or display-limited gameplay may show no FPS increase.

The local arithmetic run measured median 27.780 ms for host imports and 8.676 ms
for native instructions, a 3.20x kernel speedup. All 150,111 comparisons passed.
The browser joined the local Paper world and rendered with the patched main
module and mesh worker; inventory open/close also passed after reconnect.
Thirty-second stationary windows recorded 60.00 FPS
before, 58.24 FPS after, and 56.16 FPS after returning to the original arithmetic.
These windows are not a controlled performance comparison: concurrent local
work changed the food-HUD runtime between reloads, and machine load varied.
They establish a working browser launch, not a gain or regression. No total FPS
improvement is claimed. The conditional 0.7–7.1% CPU-bound scenarios above remain
estimates; the renderer allocation saving has not been timed separately.

The asset release `r-fbb940ad1bb52555` contains the patched main and mesh modules.
All six CDN objects passed decoded SHA-256, MIME and CORS checks. The published
main digest also matches the complete production patch output, and the mesh
digest matches the native-math manifest. The default CDN build, 357 application
tests, type checks, plugin build and application build passed. This prepared a
separate immutable asset release; the operating Railway portal was not deployed.

### Reuse render-layer values inside the section loop

The same change also applies Lithium's enum-array reuse principle to the pinned
terrain renderer. Function 37669 (`LevelRenderer.prepareChunkRenders`) first
initializes the three render layers, then calls function 37995
(`ChunkSectionLayer.values()`) inside the visible-section loop. That method
creates a fresh array wrapper and copies the three enum references each time.
The loop only reads those references.

At body offset `0x1420`, `call 37995` is replaced by `global.get 14531; nop`.
The caller's whole-body SHA-256 is checked before applying the four-byte change.
The earlier initialization, null checks, layer order, and all subsequent draw
logic remain intact. `values()` itself still returns a fresh array everywhere
else. This removes one short array copy/allocation per section visited in this
loop, not per world chunk or server tick. For example, 200 visited sections at
60 frames/second would avoid 12,000 copies/second; that is a workload example,
not the measured section count of the browser check.

`python3 tools/verify-wasm-enum-cache.py` checks the actual production patch,
rejects stale/duplicate bodies, validates/compiles the module, and checks the
read-only sharing rule with Wasm GC types. This small allocation change does not
implement Lithium's simulation optimizations or Sodium's terrain renderer.

## Distant terrain (removed 2026-09-06)

The surface LOD experiment was removed after visible coarse geometry appeared too close to the player. Its worker, client fetch loop, API and server sampling were removed together. Server view distance was not increased. The following describes the rejected experiment, not the current renderer.

Voxy and Distant Horizons simplify distant geometry, not merely textures. Voxy's [capability checks](https://github.com/MCRcortex/voxy/blob/dev/src/main/java/me/cortex/voxy/client/core/gl/Capabilities.java) use desktop OpenGL compute/SSBO/indirect APIs unavailable in this WebGL2 renderer. [Distant Horizons](https://gitlab.com/distant-horizons-team/distant-horizons) also needs its terrain storage, generation, and rendering pipeline. Neither runs as a drop-in browser mod. The removed browser experiment had a bounded surface LOD implementation: loaded chunks are sampled at four-block intervals, meshed in a separate Worker, and retained in IndexedDB. It uses the native camera uniform blocks and depth buffer. It stores at most 256 tiles on tablets and 512 on other profiles. It does not generate chunks or model caves and overhangs, and it is not a Voxy/DH binary port. Mipmaps are the existing mechanism for lower-resolution distant textures; they must not be reported as a Voxy/DH port.

## Binary safety and evidence

`patch-client.py` checks pinned function identities and changes screen routing. The failed head-skin cache lookup patch has been removed. It uses the existing JavaScript string builtin directly, avoiding a new asynchronous TeaVM call in the screen state machine. Native chat uses per-player bitmap glyphs generated from portal face and hat pixels. They are loaded with the normal assets at launch; a reconnect refreshes changed skins. Validate with `wasm-tools validate --features all` because this artifact uses legacy exception handling.

Do not claim a universal 60/120 FPS gain from build success. Test keyboard input, native menus, reconnect, fonts, skins, and frame pacing in the actual browser after each binary change. A full optimizing rewrite of the 102 MB module is not treated as safe without compatible GC/exception support and measured playback results.

## Local validation of surface LOD and chat heads

- Native chat screenshot: `output/playwright/minecraft-26/portal-head-glyph.png`. The portal Steve face replaces the previous unrelated default face. Face/hat compositing has a pixel test.
- On/off screenshots: `output/playwright/minecraft-26/lod-first-on.png` and `lod-first-off.png`. Retained terrain is visible beyond the native fog range.
- Same-scene RAF pacing, local Paper running on this Mac: four alternating 5-second windows, LOD off/on/off/on. Means 59.998 / 60.001 / 60.000 / 60.000 FPS; p95 18.5 ms, p99 18.6 ms; no intervals above 50 ms. Native HUD also showed 60 FPS. This is a stationary 20-second check, not a Gram/Tab S7 FE or new-chunk traversal benchmark.
- The measured scene retained 121 tiles and submitted 26,838 LOD vertices. Meshing runs in a Worker; unchanged tiles do not cause repeated geometry uploads.
- Server terrain sampling shares a nominal 3 ms budget per tick across requests, checks only loaded chunks, and caps each response at 32 tiles. A single block read can overrun the deadline; this is a time budget, not a real-time guarantee.
- Known scope: height-field surface representation only; no caves/overhang geometry. The renderer shares the native terrain pass. No claim of installing the original Voxy, Distant Horizons, or Fabric mods.

## FO reimplementation: render-state cache (2026-09-06)

`render-state-26.2.js` removes redundant WebGL2 state commands before the native
browser driver call. It caches texture bindings per unit, element buffers per VAO,
uniform buffer bindings (including the generic-binding side effect), integer sampler
uniforms, and blend/depth/raster state. It preserves draw order and all geometry.
Deletion, program relinking, context restoration and diagnostic toggles invalidate
cached state. The module must load before the dynamic-light wrappers so their
saved method references also pass through the cache.

Four alternating off/on/off/on windows of 240 RAF intervals on this Mac with local
Paper running produced mean 16.666 ms, p99 <= 16.8 ms, and no >50 ms intervals.
In the first pair, driver bindBuffer calls fell from 85,077 to 10,923; VAO bindings
from 50,232 to 4,418; integer uniform updates from 25,788 to 2,202. The cache skipped
293,106 of 436,910 state commands (67.1%). Native draws remained essentially equal.
These are instrumented stationary-scene measurements, not proof of higher FPS or
performance parity with FO. The display was capped at 60 Hz. Screenshots:
`output/playwright/minecraft-26/fo-state-on.png` and `fo-state-off.png`.

A six-second spectator flight with the cache enabled also measured mean 16.666 ms,
p99 16.8 ms and zero >50 ms intervals; this is not a long new-world traversal test.

Five transition tests cover aliases, texture units/VAOs, indexed binding side effects,
uniform resets, deletion, context restoration and A/B toggles. A diagnostic toggle is
`window.__spawnpoint262.renderState.enabled`; calls/skipped are cumulative counters.

### Source acquisition update

Prism supplied the actual Java 26.2 JAR and FO 26.2 mod binaries. Readable Java
has been recovered locally; the now-removed extraction tool recorded the input
hashes. The findings remain in SOURCE-BUILD.md. A separate 26.1.2 browser platform candidate now compiles its
Java adapter against 26.2 after a constructor update. The exact source of the
pinned production WASM is still unverified, but source acquisition no longer
requires user input. See SOURCE-BUILD.md for build evidence and remaining
Wasm-GC/runtime porting work. No production renderer replacement is claimed.

## Rejected renderer and binary experiments, 2026-09-06

These experiments were tested locally and were **not deployed**. Production keeps
its existing render-state cache and the original patched TeaVM binary. The coarse
surface LOD removal above is the production change from this investigation.

A WebGL2 `WEBGL_multi_draw` prototype grouped up to 64 native terrain draws. It
validated the complete sequential quad-index range, retained sorted/unsupported
geometry on the native path, shared model matrices and texture dimensions, and
uploaded only per-chunk positions and visibility. Index buffers were cached with
an 8 MiB/64-entry bound. Uniform/resource changes, other draws and state changes
flushed the queue. Per-chunk attribute updates were deferred and temporary draw
records were reused. Eleven transition tests passed, including sorted indices,
uniform mutation, shader rejection, different matrices, cache eviction and context
loss. The actual world rendered with the prototype and native fallback.

At the fixed local spectator position, a four-second window grouped 23,760 terrain
draws into 720 multi-draw calls with zero new index uploads after warmup. This
large command reduction did **not** produce a clear CPU improvement. Four final
alternating off/on/off/on windows each presented 240 frames, with mean intervals
16.65–16.67 ms, p99 20.9–21.4 ms and no intervals above 50 ms. CDP ScriptDuration
was 0.835 / 0.837 / 0.873 / 0.885 seconds; TaskDuration was 0.907 / 0.918 / 0.951 /
0.965 seconds. The first broader shader version had also shown a single >50 ms
interval in an earlier window. It was not a consistent performance win.

A separate VAO attribute-enable/divisor cache removed roughly 115,000 additional
state calls per four-second window. Its six state-transition tests passed, but
ScriptDuration was 0.803 / 0.832 / 0.812 / 0.808 seconds in alternating off/on
windows. It also had no clear CPU benefit, so it was not added to production.

Measurements used a 60 Hz Chromium window on this Mac, with local Paper running.
Only actual default-framebuffer present draws were timestamped; that diagnostic
also queried the framebuffer binding. CDP timings and these short, instrumented
stationary runs are not GPU timings, statistical performance proof, or Gram/Tab
S7 FE measurements. They justify withholding the changes, not claiming FO parity.
The rejected renderer and test snapshots remain local under
`work/minecraft-26/rejected-optimizations/`; they are not loaded by the launcher.

Binaryen 132 was tested against `classes-spawnpoint.wasm` after our guarded screen
patch. The unrestricted `-O2 --all-features` run spent over 35 minutes in optimizer
work, including inlining/precompute, and was terminated without a result. Two
bounded rewrites completed and passed `wasm-tools validate --features all`:

| Rewrite | Raw bytes | Brotli quality 5 bytes | Result |
| --- | ---: | ---: | --- |
| Existing patched binary | 101,558,801 | 18,550,415 | Production retained |
| `--all-features --dce --remove-unused-brs --vacuum` | 111,639,553 | 27,316,873 | Real local world join passed; not adopted |
| Same passes plus `--preserve-type-order` | 111,168,626 | Not measured | Validated; not adopted |

The first rewrite preserved the TeaVM custom sections and ran the local multiplayer
world through a browser-only response override. Its compressed download grew by
47%, and no compensating performance gain was established. It was not substituted
into production or the normal build pipeline. Reproducible inputs and outputs are
local under `work/minecraft-26/client-26.2/`; use the pinned Binaryen 132 executable
rather than replacing system `wasm2c`/WABT tools.

Prism provides the real Java game and Fabric mod bytecode, but that does not supply
the matching TeaVM browser platform. The examined public browser source candidate
contains placeholder GPU devices, command encoders and pipelines. Its successful
Java compilation and initial 16 linker failures are not evidence of a nearly
finished browser renderer. Full Sodium/FO porting remains incomplete.
