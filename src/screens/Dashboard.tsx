import { lazy, Suspense, useEffect, useState } from "react";
import { LogOut, Play, Shield, ShieldCheck, X } from "lucide-react";
import { AccountDialog } from "@/features/AccountDialog";
import { Logo, ServerCard } from "@/components/portal";
import { SkinPreview } from "@/SkinPreview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { waitForServerOnline } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { BootstrapData, ClientChoice, PublicUser } from "@/types";

const SkinStudio = lazy(() => import("@/features/SkinStudio").then((module) => ({ default: module.SkinStudio })));

interface DashboardProps {
  data: BootstrapData;
  onData: (patch: Partial<BootstrapData>) => void;
  onSession: (user: PublicUser, csrf: string) => void;
  onStart: () => Promise<void>;
  onLogout: () => Promise<void>;
  notice: (message: string) => void;
  onPlay: (client: ClientChoice["id"]) => Promise<void>;
  onOpenAdmin: () => void;
  onRevokeAdmin: () => Promise<void>;
  onAdminExpired: () => void;
  initialSkinDialogOpen: boolean;
  onInitialSkinDialogHandled: () => void;
}

function AdminShortcut({ expiresAt, onOpen, onRevoke, onExpire }: { expiresAt: number; onOpen: () => void; onRevoke: () => Promise<void>; onExpire: () => void }) {
  const [minutes, setMinutes] = useState(() => Math.max(0, Math.ceil((expiresAt - Date.now()) / 60_000)));
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    let timer: number | null = null;
    const update = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        setMinutes(0);
        onExpire();
        return;
      }
      const nextMinutes = Math.ceil(remaining / 60_000);
      setMinutes(nextMinutes);
      const nextBoundary = remaining - (nextMinutes - 1) * 60_000;
      timer = window.setTimeout(update, Math.max(250, nextBoundary + 25));
    };
    update();
    return () => { if (timer !== null) window.clearTimeout(timer); };
  }, [expiresAt, onExpire]);

  if (minutes <= 0) return null;
  return <div className="group/admin flex h-7 shrink-0 items-center overflow-hidden rounded-[min(var(--radius-md),12px)] bg-muted text-xs text-muted-foreground max-sm:h-11 [@media(max-height:480px)]:h-11 [@media(pointer:coarse)]:h-11" aria-label={`관리자 바로가기, ${minutes}분 남음`}>
    <button type="button" className="flex size-7 shrink-0 touch-manipulation cursor-pointer items-center justify-center transition-colors max-sm:size-11 [@media(max-height:480px)]:size-11 [@media(pointer:coarse)]:size-11 hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onOpen} aria-label="관리자 페이지 열기" title="관리자 패널">
      <Shield className="size-3.5" />
    </button>
    <button type="button" className="group/lock flex h-full min-w-8 shrink-0 touch-manipulation cursor-pointer items-center justify-center px-1.5 transition-colors max-sm:min-w-11 [@media(max-height:480px)]:min-w-11 [@media(pointer:coarse)]:min-w-11 hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none" disabled={revoking} onClick={() => {
      setRevoking(true);
      void onRevoke().catch(() => setRevoking(false));
    }} aria-label="관리자 잠금" title="관리자 잠금">
      <span className="grid min-w-[2ch] place-items-center" aria-hidden="true">
        <span data-slot="admin-shortcut-time" className={cn("col-start-1 row-start-1 tabular-nums transition-opacity", revoking ? "opacity-0" : "group-hover/admin:opacity-0 group-focus/lock:opacity-0")}>{minutes}분</span>
        <span data-slot="admin-shortcut-lock" className={cn("col-start-1 row-start-1 transition-opacity", revoking ? "opacity-100" : "opacity-0 group-hover/admin:opacity-100 group-focus/lock:opacity-100")}>
          {revoking ? <Spinner /> : <X className="size-3" />}
        </span>
      </span>
    </button>
  </div>;
}

export function Dashboard({ data, onData, onSession, onStart, onLogout, notice, onPlay, onOpenAdmin, onRevokeAdmin, onAdminExpired, initialSkinDialogOpen, onInitialSkinDialogHandled }: DashboardProps) {
  const [launching, setLaunching] = useState(false);
  const [skinDialogOpen, setSkinDialogOpen] = useState(() => initialSkinDialogOpen);
  const selected = data.clients[0]!;
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

  return <main className="dashboard-shell">
    <header className="dashboard-header">
      <Logo />
      <div className="dashboard-actions">
        {data.user?.isAdmin && data.adminExpiresAt && data.adminExpiresAt > Date.now() ? <AdminShortcut expiresAt={data.adminExpiresAt} onOpen={onOpenAdmin} onRevoke={onRevokeAdmin} onExpire={onAdminExpired} /> : null}
        <AccountDialog data={data} onSession={onSession} notice={notice} />
        <Button variant="ghost" size="icon-sm" className="cursor-pointer text-muted-foreground" onClick={() => void onLogout()} aria-label="로그아웃" title="로그아웃"><LogOut /></Button>
      </div>
    </header>
    <ServerCard status={data.server} setupReady={data.setup.eulaAccepted} onStart={onStart} compact showPlayerDropdown />
    {!data.setup.eulaAccepted && <Alert><ShieldCheck /><AlertTitle>서버 설정이 필요해요</AlertTitle><AlertDescription>소유자가 아직 마인크래프트 EULA에 동의하지 않았어요. <code>MC_EULA=true</code>로 설정하세요.</AlertDescription></Alert>}
    <section className="character-stage" aria-label="캐릭터 미리보기">
      <SkinPreview src={data.user!.skin.previewUrl} model={data.user!.skin.model} nameTag={data.user!.displayName} className="character-preview" />
      <Dialog open={skinDialogOpen} onOpenChange={(open) => {
        setSkinDialogOpen(open);
        if (!open) onInitialSkinDialogHandled();
      }}>
        <DialogTrigger asChild><Button variant="outline" className="character-change active:scale-[0.98]">스킨 변경</Button></DialogTrigger>
        <DialogContent className="max-h-[min(46rem,calc(100dvh-1rem))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden ring-0 sm:max-w-md">
          <DialogHeader><DialogTitle>스킨 변경</DialogTitle><DialogDescription className="sr-only">스킨을 고르거나 가져오고 업로드합니다.</DialogDescription></DialogHeader>
          <Suspense fallback={<div className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />카탈로그 불러오는 중</div>}>
            <SkinStudio data={data} onUser={(user) => onData({ user })} onChanged={() => { setSkinDialogOpen(false); onInitialSkinDialogHandled(); }} notice={notice} />
          </Suspense>
        </DialogContent>
      </Dialog>
    </section>
    <Button size="lg" className="h-11 w-full rounded-full px-4" disabled={launching || serverBusy || !data.setup.eulaAccepted} onClick={() => void execute()}>
      {launching || serverBusy ? <Spinner /> : <Play fill="currentColor" />}<span>{data.server.phase === "off" ? "서버 켜고 실행" : "실행"}</span>
    </Button>
  </main>;
}
