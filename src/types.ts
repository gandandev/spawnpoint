export type ServerPhase = "off" | "preparing" | "starting" | "online" | "stopping" | "error";

export interface ServerStatus {
  phase: ServerPhase;
  players: string[];
  startedAt: number | null;
  readyAt: number | null;
  idleShutdownAt: number | null;
  lastError: string | null;
  startAllowedAt: number;
  maxPlayers: number;
  version: string;
}

export interface PublicUser {
  id: string;
  username: string;
  skin: {
    type: "preset" | "upload" | "mojang";
    model: "steve" | "alex";
    label: string;
    previewUrl: string;
  };
}

export interface ClientChoice {
  id: "stable" | "experimental" | "lite";
  version: string;
  label: string;
  description: string;
}

export interface BootstrapData {
  user: PublicUser | null;
  csrf: string | null;
  server: ServerStatus;
  presets: Array<{ id: string; name: string; model: "steve" | "alex" }>;
  clients: ClientChoice[];
  setup: { eulaAccepted: boolean };
}

