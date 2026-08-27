import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { currentSiteName } from "@/lib/site-name";
import { AuthScreen } from "@/screens/AuthScreen";
import { Dashboard } from "@/screens/Dashboard";
import { GameScreen, type GameSession } from "@/screens/GameScreen";
import type { BootstrapData, ClientChoice, PublicUser, ServerStatus } from "@/types";

const AdminPanel = lazy(() => import("@/features/AdminPanel").then((module) => ({ default: module.AdminPanel })));

export function App() {
  const siteName = currentSiteName();
  const [data, setData] = useState<BootstrapData | null>(null);
  const [game, setGame] = useState<GameSession | null>(null);
  const [showSkinAfterSignup, setShowSkinAfterSignup] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const notice = useCallback((message: string) => toast(message, { duration: 4_500 }), []);
  const reload = useCallback(async () => setData(await api<BootstrapData>("/bootstrap")), []);

  useEffect(() => {
    void reload().catch(() => notice(`${siteName}에 연결할 수 없어요`));
  }, [reload, notice, siteName]);

  useEffect(() => {
    const events = new EventSource("/api/server/events");
    events.onmessage = (event) => {
      try {
        const server = JSON.parse(event.data) as ServerStatus;
        setData((current) => current ? { ...current, server } : current);
      } catch {
        // The next server event will replace a malformed frame.
      }
    };
    return () => events.close();
  }, []);

  const startServer = useCallback(async () => {
    const result = await api<{ server: ServerStatus }>("/server/start", {
      method: "POST",
      headers: { "x-spawnpoint-csrf": data?.csrf ?? "" },
    });
    setData((current) => current ? { ...current, server: result.server } : current);
  }, [data?.csrf]);

  const auth = async (username: string, password: string, serverPassword: string) => {
    const result = await api<{ user: PublicUser; csrf: string; created: boolean }>("/auth/continue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, serverPassword }),
    });
    setShowSkinAfterSignup(result.created);
    setData((current) => current ? { ...current, user: result.user, csrf: result.csrf } : current);
  };

  const updateSession = useCallback((user: PublicUser, csrf: string) => {
    setData((current) => current ? { ...current, user, csrf } : current);
  }, []);

  const logout = async () => {
    await api<void>("/auth/logout", { method: "POST", headers: { "x-spawnpoint-csrf": data!.csrf! } });
    setShowSkinAfterSignup(false);
    setAdminPanelOpen(false);
    setData((current) => current ? { ...current, user: null, csrf: null, adminExpiresAt: null } : current);
  };

  const play = async (client: ClientChoice["id"]) => {
    const launchId = crypto.randomUUID();
    const result = await api<{ username: string; profile: string }>("/game-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-spawnpoint-csrf": data!.csrf! },
      body: JSON.stringify({ launchId }),
    });
    window.localStorage.setItem(`_spawnpoint_${result.username.toLowerCase()}.p`, result.profile);
    setGame({ client, username: result.username, launchId });
  };

  const gameUrl = useMemo(() => game
    ? `/game/${game.client}.html?v=20260827-pixel-controls-v58&account=${encodeURIComponent(game.username)}&launch=${encodeURIComponent(game.launchId)}`
    : "", [game]);

  const adminData = data?.user?.isAdmin ? data : null;

  if (!data) return <main className="flex min-h-dvh items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />월드 상태 불러오는 중</main>;
  return <>
    {game
      ? <GameScreen game={game} gameUrl={gameUrl} />
      : data.user
        ? <Dashboard data={data} onData={(patch) => setData((current) => current ? { ...current, ...patch } : current)} onSession={updateSession} onStart={startServer} onLogout={logout} notice={notice} onPlay={play} onOpenAdmin={() => setAdminPanelOpen(true)} initialSkinDialogOpen={showSkinAfterSignup} onInitialSkinDialogHandled={() => setShowSkinAfterSignup(false)} />
        : <AuthScreen data={data} onAuth={auth} notice={notice} />}
    {adminData ? <Suspense fallback={null}><AdminPanel data={adminData} onSession={updateSession} notice={notice} open={adminPanelOpen} onOpenChange={setAdminPanelOpen} showTrigger={false} /></Suspense> : null}
    <Toaster position="bottom-right" />
  </>;
}
