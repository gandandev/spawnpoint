import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const latestChanges = [
  "위치 표시기에 플레이어 머리와 직선 거리를 추가했어요.",
  "게임 UI를 닫으면 마우스가 바로 고정되고, 채팅 입력 뒤 기본 채팅창이 남지 않게 고쳤어요.",
  "채팅 메시지에 플레이어 머리를 추가했어요.",
  "새 버전이 배포되면 채팅으로 알리고, 서버 업데이트 전에는 카운트다운을 보여줘요.",
  "관리자에서 마인크래프트 인벤토리 UI, 사용자 보관함, 사용자 정렬을 사용할 수 있어요.",
  "대시보드의 중복 서버 시작 버튼을 없앴어요.",
];

export function ChangelogDialog() {
  return <Dialog>
    <DialogTrigger asChild>
      <Button variant="ghost" size="icon-sm" className="cursor-pointer text-muted-foreground" aria-label="변경 내역" title="변경 내역"><ScrollText /></Button>
    </DialogTrigger>
    <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto ring-0 sm:max-w-md">
      <DialogHeader>
        <DialogTitle>변경 내역</DialogTitle>
        <DialogDescription>spawnpoint가 최근 바뀐 내용입니다.</DialogDescription>
      </DialogHeader>
      <article className="rounded-lg border p-4">
        <div className="mb-3 flex items-center gap-2">
          <time dateTime="2026-09-03" className="font-medium">2026. 9. 3.</time>
          <span className="rounded-full bg-[#96ce4d]/15 px-2 py-0.5 text-[11px] font-medium text-[#65952c]">최신</span>
        </div>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          {latestChanges.map((change) => <li key={change}>{change}</li>)}
        </ul>
      </article>
    </DialogContent>
  </Dialog>;
}
