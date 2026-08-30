export type ServerPhase = "off" | "preparing" | "starting" | "online" | "stopping" | "error";
export type ResourcePackPreference = "new-default" | "programmer-art";

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
  displayName: string;
  isAdmin: boolean;
  skin: {
    type: "preset" | "upload" | "mojang";
    model: "steve" | "alex";
    label: string;
    previewUrl: string;
  };
}

export interface OnlinePlayer {
  gameUsername: string;
  displayName: string;
}

export interface SkinCatalogEntry {
  id: string;
  label: string;
  textureUrl: string;
}

export interface SkinCatalogCategory {
  id: string;
  label: string;
  skins: SkinCatalogEntry[];
}

export interface AdminUser {
  id: string;
  username: string;
  gameUsername: string;
  displayName: string;
  createdAt: number;
  passwordResetExpiresAt: number | null;
  resetRequired: boolean;
  isAdmin: boolean;
}

export interface InventoryItem {
  slot: number;
  section: "storage" | "armor" | "extra" | string;
  type: string;
  amount: number;
  durability: number;
  displayName?: string;
  lore?: string[];
  enchantments?: Record<string, number>;
}

export interface PlayerDetails {
  accountId: string | null;
  uuid: string;
  username: string;
  displayName: string;
  operator: boolean;
  world: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  foodLevel: number;
  gameMode: string;
  inventory: InventoryItem[];
  enderChest: InventoryItem[];
}

export interface AdminOverview {
  users: AdminUser[];
  players: PlayerDetails[];
  bridgeAvailable: boolean;
  tpaEnabled: boolean | null;
  logs: string[];
  server: ServerStatus;
}

export interface AdminLogEntry {
  source: string;
  line: string;
}

export interface AdminLogPage {
  entries: AdminLogEntry[];
  nextOffset: number | null;
}

export interface ClientChoice {
  id: "stable";
  version: string;
  label: string;
  description: string;
}

export interface BootstrapData {
  user: PublicUser | null;
  csrf: string | null;
  adminExpiresAt: number | null;
  server: ServerStatus;
  clients: ClientChoice[];
  setup: { eulaAccepted: boolean };
}

export interface SessionUpdate {
  user: PublicUser;
  csrf: string;
  adminExpiresAt: number | null;
}
