import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Check, ChevronRight, Circle, Clock3, Cloud, Copy, LogOut,
  Play, RefreshCw, Server, ShieldCheck, Upload, UserRound, X,
} from "lucide-react";
import { SkinPreview } from "./SkinPreview";
import type { BootstrapData, ClientChoice, PublicUser, ServerStatus } from "./types";

const emptyStatus: ServerStatus = {
  phase: "off", players: [], startedAt: null, readyAt: null, idleShutdownAt: null,
  lastError: null, startAllowedAt: 0, maxPlayers: 12, version: "Paper 1.12.2",
};

function statusCopy(status: ServerStatus): { title: string; detail: string } {
  if (status.phase === "online") {
    return {
      title: "server online",
      detail: status.players.length ? `${status.players.length} player${status.players.length === 1 ? "" : "s"} in world` : "ready for the first player",
    };
  }
  if (status.phase === "preparing") return { title: "preparing world", detail: "copying the persistent world" };
  if (status.phase === "starting") return { title: "server starting", detail: "paper is warming up" };
  if (status.phase === "stopping") return { title: "server sleeping", detail: "saving every chunk first" };
  if (status.phase === "error") return { title: "server needs attention", detail: status.lastError ?? "startup failed" };
  return { title: "server offline", detail: "costing nothing while it sleeps" };
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, options);
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } } & T;
  if (!response.ok) throw new Error(body.error?.message ?? "request failed");
  return body;
}

function Logo() {
  return <div className="brand" aria-label="spawnpoint"><span className="brand-mark" /><span>spawnpoint</span></div>;
}

function StatusPill({ status }: { status: ServerStatus }) {
  return <span className={`status-pill status-${status.phase}`}><Circle size={7} fill="currentColor" />{status.phase}</span>;
}

interface StartButtonProps {
  status: ServerStatus;
  setupReady: boolean;
  onStart: () => Promise<void>;
  compact?: boolean;
}

function StartButton({ status, setupReady, onStart, compact = false }: StartButtonProps) {
  const [busy, setBusy] = useState(false);
  const active = ["preparing", "starting", "stopping"].includes(status.phase);
  const online = status.phase === "online";
  const label = online ? "server is ready" : active ? statusCopy(status).title : "start server";
  return (
    <button className={compact ? "button button-small" : "button"} disabled={busy || active || online || !setupReady} onClick={async () => {
      setBusy(true);
      try { await onStart(); } finally { setBusy(false); }
    }}>
      {busy || active ? <RefreshCw className="spin" size={16} /> : online ? <Check size={16} /> : <Play size={16} fill="currentColor" />}
      {setupReady ? label : "setup required"}
    </button>
  );
}

function ServerCard({ status, setupReady, onStart, minimal = false }: StartButtonProps & { minimal?: boolean }) {
  const copy = statusCopy(status);
  return (
    <section className={minimal ? "server-card server-card-minimal" : "server-card"}>
      <div className="server-card-icon"><Server size={21} /></div>
      <div className="server-card-copy">
        <div className="eyebrow"><StatusPill status={status} /><span>{status.version}</span></div>
        <h2>{copy.title}</h2>
        <p>{copy.detail}</p>
      </div>
      <StartButton status={status} setupReady={setupReady} onStart={onStart} compact={minimal} />
    </section>
  );
}

function AuthScreen({ data, onAuth, onStart, notice }: {
  data: BootstrapData;
  onAuth: (username: string, password: string, mode: "login" | "register") => Promise<void>;
  onStart: () => Promise<void>;
  notice: (message: string) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try { await onAuth(username, password, mode); }
    catch (error) { notice(error instanceof Error ? error.message : "authentication failed"); }
    finally { setBusy(false); }
  };

  return (
    <main className="auth-page">
      <header className="auth-header"><Logo /><span className="header-note">a private world with a public wake button</span></header>
      <div className="auth-grid">
        <section className="auth-intro">
          <p className="kicker"><span />browser minecraft, properly wired</p>
          <h1>your world,<br /><em>when you need it.</em></h1>
          <p className="intro-copy">one account, one name, one skin. the server sleeps when nobody is playing, then anyone can wake it up.</p>
          <ServerCard status={data.server} setupReady={data.setup.eulaAccepted} onStart={onStart} minimal />
          <div className="trust-row"><span><ShieldCheck size={15} />passwords are salted and hashed</span><span><Clock3 size={15} />15 minute idle sleep</span></div>
        </section>
        <section className="auth-panel">
          <div className="auth-panel-top"><span className="panel-index">01</span><span>player access</span></div>
          <div className="auth-tabs" role="tablist">
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>log in</button>
            <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>register</button>
          </div>
          <form onSubmit={submit}>
            <label>player id<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="mossrunner" minLength={3} maxLength={16} pattern="[A-Za-z0-9_]+" required /><small>3 to 16 letters, numbers, or underscores</small></label>
            <label>password<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="at least 8 characters" minLength={8} maxLength={128} required /></label>
            <button className="button button-wide" disabled={busy}>{busy ? <RefreshCw className="spin" size={16} /> : <ArrowRight size={17} />}{mode === "login" ? "enter spawnpoint" : "create player"}</button>
          </form>
          <p className="auth-foot">your site ID becomes your in-game name. no second login screen.</p>
        </section>
      </div>
      <footer className="auth-footer"><span>three real clients</span><span>1.12.2 stable</span><span>1.21.11 beta</span><span>1.8.8 lite</span></footer>
    </main>
  );
}

