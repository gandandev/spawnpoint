export type SkinModel = "steve" | "alex";
export type SkinType = "preset" | "upload" | "mojang";
export type ResourcePackPreference = "new-default" | "programmer-art";
export type TitleColor = "white" | "gray" | "red" | "gold" | "yellow" | "green" | "aqua" | "blue" | "light_purple";
export type ServerDifficulty = "peaceful" | "easy" | "normal" | "hard";
export type ServerGameMode = "survival" | "creative" | "adventure" | "spectator";

export interface UserRecord {
  id: string;
  username: string;
  gameUsername: string;
  displayName: string;
  passwordHash: Buffer;
  passwordSalt: Buffer;
  passwordResetDigest: Buffer | null;
  passwordResetExpiresAt: number | null;
  sessionVersion: number;
  createdAt: number;
  lastLoginAt: number | null;
  archivedAt: number | null;
  passwordUpdatedAt: number;
  skinType: SkinType;
  skinRef: string;
  skinModel: SkinModel;
  skinLabel: string;
  skinUpdatedAt: number;
  resourcePackPreference: ResourcePackPreference;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin?: boolean;
  skin: {
    type: SkinType;
    model: SkinModel;
    label: string;
    previewUrl: string;
  };
}

export type AdminActor = Pick<UserRecord, "id" | "username" | "sessionVersion">;

export interface UserAuthentication {
  user: UserRecord;
  csrf: string;
  adminExpiresAt: number | null;
}

export interface AdminAuthorization {
  admin: AdminActor;
  authenticated: UserAuthentication | null;
}

export interface AdminUser {
  id: string;
  username: string;
  gameUsername: string;
  displayName: string;
  createdAt: number;
  lastLoginAt: number | null;
  archivedAt: number | null;
  passwordUpdatedAt: number;
  passwordResetPending: boolean;
  passwordResetExpiresAt: number | null;
}

export interface PlayerDetails {
  accountId: string | null;
  uuid: string;
  username: string;
  displayName: string;
  online: boolean;
  dataAvailable: boolean;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  playTimeTicks: number;
  banned: boolean;
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

export interface BridgeSettings {
  tpaEnabled: boolean;
  keepInventory: boolean;
}

export interface InventoryItem {
  slot: number;
  section: "storage" | "armor" | "extra" | "ender";
  type: string;
  amount: number;
  durability: number;
  displayName?: string;
  lore?: string[];
  enchantments?: Record<string, number>;
}

export interface ServerSettings {
  motd: string;
  maxPlayers: number;
  difficulty: ServerDifficulty;
  defaultGameMode: ServerGameMode;
  forceGameMode: boolean;
  viewDistance: number;
  playerIdleTimeout: number;
  pvp: boolean;
  allowFlight: boolean;
  hardcore: boolean;
  allowNether: boolean;
  generateStructures: boolean;
  spawnAnimals: boolean;
  spawnMonsters: boolean;
  spawnNpcs: boolean;
  whiteList: boolean;
  commandBlocks: boolean;
  keepInventory: boolean;
  tpaEnabled: boolean;
}

export interface BridgeTitleRequest {
  title: string;
  subtitle: string;
  color: TitleColor;
  audience: "all" | "selected";
  targets: string[];
}

export interface LocatorTargetDetails {
  accountId: string | null;
  skinUrl: string | null;
  uuid: string;
  username: string;
  displayName: string;
  angle: number;
  distance: number;
}

export interface LocatorSnapshot {
  clientState?: { x: number; y: number; z: number; mainHand: string; offHand: string };
  active: boolean;
  targets: LocatorTargetDetails[];
}

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
