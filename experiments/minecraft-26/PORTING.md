# Full portal and gameplay port

The migration-only deployment is not the requested finished product. Preserve the current main portal UI, design and features, and every existing gameplay/client customization. Only the custom chat input/composer is excluded. The original main deployment and volume remain separate.

## Acceptance inventory

- [x] Merge current main portal design, pixel icons, admin layout and history/archive controls.
- [ ] Serve the real portal with its existing login, signup, account management and skin catalog/upload/lookup/random selection.
- [ ] Connect server status, start/stop, idle shutdown, settings, console and update notices to Paper 26.2 and Velocity.
- [ ] Preserve account identity, session revocation, connection tracking, IP history and administrator authorization.
- [ ] Port online and offline player state, inventory, Ender Chest, bans, operators, kicks, titles and archive controls to the modern data format.
- [ ] Restore uploaded skins and identity-bound multiplayer skins, including cache invalidation.
- [ ] Port display names, join/quit/chat/death/advancement messages and chat head rendering. Keep the native chat input.
- [ ] Port TPA and command aliases, keep-inventory, daytime reset on first join, bed spawn behavior and death coordinates.
- [ ] Port diamond balance to current world height and stone/deepslate generation, preserving duplicate prevention.
- [ ] Port locator HUD, player names/heads/distances and mobile controls.
- [ ] Port Galmuri Korean glyphs, original Latin glyphs, resource textures, panorama/loading assets and portal return menus.
- [ ] Keep FOV 90, display-size GUI defaults, performance profiles and client-only dynamic held-item lighting.
- [ ] Verify the complete portal and actual gameplay on the isolated deployment. Do not label health checks as feature validation.

Main promotion requires acceptance and a fresh production inventory snapshot. Do not reset the already migrated preview world or overwrite its player files as part of this UI/function port.
