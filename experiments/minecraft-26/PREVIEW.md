# Java 26.2 migration preview

This deployment is separate from production. It uses the `preview-26` Railway environment, the `spawnpoint-preview-26` service, and its own `/data` volume. It does not share the production volume, account database, session secret or custom domains. Main remains Minecraft 1.12.2.

Preview URL: https://spawnpoint-preview-26-preview-26.up.railway.app

## What is copied

The 2026-09-05 snapshot was taken while the production Minecraft process was off. SQLite's backup API made a consistent account copy. Player hashes and the off state were checked before and after copying. The original files were not modified. The private backup stays on the production volume and under ignored `work/minecraft-26/` locally; it is never included in Git or a container image.

- 57 existing accounts, including their existing password hashes and account-to-game-name mapping.
- All 46 saved player files. Each UUID matches an existing account's offline game UUID.
- 5,873 carried, equipped and Ender Chest items in total; XP and selected slot are also converted. Nested items and text are covered by the converter regression suite.
- Existing bans, operators and whitelist files.

Terrain comes entirely from a separately generated Paper 26.2 world. The generator checked solid ground and two air blocks at spawn `-96, 76, 32`. Player positions are reset to that spawn; old beds, dimensions, vehicles, fire, fall state and potion effects are not carried over. Old terrain is not packaged.

## Install boundary

`Dockerfile.preview26` builds pinned client/server artifacts and the Velocity identity plugin. When builder networking cannot reach Mojang, a sanitized deployment context can include the verified jar in `experiments/minecraft-26/cache/`; preparation checks the same pinned SHA-256. This ignored cache must never contain account or world data, and uploads with `--no-gitignore` must use the sanitized context, never the working checkout. First startup serves maintenance responses until migration is installed. `package-preview.mjs` checks the source receipts and fresh spawn, then hashes all package files. On macOS, create the archive with `COPYFILE_DISABLE=1 tar --no-xattrs -czf preview-payload.tar.gz payload` to exclude AppleDouble sidecars. Upload that private archive only to the preview volume. `install-preview.mjs` verifies its hashes and player count, refuses existing runtime/database paths, and writes the activation receipt last.

`PreviewIdentity` verifies short-lived gateway tickets and replaces the browser-supplied name and UUID with the authenticated account's game identity. A player cannot choose another account's inventory through the profile editor. Login uses a copied database and a separate secure cookie; failed attempts are limited. Paper and Velocity listen only on loopback.

## Validation and scope

The existing 304 app tests, type checks, legacy plugin build, application build, modern client tests, preview authentication tests, and synthetic inventory conversion tests were run. The final deployment reached SUCCESS. Public HTTPS/WSS, account-bound browser login, new spawn and a real post-disconnect inventory save comparison passed; see `VALIDATION.md` for exact evidence and limitations.

This preview tests migration and Java 26.2 gameplay. It does not yet replace the full production portal: the old admin bridge, skins, custom display-name/gameplay plugin features and client dynamic torch lighting have not been ported. Native browser touch controls belong to the new upstream build. User-reported stable 60 FPS on the Mac is not a measurement on the Gram or Galaxy Tab.

## Main promotion

Do not point main domains at this service yet. Production continues to change after the snapshot, while preview progress stays separate. After acceptance and remaining feature validation, take a new idle backup and migrate the latest production inventories again. Treat preview terrain/progress as disposable unless the user explicitly chooses otherwise. Retain the original 1.12.2 service and volume for rollback; never start 1.12.2 against converted 26.2 files.
