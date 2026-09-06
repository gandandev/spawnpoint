# Removed Complementary LOW WebGL2 experiment

The standalone shader translation and synthetic-scene code was removed on
2026-09-06. It was never connected to the production client. The original code
remains in Git history; this file retains the limits and validation results so
compiling a shader is not mistaken for a completed game integration.

The experiment translated Complementary Reimagined r5.7.1 LOW terrain and shadow
programs to WebGL2. It did not implement water, entities, real Minecraft geometry,
material mapping, deferred/composite/final passes, HDR output, or pack selection.
The raw output was bright/clipped and did not represent the final pack appearance.

## Verified 2026-09-06

Local headed Chromium, WebGL2:

- Pack SHA-256: `24a20634a7832d422d3cd5023be16829f26840e25c69404dd418306ea79f63f0`.
- Both vertex shaders and both fragment shaders compiled; both programs linked.
- Shadow pass, terrain pass and final WebGL error checks returned zero.
- At 640 x 400, clearing the shadow map changed 28,074 pixels, maximum channel
  difference 27. This is evidence of shadow-map influence, not visual parity.
- Screenshot: `output/playwright/complementary-low.png`.

No in-game shader support, mobile compatibility, or FPS gain was demonstrated.
