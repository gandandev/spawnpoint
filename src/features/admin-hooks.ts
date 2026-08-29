import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { AdminOverview, PublicUser, SessionUpdate } from "@/types";

interface UseAdminOverviewOptions {
  open: boolean;
  csrf: string | null;
  onOverview?: (overview: AdminOverview) => void;
}

export function useAdminOverview({ open, csrf, onOverview }: UseAdminOverviewOptions) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const overviewRequestGenerationRef = useRef(0);

  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    const generation = ++overviewRequestGenerationRef.current;
    let result: AdminOverview;
    try {
      result = await api<AdminOverview>("/admin/overview", {
        headers: { "x-spawnpoint-csrf": csrf! },
        signal,
      });
    } catch (error) {
      if (generation !== overviewRequestGenerationRef.current) return null;
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setLoadError(error instanceof Error ? error.message : "관리자 정보를 불러오지 못했어요");
      }
      throw error;
    }
    if (generation !== overviewRequestGenerationRef.current) return null;
    setOverview(result);
    setLoadError(null);
    onOverview?.(result);
    return result;
  }, [csrf, onOverview]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    let controller: AbortController | null = null;
    let timer: number | null = null;
    const poll = async () => {
      controller = new AbortController();
      try {
        await loadOverview(controller.signal);
      } catch {
        // The latest request owns the visible error state inside loadOverview.
      }
      if (active) timer = window.setTimeout(() => void poll(), 2_000);
    };
    void poll();
    return () => {
      active = false;
      controller?.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [loadOverview, open]);

  return { overview, loadError, loadOverview };
}

interface AdminMutationOptions {
  csrf: string | null;
  onSession: (user: SessionUpdate["user"], csrf: string, adminExpiresAt: number | null) => void;
  notice: (message: string) => void;
  refresh: () => Promise<AdminOverview | null>;
}

interface AdminMutationResult {
  user?: PublicUser;
  csrf?: string;
  adminExpiresAt?: number | null;
  resetCode?: string;
}

export function useAdminMutation({ csrf, onSession, notice, refresh }: AdminMutationOptions) {
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set());

  const isBusy = useCallback((key: string) => busyKeys.has(key), [busyKeys]);
  const mutate = useCallback(async (key: string, path: string, options: RequestInit) => {
    setBusyKeys((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
    try {
      const result = await api<AdminMutationResult>(path, {
        ...options,
        headers: { "x-spawnpoint-csrf": csrf!, ...options.headers },
      });
      if (result?.user && result.csrf) {
        onSession(result.user, result.csrf, result.adminExpiresAt ?? null);
      } else {
        await refresh();
      }
      return result ?? {};
    } catch (error) {
      notice(error instanceof Error ? error.message : "관리자 작업을 완료하지 못했어요");
      return null;
    } finally {
      setBusyKeys((current) => {
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, [csrf, notice, onSession, refresh]);

  return { isBusy, mutate };
}
