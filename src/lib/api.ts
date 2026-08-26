import type { ServerStatus } from "@/types";

export class ApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, options);
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } } & T;
  if (!response.ok) throw new ApiError(body.error?.message ?? "요청에 실패했어요", body.error?.code);
  return body;
}

export async function waitForServerOnline(timeoutMs = 135_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { server } = await api<{ server: ServerStatus }>("/server/status");
    if (server.phase === "online") return;
    if (server.phase === "off" || server.phase === "error") {
      throw new Error(server.lastError ?? "서버를 시작하지 못했어요");
    }
    await new Promise((resolve) => window.setTimeout(resolve, Math.min(750, deadline - Date.now())));
  }
  throw new Error("서버 시작이 예상보다 오래 걸려요. 잠시 후 다시 시도하세요.");
}
