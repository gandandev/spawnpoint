# spawnpoint

an actual Eaglercraft multiplayer portal with site accounts, account-bound in-game names, managed skins, and a Paper server that starts on demand and sleeps when empty.

## what is wired

- player registration and login with a 3 to 16 character player ID and password
- scrypt password hashing, signed HTTP-only sessions, same-origin checks, CSRF tokens, and request rate limits
- short-lived signed game tickets passed through the same-origin WebSocket gateway
- a custom EaglerXServer plugin that verifies the ticket, forces the site player ID as the in-game name, and forces the selected skin
- 64x64 or legacy 64x32 PNG upload, and skin lookup by Minecraft username through Mojang's official profile APIs
- a public server status stream and an authenticated wake button
- editable login IDs, Korean display names, password changes, and one-time administrator password resets
- an administrator panel backed by a loopback-only bridge for live player details, OP controls, and server logs
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

the production frontend and backend are separate, but the combined local server remains available for quick development. to exercise the same split locally, run:

```bash
docker compose up --build
```

open `http://localhost:3000`. caddy serves the frontend and proxies `/api`, `/healthz`, and `/gateway` to the private backend service.

to start the real server, first read the [Minecraft EULA](https://www.minecraft.net/eula), then make your own acceptance explicit:

```bash
MC_EULA=true npm start
```

the repository never ships `eula.txt` and never accepts it for you. first startup copies the seed runtime into `DATA_DIR/minecraft`; later starts preserve the world and refresh only managed jars and config.

## railway deployment

production uses two Railway services from this repository. the frontend owns every public domain. it serves static files and proxies authenticated traffic over Railway's private network, so cookies, CSRF checks, server-sent events, and the WebSocket gateway stay on one browser origin.

### backend service

use `Dockerfile.backend`, keep the `/data` volume, and set `/healthz` as the health check. keep the existing secrets and Minecraft variables on this service. `SERVE_CLIENT=false` is already set in the image.

recommended watch paths:

```text
/server/**
/server-plugin/**
/server-runtime/**
/public/assets/skins/**
/Dockerfile.backend
/tsconfig.server.json
```

### frontend service

create a second service from the same repository and use `Dockerfile.frontend`. set its health check to `/frontend-healthz` and set:

```text
BACKEND_ORIGIN=http://${{spawnpoint-server.RAILWAY_PRIVATE_DOMAIN}}:8080
```

replace `spawnpoint-server` if the backend service has another name. keep this service in the same Railway project and environment because private DNS does not cross either boundary.

recommended watch paths:

```text
/src/**
/public/**
/vendor/**
/scripts/prepare-clients.mjs
/scripts/generate-presets.mjs
/scripts/compress-client-assets.mjs
/index.html
/vite.config.ts
/tsconfig.json
/Dockerfile.frontend
/Caddyfile.frontend
/package.json
/package-lock.json
```

### safe cutover

1. create `spawnpoint-server`, copy the existing backend variables to it, and deploy `Dockerfile.backend`.
2. move the existing `/data` volume to `spawnpoint-server` and verify `/healthz` before changing public traffic.
3. keep the existing public service and its domains in place, then switch that service to `Dockerfile.frontend` with `BACKEND_ORIGIN` pointing at `spawnpoint-server`.
4. apply the watch paths above. frontend-only commits then replace only the small Caddy service and leave the Node and Java processes running. `.railway/railway.ts` records this final layout without storing secret values.

do not make the backend public after the cutover. the frontend proxy is the only public entry point.

the Hobby plan's $5 is usage credit, not a hard resource cap. spawnpoint keeps the always-on Node control plane small and pays the Java memory cost only while the world is awake, but nobody can honestly guarantee a fixed bill. watch Railway usage, especially if people hammer the public wake button or keep the world occupied. the portal also enforces a start cooldown and per-IP rate limits.

## important paths

- `src/`: React portal
- `server/`: account API, skin service, status stream, gateway, and process manager
- `server/package.json`: isolated backend dependencies, so frontend package changes do not redeploy the server
- `server-plugin/`: signed-ticket EaglerXServer plugin source
- `server-runtime/seed/`: Paper 1.12.2 and EaglerXServer seed copied into persistent storage
- `vendor/clients/`: untouched offline client sources
- `scripts/prepare-clients.mjs`: injects the same-origin gateway configuration into all three clients
- `Dockerfile.frontend` and `Caddyfile.frontend`: static frontend and same-origin backend proxy
- `Dockerfile.backend`: API, gateway, and Minecraft runtime without frontend assets
- `ATTRIBUTION.md`: client and server provenance with hashes
- `DESIGN_QA.md`: concept fidelity ledger and real browser verification record

## production notes

- do not expose port 25565. Paper binds to `127.0.0.1`; only the Node gateway is public.
- back up `/data`. it contains the account database, skins, and world.
- the Mojang username field produces the same official skin texture NameMC displays. it does not scrape NameMC.
- this is not affiliated with Mojang, Microsoft, Paper, or the Eaglercraft authors. review the third-party licenses and your right to host each bundled binary before a public launch.