function SkinStudio({ data, onUser, notice }: { data: BootstrapData; onUser: (user: PublicUser) => void; notice: (message: string) => void }) {
  const [lookup, setLookup] = useState("");
  const [model, setModel] = useState<"steve" | "alex">(data.user?.skin.model ?? "steve");
  const [busy, setBusy] = useState<string | null>(null);
  const user = data.user!;

  const update = async (key: string, path: string, body: BodyInit, headers: HeadersInit = {}) => {
    setBusy(key);
    try {
      const result = await api<{ user: PublicUser }>(path, { method: "POST", body, headers: { "x-spawnpoint-csrf": data.csrf!, ...headers } });
      onUser(result.user);
    } catch (error) { notice(error instanceof Error ? error.message : "skin update failed"); }
    finally { setBusy(null); }
  };

  return (
    <section className="workspace-panel skin-panel">
      <div className="section-heading"><div><span className="section-index">01</span><p>skin studio</p></div><span className="section-meta">current: {user.skin.label}</span></div>
      <div className="skin-workspace">
        <div className="skin-stage"><div className="stage-grid" /><SkinPreview src={user.skin.previewUrl} model={user.skin.model} className="skin-canvas" /><div className="model-chip">{user.skin.model} model</div></div>
        <div className="skin-controls">
          <div className="control-block"><label>presets</label><div className="preset-grid">{data.presets.map((preset) => <button key={preset.id} className={user.skin.type === "preset" && user.skin.label === preset.name ? "selected" : ""} disabled={busy !== null} onClick={() => void update(preset.id, "/skin/preset", JSON.stringify({ preset: preset.id }), { "Content-Type": "application/json" })}><img src={`/assets/skins/${preset.id}.png`} alt="" /><span>{preset.name}</span>{user.skin.label === preset.name && <Check size={12} />}</button>)}</div></div>
          <form className="control-block" onSubmit={(event) => { event.preventDefault(); void update("lookup", "/skin/fetch", JSON.stringify({ username: lookup }), { "Content-Type": "application/json" }); }}><label htmlFor="skin-lookup">fetch by minecraft username</label><div className="inline-field"><input id="skin-lookup" value={lookup} onChange={(event) => setLookup(event.target.value)} placeholder="minecraft username" required /><button disabled={busy !== null}><Cloud size={15} />fetch</button></div><small>uses the official mojang texture behind NameMC</small></form>
          <div className="control-block"><label>upload skin png</label><div className="model-toggle"><button className={model === "steve" ? "active" : ""} onClick={() => setModel("steve")}>steve</button><button className={model === "alex" ? "active" : ""} onClick={() => setModel("alex")}>alex</button></div><label className="upload-button"><Upload size={15} />choose 64x64 png<input type="file" accept="image/png" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const form = new FormData(); form.append("skin", file); form.append("model", model); void update("upload", "/skin/upload", form); event.currentTarget.value = ""; }} /></label></div>
        </div>
      </div>
    </section>
  );
}

function ClientPicker({ clients, selected, onSelect }: { clients: ClientChoice[]; selected: string; onSelect: (id: ClientChoice["id"]) => void }) {
  return <div className="client-list">{clients.map((client) => <button key={client.id} className={selected === client.id ? "selected" : ""} onClick={() => onSelect(client.id)}><span className="radio"><span /></span><span className="client-version">{client.version}</span><span className={`client-tag tag-${client.label}`}>{client.label}</span><small>{client.description}</small><ChevronRight size={16} /></button>)}</div>;
}

