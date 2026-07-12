import { DragEvent, FormEvent, ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Circle, Dices, LogOut, Play, Server, ServerOff, ShieldCheck, Upload, X } from "lucide-react";
import { SkinPreview } from "./SkinPreview";
import type { BootstrapData, ClientChoice, PublicUser, ServerStatus } from "./types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface GameSession { client: ClientChoice["id"]; username: string; launchId: string; }

function AnimatedHeight({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const updateHeight = () => setHeight(content.getBoundingClientRect().height);
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(content);
    return () => observer.disconnect();
  }, [children]);

  return (
    <div
      className="overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] focus-within:overflow-visible motion-reduce:transition-none"
      style={{ height }}
    >
      <div ref={contentRef} className="p-1">{children}</div>
    </div>
  );
}

function statusCopy(status: ServerStatus) {
  if (status.phase === "online") return { title: "서버 온라인", detail: status.players.length ? `월드에 플레이어 ${status.players.length}명 접속 중` : "첫 플레이어를 기다리고 있어요" };
  if (status.phase === "preparing") return { title: "월드 준비 중", detail: "저장된 월드를 복사하고 있어요" };
  if (status.phase === "starting") return { title: "서버 시작 중", detail: "Paper를 준비하고 있어요" };
  if (status.phase === "stopping") return { title: "서버 절전 중", detail: "먼저 모든 청크를 저장하고 있어요" };
  if (status.phase === "error") return { title: "서버를 확인해 주세요", detail: status.lastError ?? "시작하지 못했어요" };
  return { title: "서버 오프라인", detail: "쉬는 동안에는 비용이 들지 않아요" };
}

function useStatusLabel(status: ServerStatus) {
  const [now, setNow] = useState(() => Date.now());
  const waiting = status.phase === "online" && status.players.length === 0 && status.idleShutdownAt !== null;
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [waiting, status.idleShutdownAt]);
  if (status.phase !== "online") return { text: status.phase === "off" ? "오프라인" : status.phase === "error" ? "오류" : "준비 중" };
  if (status.players.length) return { text: "온라인", detail: `${status.players.length}명` };
  const minutes = status.idleShutdownAt ? Math.max(0, Math.ceil((status.idleShutdownAt - now) / 60_000)) : null;
  return { text: "온라인", detail: minutes === null ? "0명" : `0명 · ${minutes}분 후 자동 종료` };
}

function ServerStatusIcon({ status, className }: { status: ServerStatus; className?: string }) {
  const Icon = status.phase === "off" ? ServerOff : Server;
  return <Icon className={className} />;
}

