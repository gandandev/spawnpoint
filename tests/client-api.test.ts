// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, waitForServerOnline } from "../src/lib/api";

function hangingFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    const rejectAbort = () => reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) rejectAbort();
    else signal?.addEventListener("abort", rejectAbort, { once: true });
  }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("client API request lifecycle", () => {
  it("turns a stalled request into a useful timeout error", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());

    const result = expect(api("/bootstrap", { timeoutMs: 250 })).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
      message: "서버 응답이 늦어요. 다시 시도하세요.",
    } satisfies Partial<ApiError>);
    await vi.advanceTimersByTimeAsync(250);

    await result;
  });

  it("keeps caller cancellation distinct from a timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());
    const controller = new AbortController();

    const result = expect(api("/admin/overview", {
      signal: controller.signal,
      timeoutMs: 1_000,
    })).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();

    await result;
  });

  it("does not let one stalled status request outlive the startup deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());

    const result = expect(waitForServerOnline(500)).rejects.toThrow("서버 시작이 예상보다 오래 걸려요");
    await vi.advanceTimersByTimeAsync(500);

    await result;
  });
});
