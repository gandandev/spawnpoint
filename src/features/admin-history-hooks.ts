import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { AdminHistoryPage, AdminHistorySection } from "@/types";

interface UseAdminHistoryOptions {
  active: boolean;
  csrf: string | null;
  section: AdminHistorySection;
  query: string;
  from: number | null;
  to: number | null;
  revealIp?: boolean;
}

export function useAdminHistory<T extends { id: number }>({
  active,
  csrf,
  section,
  query,
  from,
  to,
  revealIp = false,
}: UseAdminHistoryOptions) {
  const [page, setPage] = useState<AdminHistoryPage<T>>({ entries: [], nextCursor: null });
  const [loadedSection, setLoadedSection] = useState<AdminHistorySection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [viewingOlder, setViewingOlder] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const generationRef = useRef(0);
  const viewingOlderRef = useRef(false);

  const requestPage = useCallback(async (before?: number, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (from !== null) params.set("from", String(from));
    if (to !== null) params.set("to", String(to));
    if (before !== undefined) params.set("before", String(before));
    if (section === "access" && revealIp) params.set("revealIp", "1");
    const suffix = params.size > 0 ? `?${params}` : "";
    return api<AdminHistoryPage<T>>(`/admin/history/${section}${suffix}`, {
      headers: { "x-spawnpoint-csrf": csrf! },
      signal,
    });
  }, [csrf, from, query, revealIp, section, to]);

  useEffect(() => {
    if (!active) return;
    viewingOlderRef.current = false;
    setViewingOlder(false);
    setPage({ entries: [], nextCursor: null });
    setLoadedSection(null);
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
        const result = await requestPage(undefined, requestController.signal);
        if (alive && generation === generationRef.current) {
          setPage(result);
          setLoadedSection(section);
          setLoadError(null);
        }
      } catch (error) {
        if (alive && generation === generationRef.current && !(error instanceof DOMException && error.name === "AbortError")) {
          setLoadError(error instanceof Error ? error.message : "기록을 불러오지 못했어요");
        }
      } finally {
        if (alive && generation === generationRef.current) setIsLoading(false);
        if (controller === requestController) controller = null;
      }
      if (alive && to === null && !viewingOlderRef.current) timer = window.setTimeout(() => void poll(), 5_000);
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
  }, [active, reloadKey, requestPage, section, to]);

  const loadOlder = useCallback(async () => {
    if (!active || page.nextCursor === null || isLoadingOlder) return;
    viewingOlderRef.current = true;
    setViewingOlder(true);
    setIsLoadingOlder(true);
    const generation = ++generationRef.current;
    try {
      const older = await requestPage(page.nextCursor);
      if (generation !== generationRef.current) return;
      setPage((current) => ({
        entries: [...current.entries, ...older.entries],
        nextCursor: older.nextCursor,
      }));
      setLoadError(null);
    } catch (error) {
      if (generation === generationRef.current) {
        setLoadError(error instanceof Error ? error.message : "이전 기록을 불러오지 못했어요");
      }
    } finally {
      if (generation === generationRef.current) setIsLoadingOlder(false);
    }
  }, [active, isLoadingOlder, page.nextCursor, requestPage]);

  const refresh = useCallback(() => {
    viewingOlderRef.current = false;
    setViewingOlder(false);
    setReloadKey((current) => current + 1);
  }, []);

  return {
    entries: loadedSection === section ? page.entries : [],
    nextCursor: loadedSection === section ? page.nextCursor : null,
    isLoading: isLoading || loadedSection !== section,
    isLoadingOlder,
    loadError,
    loadOlder,
    refresh,
    viewingOlder,
  };
}