function Dashboard({ data, onData, onStart, onLogout, notice, onPlay }: {
  data: BootstrapData;
  onData: (patch: Partial<BootstrapData>) => void;
  onStart: () => Promise<void>;
  onLogout: () => Promise<void>;
  notice: (message: string) => void;
  onPlay: (client: ClientChoice["id"]) => Promise<void>;
}) {
  const [client, setClient] = useState<ClientChoice["id"]>(() => (localStorage.getItem("spawnpoint.client") as ClientChoice["id"]) || "stable");
  const [launching, setLaunching] = useState(false);
  const status = data.server;
  const copy = statusCopy(status);
  const selected = data.clients.find((item) => item.id === client)!;
  const chooseClient = (id: ClientChoice["id"]) => { setClient(id); localStorage.setItem("spawnpoint.client", id); };

  return (
    <main className="dashboard">
      <header className="dashboard-header"><Logo /><nav><span><UserRound size={14} />{data.user!.username}</span><button onClick={() => void onLogout()} aria-label="log out"><LogOut size={15} />log out</button></nav></header>
      <section className={`status-band band-${status.phase}`}>
        <div className="status-orb"><Server size={24} /></div>
        <div><div className="eyebrow"><StatusPill status={status} /><span>shared survival world</span></div><h1>{copy.title}</h1><p>{copy.detail}</p></div>
        <div className="status-metrics"><div><span>players</span><strong>{status.players.length}<small>/{status.maxPlayers}</small></strong></div><div><span>idle sleep</span><strong>15<small> min</small></strong></div></div>
        <StartButton status={status} setupReady={data.setup.eulaAccepted} onStart={onStart} />
      </section>
      {!data.setup.eulaAccepted && <div className="setup-warning"><ShieldCheck size={17} /><span>the minecraft eula still needs to be accepted by the owner. set <code>MC_EULA=true</code> after reading it.</span></div>}
      <div className="dashboard-grid">
        <SkinStudio data={data} onUser={(user) => onData({ user })} notice={notice} />
        <section className="workspace-panel launch-panel">
          <div className="section-heading"><div><span className="section-index">02</span><p>client launch</p></div><span className="section-meta">pick your build</span></div>
          <ClientPicker clients={data.clients} selected={client} onSelect={chooseClient} />
          {client === "experimental" && <div className="beta-note"><span>beta reality check</span><p>this is a real modern community port, but it is heavier and less stable. use 1.12.2 on the old gram.</p></div>}
          <div className="launch-summary"><div><span>launching as</span><strong>{data.user!.username}</strong></div><div><span>client</span><strong>{selected.version} <small>{selected.label}</small></strong></div></div>
          <button className="button play-button" disabled={status.phase !== "online" || launching} onClick={async () => { setLaunching(true); try { await onPlay(client); } catch (error) { notice(error instanceof Error ? error.message : "launch failed"); } finally { setLaunching(false); } }}>{launching ? <RefreshCw className="spin" size={18} /> : <Play size={18} fill="currentColor" />}play as {data.user!.username}</button>
          {status.phase !== "online" && <p className="launch-hint">wake the server first, then the play button unlocks.</p>}
        </section>
      </div>
      <footer className="dashboard-footer"><span><Clock3 size={14} />server sleeps after 15 empty minutes</span><span><ShieldCheck size={14} />site account is enforced in game</span><span><Copy size={14} />world persists on the railway volume</span></footer>
    </main>
  );
}

export function App() {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [game, setGame] = useState<{ client: string; ticket: string; username: string } | null>(null);

  const notice = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(null), 4_500); }, []);
  const reload = useCallback(async () => { const next = await api<BootstrapData>("/bootstrap"); setData(next); }, []);

  useEffect(() => { void reload().catch(() => notice("could not reach spawnpoint")); }, [reload, notice]);
  useEffect(() => {
    const events = new EventSource("/api/server/events");
    events.onmessage = (event) => {
      const server = JSON.parse(event.data) as ServerStatus;
      setData((current) => current ? { ...current, server } : current);
    };
    return () => events.close();
  }, []);
  useEffect(() => {
    if (!game) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setGame(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [game]);

  const startServer = useCallback(async () => {
    const result = await api<{ server: ServerStatus }>("/server/start", { method: "POST" });
    setData((current) => current ? { ...current, server: result.server } : current);
  }, []);

  const auth = async (username: string, password: string, mode: "login" | "register") => {
    const result = await api<{ user: PublicUser; csrf: string }>(`/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    setData((current) => current ? { ...current, user: result.user, csrf: result.csrf } : current);
  };
  const logout = async () => {
    await api<void>("/auth/logout", { method: "POST", headers: { "x-spawnpoint-csrf": data!.csrf! } });
    setData((current) => current ? { ...current, user: null, csrf: null } : current);
  };
  const play = async (client: ClientChoice["id"]) => {
    const result = await api<{ ticket: string; username: string }>("/game-ticket", { method: "POST", headers: { "x-spawnpoint-csrf": data!.csrf! } });
    setGame({ client, ...result });
  };

  const gameUrl = useMemo(() => game ? `/game/${game.client}.html?ticket=${encodeURIComponent(game.ticket)}&account=${encodeURIComponent(game.username)}` : "", [game]);
  if (!data) return <div className="loading"><Logo /><span>loading world state</span></div>;

  return <>
    {data.user ? <Dashboard data={data} onData={(patch) => setData((current) => current ? { ...current, ...patch } : current)} onStart={startServer} onLogout={logout} notice={notice} onPlay={play} /> : <AuthScreen data={data} onAuth={auth} onStart={startServer} notice={notice} />}
    {toast && <div className="toast" role="status"><span>{toast}</span><button onClick={() => setToast(null)}><X size={15} /></button></div>}
    {game && <div className="game-shell"><div className="game-toolbar"><span>playing as {game.username}</span><button onClick={() => setGame(null)}><X size={15} />close game</button></div><iframe title={`minecraft ${game.client}`} src={gameUrl} allow="fullscreen; gamepad; clipboard-read; clipboard-write" allowFullScreen /></div>}
  </>;
}
