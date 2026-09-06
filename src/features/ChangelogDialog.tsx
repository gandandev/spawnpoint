import { History } from "@/components/pixel-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const changelog = [
  {
    dateTime: "2026-09-06",
    label: "2026. 9. 6.",
    updates: [
      "키 입력과 게임 메뉴를 고쳤어요.",
      "게임 로딩을 줄였어요.",
      "게임 화면 성능을 최적화했어요.",
      "채팅과 글꼴을 정리했어요.",
      "빈 서버는 3분 뒤 꺼져요.",
    ],
  },
  {
    dateTime: "2026-09-05",
    label: "2026. 9. 5.",
    updates: [
      "26.2로 업데이트했어요.",
      "인벤토리와 경험치를 유지했어요.",
      "월드를 새로 만들었어요.",
      "서버 설정과 관리자 화면을 정리했어요.",
      "게임 실행과 화면 성능을 개선했어요.",
    ],
  },
  {
    dateTime: "2026-09-03",
    label: "2026. 9. 3.",
    updates: [
      "채팅에 플레이어 머리를 추가했어요.",
      "관리자에서 인벤토리와 서버를 관리할 수 있어요.",
      "스킨 목록과 사용자 관리를 정리했어요.",
      "업데이트 알림과 카운트다운을 추가했어요.",
      "게임 조작을 개선했어요.",
    ],
  },
  {
    dateTime: "2026-09-02",
    label: "2026. 9. 2.",
    updates: [
      "모바일 게임 조작을 다듬었어요.",
      "게임 UI를 ESC 버튼으로 닫을 수 있어요.",
    ],
  },
  {
    dateTime: "2026-09-01",
    label: "2026. 9. 1.",
    updates: [
      "글꼴을 통일했어요.",
      "채팅과 ESC 동작을 고쳤어요.",
      "게임 접속 문제를 고쳤어요.",
      "스킨 전달 문제를 고쳤어요.",
      "링크 미리보기를 안정화했어요.",
    ],
  },
  {
    dateTime: "2026-08-31",
    label: "2026. 8. 31.",
    updates: [
      "멀티플레이 스킨 표시를 고쳤어요.",
      "위치 표시기 움직임을 고쳤어요.",
      "로그인 안내를 정확하게 고쳤어요.",
      "공유 미리보기를 다듬었어요.",
    ],
  },
  {
    dateTime: "2026-08-30",
    label: "2026. 8. 30.",
    updates: [
      "게임 클라이언트를 업데이트했어요.",
      "스킨 목록과 이름표를 정리했어요.",
      "관리자 기능을 늘렸어요.",
      "게임 로딩을 빠르게 했어요.",
      "자원 사용을 줄였어요.",
    ],
  },
  {
    dateTime: "2026-08-29",
    label: "2026. 8. 29.",
    updates: [
      "스킨을 추가했어요.",
      "게임 로딩과 캐시를 개선했어요.",
      "로그인 이름과 게임 이름을 정리했어요.",
      "TPA 응답 명령어를 추가했어요.",
      "프론트와 게임 서버를 나눠 안정성을 높였어요.",
    ],
  },
  {
    dateTime: "2026-08-28",
    label: "2026. 8. 28.",
    updates: [
      "회원가입과 모바일 조작을 추가했어요.",
      "로그인 오류 표시를 다듬었어요.",
      "인벤토리 클릭과 드래그 문제를 고쳤어요.",
      "게임 채팅과 월드 조작 충돌을 고쳤어요.",
    ],
  },
  {
    dateTime: "2026-08-26",
    label: "2026. 8. 26.부터",
    updates: [
      "한국어 게임 클라이언트와 포탈을 연결했어요.",
      "모바일 게임 조작을 추가했어요.",
      "게임 메뉴와 Spawnpoint 디자인을 정리했어요.",
      "관리자 플레이어 관리를 추가했어요.",
    ],
  },
] as const;

export function ChangelogDialog() {
  return <Dialog>
    <DialogTrigger asChild>
      <Button variant="ghost" size="icon-sm" className="cursor-pointer text-muted-foreground" aria-label="변경 내역" title="변경 내역"><History /></Button>
    </DialogTrigger>
    <DialogContent className="max-h-[min(46rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] overflow-y-auto ring-0 sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>변경 내역</DialogTitle>
        <DialogDescription>spawnpoint 업데이트 기록입니다.</DialogDescription>
      </DialogHeader>
      <section className="flex flex-col gap-5">
        {changelog.map((entry, index) => <article key={entry.dateTime} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <time dateTime={entry.dateTime} className="font-medium text-muted-foreground">{entry.label}</time>
            {index === 0 ? <span className="rounded-full bg-[#96ce4d]/15 px-2 py-0.5 text-[11px] font-medium text-[#65952c]">최신</span> : null}
          </div>
          <div className="flex flex-col gap-1 text-sm leading-relaxed">
            {entry.updates.map((update) => <p key={update}>{update}</p>)}
          </div>
        </article>)}
      </section>
    </DialogContent>
  </Dialog>;
}
