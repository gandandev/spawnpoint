# 26.2 browser performance audit, 2026-09-06

The browser runs a pinned TeaVM Wasm-GC build, not a Fabric JVM. A Fabric JAR cannot patch this binary. The following table distinguishes comparable changes from ports. No Sodium, Voxy, or Distant Horizons installation is claimed.

The [Fabulously Optimized list](https://github.com/Fabulously-Optimized/fabulously-optimized/blob/main/INCLUDED-MODS.md) currently lists 26.1.2, not a verified 26.2 pack. Its performance entries were reviewed individually:

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

## Distant terrain

Voxy and Distant Horizons simplify distant geometry, not merely textures. Voxy's [capability checks](https://github.com/MCRcortex/voxy/blob/dev/src/main/java/me/cortex/voxy/client/core/gl/Capabilities.java) use desktop OpenGL compute/SSBO/indirect APIs unavailable in this WebGL2 renderer. [Distant Horizons](https://gitlab.com/distant-horizons-team/distant-horizons) also needs its terrain storage, generation, and rendering pipeline. Neither runs as a drop-in browser mod. A browser LOD implementation is still outstanding. Mipmaps are the existing mechanism for lower-resolution distant textures; they must not be reported as a Voxy/DH port.

## Binary safety and evidence

`patch-client.py` checks pinned function identities and changes only screen routing and head-skin access. It uses the existing JavaScript string builtin directly, avoiding a new asynchronous TeaVM call in the screen state machine. Head lookup reads already downloaded skins without network requests or allocations. Validate with `wasm-tools validate --features all` because this artifact uses legacy exception handling.

Do not claim a universal 60/120 FPS gain from build success. Test keyboard input, native menus, reconnect, fonts, skins, and frame pacing in the actual browser after each binary change. A full optimizing rewrite of the 102 MB module is not treated as safe without compatible GC/exception support and measured playback results.
