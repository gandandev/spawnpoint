# spawnpoint

an actual Eaglercraft multiplayer portal with site accounts, account-bound in-game names, managed skins, and a Paper server that starts on demand and sleeps when empty.

## what is wired

- player registration and login with a 3 to 16 character player ID and password
- scrypt password hashing, signed HTTP-only sessions, same-origin checks, CSRF tokens, and request rate limits
- short-lived signed game tickets passed through the same-origin WebSocket gateway
- a custom EaglerXServer plugin that verifies the ticket, forces the site player ID as the in-game name, and forces the selected skin
- 64x64 or legacy 64x32 PNG upload, and skin lookup by Minecraft username through Mojang's official profile APIs
- a public server status stream and an authenticated wake button
- Paper 1.12.2 off by default, with automatic shutdown after 15 empty minutes
- a persistent SQLite account database, uploaded skins, and Minecraft world under one Railway volume
- Eaglercraft 1.12.2 WASM-GC

the default is intentionally 1.12.2. it is the sane middle ground for an older LG Gram.

## local development

requirements: Node 22+, Java 17+, and a JDK 17+ only when rebuilding the custom plugin.

```bash
npm install
npm run build:plugin
npm run build
MC_MOCK=true npm start
```

open `http://localhost:3000`. mock mode exercises the entire portal without starting Minecraft.

to start the real server, first read the [Minecraft EULA](https://www.minecraft.net/eula), then make your own acceptance explicit:

```bash
MC_EULA=true npm start
```

the repository never ships `eula.txt` and never accepts it for you. first startup copies the seed runtime into `DATA_DIR/minecraft`; later starts preserve the world and refresh only managed jars and config.

## railway deployment

1. create a Railway project from this repository.
2. add a persistent volume mounted at `/data`.
3. set `DATA_DIR=/data`.
4. set `SESSION_SECRET` to at least 32 random characters, for example `openssl rand -base64 48`.
5. set a non-empty `SERVER_PASSWORD` for the people allowed to join.
6. after reading the Minecraft EULA, set `MC_EULA=true` if you accept it.
7. keep `MC_MEMORY_MB=768` and `MC_IDLE_MINUTES=15` for the cheap profile.
8. deploy. the included `railway.toml` uses the Dockerfile and `/healthz` check.

the Hobby plan's $5 is usage credit, not a hard resource cap. spawnpoint keeps the always-on Node control plane small and pays the Java memory cost only while the world is awake, but nobody can honestly guarantee a fixed bill. watch Railway usage, especially if people hammer the public wake button or keep the world occupied. the portal also enforces a start cooldown and per-IP rate limits.

## important paths

- `src/`: React portal
- `server/`: account API, skin service, status stream, gateway, and process manager
- `server-plugin/`: signed-ticket EaglerXServer plugin source
- `server-runtime/seed/`: Paper 1.12.2 and EaglerXServer seed copied into persistent storage
- `vendor/clients/`: untouched offline client sources
- `scripts/prepare-clients.mjs`: injects the same-origin gateway configuration into all three clients
- `ATTRIBUTION.md`: client and server provenance with hashes
- `DESIGN_QA.md`: concept fidelity ledger and real browser verification record

## production notes

- do not expose port 25565. Paper binds to `127.0.0.1`; only the Node gateway is public.
- back up `/data`. it contains the account database, skins, and world.
- the Mojang username field produces the same official skin texture NameMC displays. it does not scrape NameMC.
- this is not affiliated with Mojang, Microsoft, Paper, or the Eaglercraft authors. review the third-party licenses and your right to host each bundled binary before a public launch.
