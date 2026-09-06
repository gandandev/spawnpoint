import { lazy, Suspense, useState } from "react";
import { LogOut, Play, Shield, AdminBadge, Eye } from "@/components/pixel-icons";
import { AccountDialog } from "@/features/AccountDialog";
import { ChangelogDialog } from "@/features/ChangelogDialog";
import { Logo, ServerCard } from "@/components/portal";
import { SkinPreview } from "@/SkinPreview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { waitForServerOnline } from "@/lib/api";
import type { BootstrapData, SessionUpdate } from "@/types";

const SkinStudio = lazy(() => import("@/features/SkinStudio").then((module) => ({ default: module.SkinStudio })));

interface DashboardProps {
  data: BootstrapData;
  onData: (patch: Partial<BootstrapData>) => void;
  onSession: (user: SessionUpdate["user"], csrf: string, adminExpiresAt: number | null) => void;
  onStart: () => Promise<void>;
  onLogout: () => Promise<void>;
  notice: (message: string) => void;
  onPlay: (spectator?: boolean) => Promise<void>;
  onOpenAdmin: () => void;
  initialSkinDialogOpen: boolean;
  onInitialSkinDialogHandled: () => void;
}

export function Dashboard({ data, onData, onSession, onStart, onLogout, notice, onPlay, onOpenAdmin, initialSkinDialogOpen, onInitialSkinDialogHandled }: DashboardProps) {
  const [launching, setLaunching] = useState(false);
  const [skinDialogOpen, setSkinDialogOpen] = useState(() => initialSkinDialogOpen);
  const serverBusy = ["preparing", "starting", "stopping"].includes(data.server.phase);

  const execute = async (spectator = false) => {
    setLaunching(true);
    try {
      if (data.server.phase !== "online") {
        await onStart();
        if (data.server.version !== "Paper 26.2") await waitForServerOnline();
      }
      if (spectator) await onPlay(true);
      else await onPlay();
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
        <ChangelogDialog />
        <Button variant="ghost" size="icon-sm" className="cursor-pointer text-muted-foreground" onClick={onOpenAdmin} aria-label="관리자 패널" title="관리자 패널"><Shield /></Button>
        <AccountDialog data={data} onSession={onSession} notice={notice} />
        <Button variant="ghost" size="icon-sm" className="cursor-pointer text-muted-foreground" onClick={() => void onLogout()} aria-label="로그아웃" title="로그아웃"><LogOut /></Button>
      </div>
    </header>
    <ServerCard status={data.server} showPlayerDropdown />
    {!data.setup.eulaAccepted && <Alert><AdminBadge /><AlertTitle>서버 설정이 필요해요</AlertTitle><AlertDescription>소유자가 아직 마인크래프트 EULA에 동의하지 않았어요. <code>MC_EULA=true</code>로 설정하세요.</AlertDescription></Alert>}
    <section className="character-stage" aria-label="캐릭터 미리보기">
      <SkinPreview src={data.user!.skin.previewUrl} model={data.user!.skin.model} nameTag={data.user!.displayName} className="character-preview" paused={skinDialogOpen} />
      <Dialog open={skinDialogOpen} onOpenChange={(open) => {
        setSkinDialogOpen(open);
        if (!open) onInitialSkinDialogHandled();
      }}>
        <DialogTrigger asChild><Button variant="outline" size="lg" className="character-change border-0 px-3 text-base shadow-none">스킨 변경</Button></DialogTrigger>
        <DialogContent className="max-h-[min(46rem,calc(100dvh-1rem))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden ring-0 sm:max-w-md">
          <DialogHeader><DialogTitle>스킨 변경</DialogTitle><DialogDescription className="sr-only">스킨을 고르거나 가져오고 업로드합니다.</DialogDescription></DialogHeader>
          <Suspense fallback={<div className="flex min-h-52 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner />카탈로그 불러오는 중</div>}>
            <SkinStudio data={data} onUser={(user) => onData({ user })} onChanged={() => { setSkinDialogOpen(false); onInitialSkinDialogHandled(); }} notice={notice} />
          </Suspense>
        </DialogContent>
      </Dialog>
    </section>
    <div className="flex w-full items-center gap-2">
      <Button size="lg" className="h-11 w-full rounded-full px-4" disabled={launching || serverBusy || !data.setup.eulaAccepted} onClick={() => void execute()}>
        {launching || serverBusy ? <Spinner /> : <Play fill="currentColor" />}<span>{data.server.phase === "off" ? "서버 켜고 실행" : "실행"}</span>
      </Button>
      {data.canSpectate && <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full text-muted-foreground" aria-label="조용히 관전" title="조용히 관전" disabled={launching || serverBusy || !data.setup.eulaAccepted} onClick={() => void execute(true)}><Eye /></Button>}
    </div>
  </main>;
}
