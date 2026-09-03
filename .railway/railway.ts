import { defineRailway, github, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const source = github("gandandev/spawnpoint", { branch: "main", checkSuites: false });
  const backendData = volume("spawnpoint-web-volume", {
    alerts: { usage: { "80": {}, "95": {}, "100": {} } },
    allowOnlineResize: true,
    region: "asia-southeast1-eqsg3a",
    sizeMB: 5000,
  });

  const frontend = service("spawnpoint-web", {
    source,
    build: {
      watchPatterns: [
        "/src/**",
        "/public/**",
        "/vendor/**",
        "/scripts/prepare-clients.mjs",
        "/scripts/generate-presets.mjs",
        "/scripts/generate-og-images.mjs",
        "/scripts/generate-site-metadata.mjs",
        "/scripts/compress-client-assets.mjs",
        "/index.html",
        "/vite.config.ts",
        "/tsconfig.json",
        "/Dockerfile.frontend",
        "/Caddyfile.frontend",
        "/package.json",
        "/package-lock.json",
      ],
    },
    healthcheck: "/frontend-healthz",
    healthcheckTimeout: 120,
    replicas: { "asia-southeast1-eqsg3a": 1 },
    domains: [
      { domain: "xn--9k3b21rt2f.xn--hk3b17f.xn--3e0b707e", port: 8080 },
      { domain: "xn--o79a769b.xn--hk3b17f.xn--3e0b707e", port: 8080 },
    ],
    env: {
      BACKEND_ORIGIN: preserve(),
      RAILWAY_DOCKERFILE_PATH: "Dockerfile.frontend",
    },
  });

  const backend = service("spawnpoint-server", {
    source,
    build: {
      watchPatterns: [
        "/server/**",
        "/server-plugin/**",
        "/server-runtime/**",
        "/public/assets/skins/**",
        "/Dockerfile.backend",
        "/tsconfig.server.json",
      ],
    },
    healthcheck: "/healthz",
    healthcheckTimeout: 120,
    deploy: { drainingSeconds: 60 },
    replicas: { "asia-southeast1-eqsg3a": 1 },
    volumeMounts: { "/data": backendData },
    env: {
      DATA_DIR: preserve(),
      MC_EULA: preserve(),
      MC_IDLE_MINUTES: preserve(),
      MC_MAX_PLAYERS: preserve(),
      MC_MEMORY_MB: preserve(),
      MC_START_COOLDOWN_SECONDS: preserve(),
      RAILWAY_DOCKERFILE_PATH: "Dockerfile.backend",
      SERVER_PASSWORD: preserve(),
      SESSION_SECRET: preserve(),
      SPAWNPOINT_ADMIN_PASSWORD: preserve(),
      SPAWNPOINT_FRONTEND_VERSION_URL: "https://meeduck.up.railway.app/frontend-version",
    },
  });

  return project("spawnpoint", {
    resources: [backend, frontend, backendData],
  });
});
