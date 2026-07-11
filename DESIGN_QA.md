# design and browser qa

## references

- `design/concepts/auth-concept.png`: generated full-page authentication concept
- `design/concepts/dashboard-concept.png`: generated full-page dashboard concept
- `design/qa/auth-1440.png`: implemented authentication page at 1440x900
- `design/qa/dashboard-1440.png`: implemented dashboard at 1440x900
- `design/qa/auth-mobile-390.png`: responsive authentication page at 390x844
- `design/qa/client-boot-mock.png`: real 1.12.2 browser client booted through the portal, with the mock backend intentionally refusing the final Minecraft socket

## fidelity ledger

1. the concept's two-column authentication composition is preserved, including the oversized left headline and compact right access panel.
2. the graphite, moss, and muted amber palette is preserved without decorative color gradients.
3. the typography keeps the concept's wide editorial headline plus small technical monospace labels.
4. the public server state is a first-class card on both logged-out and logged-in views, with an obvious wake action when offline.
5. the dashboard preserves the concept's large skin workshop beside a narrower client launcher.
6. the supported client is explicit: 1.12.2 stable.
7. the skin stage uses a real PNG projection rather than a decorative placeholder.
8. the 390px layout keeps the visual hierarchy and has no horizontal overflow.

## intentional copy and layout differences

- the generated concept used generic client names. the implementation uses the actual bundled versions and stability labels.
- password recovery was omitted because this ID-only system has no verified email channel. a fake recovery link would be security theater.
- the implemented dashboard exposes upload model selection and Mojang username fetch because both are functional.
- the server card copy changes live with the actual status stream rather than remaining a fixed mock state.

## browser verification

tested through the Codex in-app browser against the production build at `127.0.0.1:3100`:

- registered a new ID and reached the dashboard
- logged out and logged back in
- started the server from the logged-out public page
- observed offline, preparing, and online state changes over server-sent events
- launched the real 1.12.2 WASM-GC client through the signed-ticket iframe and same-origin gateway
- fixed and reverified the game-only CSP after the client's runtime required dynamic evaluation
- checked 1440x900 desktop and 390x844 mobile viewports
