export type SkinModel = "steve" | "alex";
export type SkinType = "preset" | "upload" | "mojang";

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
  skinType: SkinType;
  skinRef: string;
  skinModel: SkinModel;
  skinLabel: string;
  skinUpdatedAt: number;
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

export interface AdminUser {
  id: string;
  username: string;
  gameUsername: string;
  displayName: string;
  createdAt: number;
  passwordResetPending: boolean;
  passwordResetExpiresAt: number | null;
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
  inventory: unknown[];
  enderChest: unknown[];
}

export interface BridgeSettings {
  tpaEnabled: boolean;
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
