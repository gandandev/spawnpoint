import { type FormEvent, lazy, Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { currentSiteName } from "@/lib/site-name";
import gameClient from "@/game-client.json";
import { AuthScreen } from "@/screens/AuthScreen";
import { Dashboard } from "@/screens/Dashboard";
import { GameScreen, type GameSession } from "@/screens/GameScreen";
import type { BootstrapData, PublicUser, ResourcePackPreference, ServerStatus, SessionUpdate } from "@/types";

const AdminPanel = lazy(() => import("@/features/AdminPanel").then((module) => ({ default: module.AdminPanel })));

interface StandaloneAdminAccess {
  user: PublicUser;
  csrf: string;
  adminExpiresAt: number;
}

export function App() {
  const [accepted, setAccepted] = useState(false);
  if (!accepted) return <main className="flex min-h-svh items-center justify-center px-6 py-12">
    <div className="flex max-w-md flex-col items-center gap-5 text-center">
      <h1 className="text-2xl font-bold">26.2로 옮기는중!!</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">플레이 중 서버가 자주 재시작되거나 게임이 튕길 수 있어요.</p>
      <Button size="lg" onClick={() => setAccepted(true)}>그래도 들어가기</Button>
    </div>
  </main>;
  return <PortalApp />;
}

function PortalApp() {
  const siteName = currentSiteName();
  const [authMode, setAuthMode] = useState<"login" | "register">(() => window.location.pathname === "/signup" ? "register" : "login");
  const [data, setData] = useState<BootstrapData | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [game, setGame] = useState<GameSession | null>(null);
  const [showSkinAfterSignup, setShowSkinAfterSignup] = useState(false);
  const [adminPasswordOpen, setAdminPasswordOpen] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminUnlocking, setAdminUnlocking] = useState(false);
  const [standaloneAdmin, setStandaloneAdmin] = useState<StandaloneAdminAccess | null>(null);
  const notice = useCallback((message: string) => toast(message, { duration: 4_500 }), []);
  const reload = useCallback(async () => {
    setBootstrapError(null);
    try {
      setData(await api<BootstrapData>("/bootstrap"));
    } catch {
      setBootstrapError(`${siteName}에 연결할 수 없어요`);
    }
  }, [siteName]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!data) return;
    // Begin after the portal's own bootstrap, without starting a game or server.
    const assets = (window as Window & { spawnpointGameAssets?: { warm(): Promise<void> } }).spawnpointGameAssets;
    void assets?.warm().catch(() => { /* A game launch retries failed preloads. */ });
  }, [Boolean(data)]);

  useEffect(() => {
    const syncAuthMode = () => setAuthMode(window.location.pathname === "/signup" ? "register" : "login");
    window.addEventListener("popstate", syncAuthMode);
    return () => window.removeEventListener("popstate", syncAuthMode);
  }, []);

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

  const changeAuthMode = useCallback((mode: "login" | "register") => {
    window.history.pushState(null, "", mode === "register" ? "/signup" : "/");
    setAuthMode(mode);
  }, []);

  const auth = async (action: "login" | "register" | "reset", username: string, password: string, serverPassword: string) => {
    const endpoint = action === "reset" ? "/auth/continue" : action === "register" ? "/auth/register" : "/auth/login";
    const result = await api<{ user: PublicUser; csrf: string; created: boolean }>(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "login" ? { username, password } : { username, password, serverPassword }),
    });
    setShowSkinAfterSignup(result.created);
    window.history.replaceState(null, "", "/");
    setAuthMode("login");
    setStandaloneAdmin(null);
    setAdminPanelOpen(false);
    setData((current) => current ? { ...current, user: result.user, csrf: result.csrf, canSpectate: false } : current);
    await reload();
  };

  const openAdmin = useCallback(() => {
    const loggedInAdminActive = data?.user?.isAdmin && (data.adminExpiresAt === null || data.adminExpiresAt > Date.now());
    if (loggedInAdminActive || (standaloneAdmin && standaloneAdmin.adminExpiresAt > Date.now())) {
      setAdminPanelOpen(true);
      return;
    }
    setAdminPassword("");
    setAdminPasswordOpen(true);
  }, [data?.adminExpiresAt, data?.user?.isAdmin, standaloneAdmin]);

  const unlockAdmin = async (event: FormEvent) => {
    event.preventDefault();
    setAdminUnlocking(true);
    try {
      const result = await api<StandaloneAdminAccess & { standalone: boolean }>("/auth/admin-unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword }),
      });
      if (result.standalone) setStandaloneAdmin(result);
      else setData((current) => current ? { ...current, user: result.user, csrf: result.csrf, adminExpiresAt: result.adminExpiresAt } : current);
      setAdminPasswordOpen(false);
      setAdminPassword("");
      setAdminPanelOpen(true);
    } catch (error) {
      notice(error instanceof Error ? error.message : "관리자 인증에 실패했어요");
    } finally {
      setAdminUnlocking(false);
    }
  };

  const updateSession = useCallback((user: SessionUpdate["user"], csrf: string, adminExpiresAt: number | null) => {
    setData((current) => current ? {
      ...current,
      user,
      csrf,
      adminExpiresAt,
    } : current);
  }, []);

  const logout = async () => {
    await api<void>("/auth/logout", { method: "POST", headers: { "x-spawnpoint-csrf": data!.csrf! } });
    setShowSkinAfterSignup(false);
    setAdminPanelOpen(false);
    setStandaloneAdmin(null);
    setData((current) => current ? { ...current, user: null, csrf: null, adminExpiresAt: null } : current);
  };

  const play = async (spectator = false) => {
    const launchId = crypto.randomUUID();
    const result = await api<{ username: string; profile: string; resourcePackPreference: ResourcePackPreference }>("/game-ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-spawnpoint-csrf": data!.csrf! },
      body: JSON.stringify({ launchId, spectator }),
    });
    const storageNamespace = `_spawnpoint_${result.username.toLowerCase()}`;
    window.localStorage.setItem(`${storageNamespace}.p`, result.profile);
    window.localStorage.setItem(`${storageNamespace}.launch`, JSON.stringify({
      csrf: data!.csrf,
      resourcePackPreference: result.resourcePackPreference,
    }));
    setGame({ username: result.username, launchId });
  };

  const gameUrl = game
    ? `/game/stable.html?v=${gameClient.cacheVersion}&account=${encodeURIComponent(game.username)}&launch=${encodeURIComponent(game.launchId)}`
    : "";

  const standaloneAdminData = standaloneAdmin && standaloneAdmin.adminExpiresAt > Date.now() && data ? {
    ...data,
    user: standaloneAdmin.user,
    csrf: standaloneAdmin.csrf,
    adminExpiresAt: standaloneAdmin.adminExpiresAt,
  } : null;
  const loggedInAdminData = data?.user?.isAdmin && (data.adminExpiresAt === null || data.adminExpiresAt > Date.now()) ? data : null;
  const adminData = standaloneAdminData ?? loggedInAdminData;

  if (!data) return <main className="flex min-h-dvh flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
    {bootstrapError ? <><span>{bootstrapError}</span><Button variant="outline" onClick={() => void reload()}>다시 시도</Button></> : <><Spinner />월드 상태 불러오는 중</>}
  </main>;
  return <>
    {game
      ? <GameScreen game={game} gameUrl={gameUrl} onExit={() => setGame(null)} />
      : data.user
        ? <Dashboard data={data} onData={(patch) => setData((current) => current ? { ...current, ...patch } : current)} onSession={updateSession} onStart={startServer} onLogout={logout} notice={notice} onPlay={play} onOpenAdmin={openAdmin} initialSkinDialogOpen={showSkinAfterSignup} onInitialSkinDialogHandled={() => setShowSkinAfterSignup(false)} />
        : <AuthScreen data={data} mode={authMode} onAuth={auth} onModeChange={changeAuthMode} onOpenAdmin={openAdmin} notice={notice} />}
    <Dialog open={adminPasswordOpen} onOpenChange={(open) => {
      setAdminPasswordOpen(open);
      if (!open) setAdminPassword("");
    }}>
      <DialogContent className="w-[calc(100%-2rem)] ring-0 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>관리자 인증</DialogTitle>
          <DialogDescription className="sr-only">관리자 비밀번호를 입력하세요.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={unlockAdmin}>
          <Input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} placeholder="비밀번호" autoFocus autoComplete="current-password" aria-label="관리자 비밀번호" />
          <Button type="submit" disabled={adminUnlocking || !adminPassword}>{adminUnlocking ? <Spinner /> : null}확인</Button>
        </form>
      </DialogContent>
    </Dialog>
    {adminData ? <Suspense fallback={null}><AdminPanel data={adminData} onSession={(user, csrf, adminExpiresAt) => {
      if (standaloneAdminData) setStandaloneAdmin((current) => current ? { ...current, user, csrf, adminExpiresAt: adminExpiresAt ?? current.adminExpiresAt } : current);
      else updateSession(user, csrf, adminExpiresAt);
    }} notice={notice} open={adminPanelOpen} onOpenChange={setAdminPanelOpen} showTrigger={false} /></Suspense> : null}
    <Toaster position="bottom-right" />
  </>;
}