async function api<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api${path}`, options);
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } } & T;
  if (!response.ok) throw new ApiError(body.error?.message ?? "요청에 실패했어요", body.error?.code);
  return body;
}

class ApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function waitForServerOnline(timeoutMs = 135_000): Promise<void> {
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

function Logo() {
  return <div className="flex items-center gap-3 font-mono text-sm font-bold tracking-tight" aria-label="spawnpoint">
    <svg aria-hidden="true" className="size-[18px]" viewBox="0 0 18 18" fill="none">
      <path fill="#96ce4d" d="M0 0h18v13H13v5H0z" />
      <path fill="white" d="M4 4h7v7H4z" />
    </svg>
    <span>spawnpoint</span>
  </div>;
}

function StartButton({ status, setupReady, onStart }: { status: ServerStatus; setupReady: boolean; onStart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const active = ["preparing", "starting", "stopping"].includes(status.phase);
  const online = status.phase === "online";
  const label = online ? "서버 준비 완료" : active ? statusCopy(status).title : "서버 시작";
  return <Button size="sm" className="pr-[7px]" disabled={busy || active || online || !setupReady} onClick={async () => { setBusy(true); try { await onStart(); } finally { setBusy(false); } }}>
    {busy || active ? <Spinner data-icon="inline-start" /> : online ? <Check data-icon="inline-start" /> : <Play data-icon="inline-start" fill="currentColor" />}{setupReady ? label : "서버 시작"}
  </Button>;
}

function ServerCard({ status, setupReady, onStart, compact = false }: { status: ServerStatus; setupReady: boolean; onStart?: () => Promise<void>; compact?: boolean }) {
  const copy = statusCopy(status);
  const label = useStatusLabel(status);
  const starting = status.phase === "preparing" || status.phase === "starting";
  if (compact) return <Card size="sm" className={cn("relative min-h-11 flex-row items-center gap-3 overflow-hidden border-0 bg-muted py-2 pl-3.5 pr-2 shadow-none ring-0", status.phase === "online" && "bg-[#96ce4d]/15")}>
    {starting && <span aria-hidden="true" className="pointer-events-none absolute inset-0 animate-[shimmer_1.5s_linear_infinite] bg-[linear-gradient(110deg,transparent,rgba(255,255,255,.6),transparent)] bg-[length:200%_100%]" />}
    <ServerStatusIcon status={status} className={cn("relative size-4 shrink-0 text-muted-foreground", status.phase === "online" && "text-[#65952c]")} />
    <strong className={cn("relative text-sm", status.phase === "online" && "text-[#65952c]")}>{label.text}</strong>
    {status.phase === "online" ? label.detail && <span className="relative ml-auto mr-1 text-sm text-[#65952c]">{label.detail}</span> : onStart && <span className="relative ml-auto"><StartButton status={status} setupReady={setupReady} onStart={onStart} /></span>}
  </Card>;
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><ServerStatusIcon status={status} />{copy.title}</CardTitle><CardDescription>{copy.detail}</CardDescription></CardHeader><CardFooter><Badge variant="secondary"><Circle fill="currentColor" />{label.text}{label.detail && ` · ${label.detail}`}</Badge>{onStart && <span className="ml-auto"><StartButton status={status} setupReady={setupReady} onStart={onStart} /></span>}</CardFooter></Card>;
}

const passwordFieldErrorClass = "animate-[password-shake_360ms_ease-in-out] border-red-500 bg-red-50 text-red-900 ring-2 ring-red-500/20 focus-visible:border-red-500 focus-visible:ring-red-500/20";

function AuthScreen({ data, onAuth, notice }: { data: BootstrapData; onAuth: (username: string, password: string, serverPassword: string) => Promise<void>; notice: (message: string) => void }) {
  const [username, setUsername] = useState("");
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [serverPassword, setServerPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const [serverPasswordError, setServerPasswordError] = useState(false);

  useEffect(() => {
    setUsernameAvailable(null);
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void api<{ available: boolean }>(`/auth/username-availability?username=${encodeURIComponent(username)}`, { signal: controller.signal })
        .then(({ available }) => setUsernameAvailable(available))
        .catch((error) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) setUsernameAvailable(null);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [username]);

  const authLabel = usernameAvailable === null ? "계속" : usernameAvailable ? "가입" : "로그인";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError(false);
    setServerPasswordError(false);
    setBusy(true);
    try {
      await onAuth(username, password, serverPassword);
    } catch (error) {
      if (error instanceof ApiError && error.code === "INVALID_LOGIN") setPasswordError(true);
      else if (error instanceof ApiError && error.code === "INVALID_SERVER_PASSWORD") setServerPasswordError(true);
      else notice(error instanceof Error ? error.message : "인증에 실패했어요");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-8">
      <Logo />
      <ServerCard status={data.server} setupReady={data.setup.eulaAccepted} compact />
      <Card className="overflow-visible border-0 p-0 shadow-none ring-0">
        <CardContent className="px-0">
          <form onSubmit={submit}>
            <FieldGroup>
              <div className="flex flex-col gap-2">
                <Field>
                  <FieldLabel className="sr-only" htmlFor="username">플레이어 ID</FieldLabel>
                  <Input className="h-11 rounded-full px-4 shadow-none" id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="플레이어 ID" minLength={3} maxLength={16} pattern="[A-Za-z0-9_]+" required />
                </Field>
                <Field>
                  <FieldLabel className="sr-only" htmlFor="password">비밀번호</FieldLabel>
                  <Input
                    className={cn("h-11 rounded-full px-4 shadow-none transition-colors", passwordError && passwordFieldErrorClass)}
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => { setPassword(event.target.value); setPasswordError(false); }}
                    onAnimationEnd={() => setPasswordError(false)}
                    aria-invalid={passwordError}
                    placeholder="비밀번호 (8글자 이상)"
                    minLength={8}
                    maxLength={128}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel className="sr-only" htmlFor="server-password">서버 비밀번호</FieldLabel>
                  <Input
                    className={cn("h-11 rounded-full px-4 shadow-none transition-colors", serverPasswordError && passwordFieldErrorClass)}
                    id="server-password"
                    type="text"
                    autoComplete="off"
                    value={serverPassword}
                    onChange={(event) => { setServerPassword(event.target.value); setServerPasswordError(false); }}
                    onAnimationEnd={() => setServerPasswordError(false)}
                    aria-invalid={serverPasswordError}
                    placeholder="서버 비밀번호"
                    maxLength={128}
                    required
                  />
                </Field>
              </div>
              <Button size="lg" className="h-11 w-full rounded-full px-4" disabled={busy}>
                {busy ? <Spinner data-icon="inline-end" /> : <ArrowRight data-icon="inline-end" />}
                <span key={authLabel} className="animate-[auth-label-in_180ms_ease-out] motion-reduce:animate-none" aria-live="polite">{authLabel}</span>
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function SkinStudio({ data, onUser, onChanged, notice }: { data: BootstrapData; onUser: (user: PublicUser) => void; onChanged: () => void; notice: (message: string) => void }) {
  const [mode, setMode] = useState<"lookup" | "upload">("lookup"); const [lookup, setLookup] = useState(""); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const update = async (key: string, path: string, body: BodyInit, headers: HeadersInit = {}) => { setBusy(key); try { const result = await api<{ user: PublicUser }>(path, { method: "POST", body, headers: { "x-spawnpoint-csrf": data.csrf!, ...headers } }); onUser(result.user); onChanged(); } catch (error) { notice(error instanceof Error ? error.message : "스킨을 변경하지 못했어요"); } finally { setBusy(null); } };
  const uploadSkin = (file: File) => { const form = new FormData(); form.append("skin", file); void update("upload", "/skin/upload", form); };
  const dropSkin = (event: DragEvent<HTMLLabelElement>) => { event.preventDefault(); const nextFile = event.dataTransfer.files[0]; if (nextFile) setFile(nextFile); };
  const submit = (event: FormEvent) => { event.preventDefault(); if (mode === "lookup") void update("lookup", "/skin/fetch", JSON.stringify({ username: lookup }), { "Content-Type": "application/json" }); else if (file) uploadSkin(file); };
  return <form className="flex flex-col gap-4" onSubmit={submit}>
    <ToggleGroup type="single" value={mode} onValueChange={(value) => { if (value === "lookup" || value === "upload") setMode(value); }} variant="outline" spacing={0} className="grid w-full grid-cols-2 p-1">
      <ToggleGroupItem value="lookup" className="h-10 w-full cursor-pointer">사용자 이름</ToggleGroupItem>
      <ToggleGroupItem value="upload" className="h-10 w-full cursor-pointer">스킨 업로드</ToggleGroupItem>
    </ToggleGroup>
    <AnimatedHeight>
      {mode === "lookup" ? <Field><FieldLabel className="sr-only" htmlFor="skin-lookup">마인크래프트 사용자 이름</FieldLabel><Input className="h-11 px-4 shadow-none" id="skin-lookup" value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="이름 입력" required /></Field> : <Field><FieldLabel className="sr-only" htmlFor="skin-file">스킨 PNG 업로드</FieldLabel><label htmlFor="skin-file" onDragOver={(event) => event.preventDefault()} onDrop={dropSkin} className="flex min-h-52 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-input bg-muted/40 px-4 text-center text-sm text-muted-foreground transition-colors hover:bg-muted"><Upload /><span className="mt-2">{file ? file.name : "PNG 스킨을 선택하거나 여기에 놓으세요"}</span><input id="skin-file" className="sr-only" type="file" accept="image/png" disabled={busy !== null} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label></Field>}
    </AnimatedHeight>
    <Button type="submit" size="lg" className="h-11 w-full" disabled={busy !== null || (mode === "lookup" ? !lookup.trim() : !file)}>{busy ? <Spinner /> : "선택"}</Button>
  </form>;
}

function GameScreen({ game, gameUrl, onClose }: { game: GameSession; gameUrl: string; onClose: () => void }) {
  return <main className="fixed inset-0 z-50 size-full bg-black" aria-label="마인크래프트 플레이">
    <iframe title={`마인크래프트 ${game.client}`} src={gameUrl} className="size-full border-0" allow="fullscreen; gamepad; clipboard-read; clipboard-write" allowFullScreen />
    <Button variant="secondary" size="icon-sm" className="absolute right-4 top-4 opacity-70 hover:opacity-100 focus-visible:opacity-100" onClick={onClose} aria-label="게임 종료">
      <X />
    </Button>
  </main>;
}

function Dashboard({ data, onData, onStart, onLogout, notice, onPlay }: { data: BootstrapData; onData: (patch: Partial<BootstrapData>) => void; onStart: () => Promise<void>; onLogout: () => Promise<void>; notice: (message: string) => void; onPlay: (client: ClientChoice["id"]) => Promise<void> }) {
  const [launching, setLaunching] = useState(false); const [skinDialogOpen, setSkinDialogOpen] = useState(false); const [randomizingSkin, setRandomizingSkin] = useState(false); const selected = data.clients[0]!;
  const serverBusy = ["preparing", "starting", "stopping"].includes(data.server.phase);
  const execute = async () => {
    setLaunching(true);
    try {
      if (data.server.phase !== "online") {
        await onStart();
        await waitForServerOnline();
      }
      await onPlay(selected.id);
    } catch (error) {
      notice(error instanceof Error ? error.message : "실행하지 못했어요");
    } finally {
      setLaunching(false);
    }
  };
  const randomizeSkin = async () => {
    setRandomizingSkin(true);
    try {
      const result = await api<{ user: PublicUser }>("/skin/random", { method: "POST", headers: { "x-spawnpoint-csrf": data.csrf! } });
      onData({ user: result.user });
    } catch (error) {
      notice(error instanceof Error ? error.message : "랜덤 스킨을 적용하지 못했어요");
    } finally {
      setRandomizingSkin(false);
    }
  };
  return <main className="dashboard-shell">
    <header className="dashboard-header">
      <Logo />
      <Button variant="ghost" size="sm" className="cursor-pointer pr-2 text-muted-foreground" onClick={() => void onLogout()}><LogOut data-icon="inline-start" />로그아웃</Button>
    </header>
    <ServerCard status={data.server} setupReady={data.setup.eulaAccepted} onStart={onStart} compact />
    {!data.setup.eulaAccepted && <Alert><ShieldCheck /><AlertTitle>서버 설정이 필요해요</AlertTitle><AlertDescription>소유자가 아직 마인크래프트 EULA에 동의하지 않았어요. <code>MC_EULA=true</code>로 설정하세요.</AlertDescription></Alert>}
    <section className="character-stage" aria-label="캐릭터 미리보기">
      <SkinPreview src={data.user!.skin.previewUrl} model={data.user!.skin.model} nameTag={data.user!.username} className="character-preview" />
      <Button variant="outline" size="icon" className="character-random active:scale-[0.98]" onClick={() => void randomizeSkin()} disabled={randomizingSkin} aria-label="랜덤 스킨 적용" title="랜덤 스킨 적용">
        {randomizingSkin ? <Spinner /> : <Dices />}
      </Button>
      <Dialog open={skinDialogOpen} onOpenChange={setSkinDialogOpen}>
        <DialogTrigger asChild><Button variant="outline" className="character-change active:scale-[0.98]">변경</Button></DialogTrigger>
        <DialogContent className="max-h-[90dvh] overflow-y-auto ring-0 sm:max-w-md">
          <DialogHeader><DialogTitle>스킨 변경</DialogTitle><DialogDescription className="sr-only">마인크래프트 사용자 이름으로 가져오거나 PNG 스킨을 올리세요.</DialogDescription></DialogHeader>
          <SkinStudio data={data} onUser={(user) => onData({ user })} onChanged={() => setSkinDialogOpen(false)} notice={notice} />
        </DialogContent>
      </Dialog>
    </section>
    <Button size="lg" className="h-11 w-full rounded-full px-4" disabled={launching || serverBusy || !data.setup.eulaAccepted} onClick={() => void execute()}>
      {launching || serverBusy ? <Spinner /> : <Play fill="currentColor" />}<span>{data.server.phase === "off" ? "서버 켜고 실행" : "실행"}</span>
    </Button>
  </main>;
}

export function App() {
  const [data, setData] = useState<BootstrapData | null>(null); const [game, setGame] = useState<GameSession | null>(null);
  const notice = useCallback((message: string) => toast(message, { duration: 4_500 }), []); const reload = useCallback(async () => setData(await api<BootstrapData>("/bootstrap")), []);
  useEffect(() => { void reload().catch(() => notice("spawnpoint에 연결할 수 없어요")); }, [reload, notice]);
  useEffect(() => { const events = new EventSource("/api/server/events"); events.onmessage = (event) => { const server = JSON.parse(event.data) as ServerStatus; setData((current) => current ? { ...current, server } : current); }; return () => events.close(); }, []);
  const startServer = useCallback(async () => {
    const result = await api<{ server: ServerStatus }>("/server/start", {
      method: "POST",
      headers: { "x-spawnpoint-csrf": data?.csrf ?? "" },
    });
    setData((current) => current ? { ...current, server: result.server } : current);
  }, [data?.csrf]);
  const auth = async (username: string, password: string, serverPassword: string) => {
    const result = await api<{ user: PublicUser; csrf: string }>("/auth/continue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, serverPassword }),
    });
    setData((current) => current ? { ...current, user: result.user, csrf: result.csrf } : current);
  };
  const logout = async () => { await api<void>("/auth/logout", { method: "POST", headers: { "x-spawnpoint-csrf": data!.csrf! } }); setData((current) => current ? { ...current, user: null, csrf: null } : current); };
  const play = async (client: ClientChoice["id"]) => { const launchId = crypto.randomUUID(); const result = await api<{ username: string; profile: string }>("/game-ticket", { method: "POST", headers: { "Content-Type": "application/json", "x-spawnpoint-csrf": data!.csrf! }, body: JSON.stringify({ launchId }) }); window.localStorage.setItem(`_spawnpoint_${result.username.toLowerCase()}.p`, result.profile); setGame({ client, username: result.username, launchId }); };
  const gameUrl = useMemo(() => game ? `/game/${game.client}.html?v=20260712-performance-v1&account=${encodeURIComponent(game.username)}&launch=${encodeURIComponent(game.launchId)}` : "", [game]);
  if (!data) return <main className="flex min-h-dvh items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />월드 상태 불러오는 중</main>;
  if (game) return <GameScreen game={game} gameUrl={gameUrl} onClose={() => setGame(null)} />;
  return <>{data.user ? <Dashboard data={data} onData={(patch) => setData((current) => current ? { ...current, ...patch } : current)} onStart={startServer} onLogout={logout} notice={notice} onPlay={play} /> : <AuthScreen data={data} onAuth={auth} notice={notice} />}<Toaster position="bottom-right" /></>;
}
