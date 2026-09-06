# 26.2 source inputs and browser build

Prism contains the real Java 26.2 client and a `Fabulously Optimized 14.0.0-beta.2
for 26.2` instance. We read them without changing Prism settings, mods or worlds.
The Minecraft JAR is unobfuscated bytecode, not the original authored Java source.
Vineflower recovers readable Java for inspection and porting.

## Recreate local sources

From the Spawnpoint checkout, with Java 25 available:

```sh
python3 experiments/minecraft-26/prepare-source.py \
  --mod sodium --mod entityculling --mod immediatelyfast \
  --mod betterblockentities --mod ferritecore --mod lithium --mod moreculling
```

Use `--prism-home` and `--instance` for another installation. Use `--all` to
recover the whole game instead of just rendering classes. Outputs stay under
ignored `work/minecraft-26/source-work/`, including the input hash manifest and
compiler logs. The script does not read account credentials. It pins Vineflower
1.12.0 with the release asset SHA-256.

Verified local inputs:

- Java 26.2, protocol 776, data version 4903, Java 25.
- Client SHA-256: `40896ee9f1e2bec3c934daac7e93d41e9e3d9c2f8ae0ca366d52ffbfd1afa290`.
- 912 vanilla rendering Java files; 47 top-level Fabric mod manifests.
- Seven performance mods yielded another 1,568 Java files (2,480 total).

| Installed mod | Version | Recovered Java files |
| --- | --- | ---: |
| Sodium | 0.9.1+mc26.2 | 616 |
| Entity Culling | 1.10.5 | 33 |
| ImmediatelyFast | 1.16.2+26.2 | 37 |
| Better Block Entities | 1.3.7+mc26.2 | 95 |
| FerriteCore | 9.0.0 | 40 |
| Lithium | 0.25.2+mc26.2 | 611 |
| MoreCulling | 1.8.0 | 136 |

These are local inspection inputs, not mod installations in the browser. Nested
library JARs are not counted as additional decompiled source trees.

## Browser platform candidate

The examined source candidate is
https://github.com/diddy62626/eaglercraft-26.1.2 at commit
`ed2d61f519acab623300f44e181238649672850b`. Its `sources/teavm/java` contains 335
platform files. This is a separate source port, not confirmed source for the
currently deployed 26.2 WASM artifact.

The local checkout is `work/minecraft-26/source-work/eagler-26.1.2`.
`browser-source-26.2.patch` records our changes against that exact commit:
Apply it with `git apply --unidiff-zero` in a clean checkout of that commit.
The patch covers 26.2/protocol 776, the new GameData constructor and OpenGL selection, portable
JDK lookup, and Wasm-GC class-library override wiring. Prism libraries are linked
under its ignored `sources/libs/`, with the 26.2 client linked as
`minecraft-26.2.jar`.

Both the original 26.1.2 and adapted 26.2 `:sources:compileTeavmJava` tasks passed.
This proves the adapter source compiles against the new JAR, not complete binary
API compatibility or a playable game. The subsequent Wasm-GC link exposes 16
missing methods, including 26.2 `BindGroupLayout`, backend/device/surface creation,
the new Window constructor, and Java filesystem/reflection/stream methods.
The local class-library overrides fixed the initial missing CompletableFuture
and StackWalker classes, but further platform implementations are still needed.
Do not use the upstream MissingMethodTransformer as proof of compatibility: it
adds null/constant-return placeholders for several methods. Those must have real
browser behavior before a game runtime can be called correct.
Use the wrapper main directly because the upstream shell wrapper mishandles
arguments containing spaces:

```sh
java -cp gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain \
  :sources:compileTeavmJava --no-daemon --console=plain -Dorg.gradle.jvmargs=-Xmx3g
java -cp gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain \
  :sources:generateWasmGC --no-daemon --console=plain -Dorg.gradle.jvmargs=-Xmx3g
```

Run those commands inside the candidate checkout. The Wasm task uses local
class overrides; it does not invoke upstream tasks that rewrite global Gradle
cache JARs. The alternative Pixl-Studios candidate at
`b7c696aaab3340e76769b236536fa2ff8a676c4d` explicitly leaves browser chunk rendering
and desktop launch verification unchecked, so it is not a verified replacement.

## Optimization entry points

- Vanilla `GlRenderPass` and `GlCommandEncoder`: render command submission.
- Vanilla `EntityRenderDispatcher.shouldRender`: entity visibility entry.
- Sodium `client/gpu/device/batch` and `client/render/chunk`: draw batches and section lists.
- Entity Culling `CullTask`: camera-based asynchronous visibility work, with
  nested occlusion-library dependencies that still need separate integration.
- ImmediatelyFast: dynamic buffer and render batching integration.

Do not ship this candidate or claim FO parity until it produces a valid WASM,
loads the actual world, passes portal/input/skin/inventory checks, and wins an
on-device comparison against the deployed client. Source acquisition is no
longer waiting on the user; remaining failures belong to platform porting.
