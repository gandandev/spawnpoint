# Complementary LOW WebGL2 probe

This local experiment translates the user's original Complementary Reimagined
r5.7.1 LOW terrain and shadow programs and executes them on synthetic geometry.
It is not a shader-pack loader or a production Minecraft integration.

## Reproduce

Requires Python 3, clang, glslangValidator, spirv-cross and the repository's npm
dependencies. On macOS the shader tools are available with
`brew install glslang spirv-cross`. Supply your own original shader ZIP:

```sh
python3 experiments/complementary/prepare.py /absolute/path/ComplementaryReimagined_r5.7.1.zip
python3 -m http.server 8769 --bind 127.0.0.1 --directory work/complementary
```

Open http://127.0.0.1:8769. Generated pack source, textures and binaries stay in
ignored `work/complementary/`. No Complementary source is committed or published.
The preparation script reads the ZIP without modifying it. `--output` changes the
local output directory. Run from the repository root.

## Translation and fixture

- Read LOW settings from `shaders.properties`, recursively expand includes, and
  preprocess with clang. The synthetic MC_VERSION is 12602, not a verified Iris
  version convention for Minecraft 26.2. No optional Iris feature flags are set.
- Replace legacy OpenGL vertex inputs, matrix built-ins, texture functions and
  fragment outputs with explicit equivalents. `shadow2D` retains its vec4 return.
- Compile desktop GLSL to OpenGL SPIR-V with glslang, then emit GLSL ES 3.00 using
  SPIRV-Cross. This handles implicit numeric conversions and moves nonconstant
  global initialization into shader execution. Uniform defaults are retained as
  metadata and set by the fixture because WebGL disallows uniform initializers.
- Execute both original program pairs in WebGL2. The fixture supplies a plane,
  two boxes, a white texture, synthetic material IDs, camera/light matrices and
  a real 1024-square depth-comparison shadow map.
- Render terrain to two RGBA8 attachments: original color output and material
  output (the latter corresponds to pack colortex6). Show raw color by blit.
  These attachments do not reproduce the full pack's HDR buffer formats.
- Clear only the shadow depth map and draw identical terrain again. Count pixels
  with a channel difference greater than 2. Preserve the first image on canvas.

This intentionally does not include water, Minecraft block-ID mapping, texture
atlas integration, entities, deferred/composite/final passes, full HDR formats,
pack selection, live toggling, or performance measurements. The raw image is
bright/clipped because it has no final tone mapping; it is not representative
Complementary output. The scene's fixed light/camera values are test inputs,
not a full implementation of Iris world uniforms.

## Verified 2026-09-06

Local headed Chromium, WebGL2:

- Pack SHA-256: `24a20634a7832d422d3cd5023be16829f26840e25c69404dd418306ea79f63f0`.
- Both vertex shaders and both fragment shaders compiled; both programs linked.
- Shadow pass, terrain pass and final WebGL error checks returned zero.
- At 640 x 400, clearing the shadow map changed 28,074 pixels, maximum channel
  difference 27. This is evidence of shadow-map influence, not visual parity.
- Screenshot: `output/playwright/complementary-low.png`.
- Browser details and compile logs are available at `window.probeReport`.

The next integration gate is supplying real Minecraft geometry/material data
and implementing the remaining render passes. No production source rebuild,
in-game shader support, mobile compatibility or FPS gain is demonstrated here.
