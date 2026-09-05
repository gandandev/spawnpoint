import type { PlayerDetails, ServerSettings, ServerStatus } from "../server/types";
export type {
  ServerPhase, ResourcePackPreference, ServerDifficulty, ServerGameMode,
  ServerStatus, InventoryItem, PlayerDetails, ServerSettings,
} from "../server/types";

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
  usedBy: Array<{ id: string; displayName: string }>;
}

export interface SkinCatalogCategory {
  id: string;
  label: string;
  skins: SkinCatalogEntry[];
}

export interface AdminUser {
  skin?: PublicUser["skin"];
  id: string;
  username: string;
  gameUsername: string;
  displayName: string;
  createdAt: number;
  lastLoginAt: number | null;
  archivedAt: number | null;
  passwordUpdatedAt: number;
  passwordResetExpiresAt: number | null;
  resetRequired: boolean;
  isAdmin: boolean;
}

export interface AdminOverview {
  users: AdminUser[];
  players: PlayerDetails[];
  bridgeAvailable: boolean;
  tpaEnabled: boolean | null;
  settings: ServerSettings;
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

export type AdminHistorySection = "chats" | "access" | "logs";

export interface AdminAccessHistoryEntry {
  id: number;
  accountId: string;
  accountUsername: string;
  gameUsername: string;
  displayName: string;
  skinUrl: string;
  ipAddress: string;
  connectedAt: number;
  lastSeenAt: number;
  joinedAt: number | null;
  leftAt: number | null;
  disconnectedAt: number | null;
  disconnectReason: string | null;
}

export interface AdminChatHistoryEntry {
  id: number;
  occurredAt: number;
  accountId: string | null;
  uuid: string;
  gameUsername: string;
  displayName: string;
  skinUrl: string;
  channel: "public" | "whisper";
  recipientAccountId: string | null;
  recipientUuid: string | null;
  recipientGameUsername: string | null;
  recipientDisplayName: string | null;
  recipientSkinUrl: string | null;
  message: string;
}

export interface AdminServerLogHistoryEntry {
  id: number;
  occurredAt: number;
  source: string;
  line: string;
}

export interface AdminHistoryPage<T> {
  entries: T[];
  nextCursor: number | null;
}

export interface BootstrapData {
  user: PublicUser | null;
  csrf: string | null;
  adminExpiresAt: number | null;
  server: ServerStatus;
  setup: { eulaAccepted: boolean };
}

export interface SessionUpdate {
  user: PublicUser;
  csrf: string;
  adminExpiresAt: number | null;
}
