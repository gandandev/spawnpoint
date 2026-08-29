// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAdminOverview } from "../src/features/admin-hooks";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("../src/lib/api", () => ({ api: mocks.api }));

function Harness() {
  useAdminOverview({ open: true, csrf: "csrf" });
  return null;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("administrator overview polling", () => {
  it("stops in hidden tabs and refreshes as soon as the tab is visible", async () => {
    vi.useFakeTimers();
    let hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    mocks.api.mockResolvedValue({
      users: [],
      players: [],
      bridgeAvailable: false,
      tpaEnabled: null,
      logs: [],
      server: { phase: "off", players: [] },
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
    });
    expect(mocks.api).toHaveBeenCalledTimes(1);

    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(mocks.api).toHaveBeenCalledTimes(2);

    hidden = true;
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(mocks.api).toHaveBeenCalledTimes(2);

    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(mocks.api).toHaveBeenCalledTimes(3);

    act(() => root.unmount());
  });
});
