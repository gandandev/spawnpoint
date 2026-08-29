import type { ServerStatus } from "@/types";

export class ApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiOptions extends RequestInit {
  timeoutMs?: number;
}

const DEFAULT_API_TIMEOUT_MS = 30_000;
const POLL_REQUEST_TIMEOUT_MS = 5_000;

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const {
    signal: callerSignal,
    timeoutMs = DEFAULT_API_TIMEOUT_MS,
    ...requestOptions
  } = options;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_API_TIMEOUT_MS);

  try {
    const response = await fetch(`/api${path}`, {
      ...requestOptions,
      signal: controller.signal,
    });
    if (response.status === 204) return undefined as T;
    let body: { error?: { code?: string; message?: string } } & T;
    try {
      body = await response.json() as typeof body;
    } catch (error) {
      if (controller.signal.aborted) throw error;
      body = {} as typeof body;
    }
    if (!response.ok) throw new ApiError(body.error?.message ?? "요청에 실패했어요", body.error?.code);
    return body;
  } catch (error) {
    if (timedOut) throw new ApiError("서버 응답이 늦어요. 다시 시도하세요.", "REQUEST_TIMEOUT");
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function waitForServerOnline(timeoutMs = 135_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    let server: ServerStatus;
    try {
      ({ server } = await api<{ server: ServerStatus }>("/server/status", {
        timeoutMs: Math.min(POLL_REQUEST_TIMEOUT_MS, remaining),
      }));
    } catch (error) {
      if (error instanceof ApiError && error.code === "REQUEST_TIMEOUT") continue;
      throw error;
    }
    if (server.phase === "online") return;
    if (server.phase === "off" || server.phase === "error") {
      throw new Error(server.lastError ?? "서버를 시작하지 못했어요");
    }
    await new Promise((resolve) => window.setTimeout(resolve, Math.min(750, deadline - Date.now())));
  }
  throw new Error("서버 시작이 예상보다 오래 걸려요. 잠시 후 다시 시도하세요.");
}
