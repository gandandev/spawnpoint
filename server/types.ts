export type SkinModel = "steve" | "alex";
export type SkinType = "preset" | "upload" | "mojang";

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: Buffer;
  passwordSalt: Buffer;
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
  skin: {
    type: SkinType;
    model: SkinModel;
    label: string;
    previewUrl: string;
  };
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

