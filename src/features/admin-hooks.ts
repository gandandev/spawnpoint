import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { AdminLogPage, AdminOverview, PublicUser, ServerSettings, SessionUpdate } from "@/types";

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
    let cycle = 0;
    const stopCycle = () => {
      cycle += 1;
      controller?.abort();
      controller = null;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const poll = async () => {
      if (!active || document.hidden) return;
      const pollCycle = ++cycle;
      const requestController = new AbortController();
      controller = requestController;
      try {
        await loadOverview(requestController.signal);
      } catch {
        // The latest request owns the visible error state inside loadOverview.
      }
      if (controller === requestController) controller = null;
      if (active && !document.hidden && cycle === pollCycle) {
        timer = window.setTimeout(() => void poll(), 2_000);
      }
    };
    const handleVisibilityChange = () => {
      stopCycle();
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (!document.hidden) void poll();
    return () => {
      active = false;
      stopCycle();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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

export interface AdminMutationResult {
  user?: PublicUser;
  csrf?: string;
  adminExpiresAt?: number | null;
  resetCode?: string;
  temporaryPassword?: string;
  sent?: number;
  settings?: ServerSettings;
  restartRequired?: boolean;
  liveApplied?: boolean;
}

export type AdminMutate = (key: string, path: string, options: RequestInit) => Promise<AdminMutationResult | null>;

export function useAdminMutation({ csrf, onSession, notice, refresh }: AdminMutationOptions) {
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set());

  const isBusy = useCallback((key: string) => busyKeys.has(key), [busyKeys]);
  const mutate: AdminMutate = useCallback(async (key: string, path: string, options: RequestInit) => {
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

interface UseAdminLogsOptions {
  active: boolean;
  csrf: string | null;
  query: string;
}

export function useAdminLogs({ active, csrf, query }: UseAdminLogsOptions) {
  const [page, setPage] = useState<AdminLogPage>({ entries: [], nextOffset: null });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [viewingOlder, setViewingOlder] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const generationRef = useRef(0);
  const viewingOlderRef = useRef(false);

  const requestPage = useCallback(async (offset: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ offset: String(offset) });
    if (query) params.set("q", query);
    return api<AdminLogPage>(`/admin/logs?${params}`, {
      headers: { "x-spawnpoint-csrf": csrf! },
      signal,
    });
  }, [csrf, query]);

  useEffect(() => {
    if (!active) return;
    viewingOlderRef.current = false;
    setViewingOlder(false);
    setPage({ entries: [], nextOffset: null });
    setLoadError(null);
    let alive = true;
    let controller: AbortController | null = null;
    let timer: number | null = null;

    const poll = async () => {
      if (!alive || document.hidden || viewingOlderRef.current) return;
      const generation = ++generationRef.current;
      const requestController = new AbortController();
      controller = requestController;
      setIsLoading(true);
      try {
        const result = await requestPage(0, requestController.signal);
        if (alive && generation === generationRef.current) {
          setPage(result);
          setLoadError(null);
        }
      } catch (error) {
        if (alive && generation === generationRef.current && !(error instanceof DOMException && error.name === "AbortError")) {
          setLoadError(error instanceof Error ? error.message : "로그를 불러오지 못했어요");
        }
      } finally {
        if (alive && generation === generationRef.current) setIsLoading(false);
        if (controller === requestController) controller = null;
      }
      if (alive && !query && !viewingOlderRef.current) timer = window.setTimeout(() => void poll(), 2_000);
    };

    const handleVisibilityChange = () => {
      controller?.abort();
      controller = null;
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if (!document.hidden && !viewingOlderRef.current) void poll();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void poll();
    return () => {
      alive = false;
      generationRef.current += 1;
      controller?.abort();
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [active, query, reloadKey, requestPage]);

  const loadOlder = useCallback(async () => {
    if (!active || page.nextOffset === null || isLoadingOlder) return;
    viewingOlderRef.current = true;
    setViewingOlder(true);
    setIsLoading(false);
    setIsLoadingOlder(true);
    const generation = ++generationRef.current;
    try {
      const older = await requestPage(page.nextOffset);
      if (generation !== generationRef.current) return;
      setPage((current) => ({
        entries: [...older.entries, ...current.entries],
        nextOffset: older.nextOffset,
      }));
      setLoadError(null);
    } catch (error) {
      if (generation === generationRef.current) {
        setLoadError(error instanceof Error ? error.message : "이전 로그를 불러오지 못했어요");
      }
    } finally {
      if (generation === generationRef.current) setIsLoadingOlder(false);
    }
  }, [active, isLoadingOlder, page.nextOffset, requestPage]);

  const showLatest = useCallback(() => {
    viewingOlderRef.current = false;
    setViewingOlder(false);
    setReloadKey((current) => current + 1);
  }, []);

  return { ...page, isLoading, isLoadingOlder, loadError, loadOlder, showLatest, viewingOlder };
}
