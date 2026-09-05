import { ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const changelog = [
  {
    dateTime: "2026-09-05",
    label: "2026. 9. 5.",
    changes: [
      "Java 26.2 별도 테스트 서버를 배포했어요. 기존 계정과 46명분 인벤토리·엔더 상자·경험치를 보존하고, 지형을 새로 생성해 스폰에서 시작해요. 메인 서버는 그대로예요.",
      "실험판의 기본 브라우저 클라이언트를 Java Edition 26.2의 Wasm 개발 빌드로 바꾸고 26.2 서버 접속을 확인했어요. 맥북에서 두 화면 설정 모두 안정적인 60 FPS가 보고됐어요. 다른 기기의 성능과 새 빌드의 횃불 조명은 아직 확인되지 않았어요.",
      "이전 26.1.2 비교용 실험판에서 모델 좌표의 소수점 오차로 초기 오류가 반복되던 문제를 고쳤어요. 반복 재생에 실패하는 배경 음악은 기본으로 껐어요.",
      "26 버전 실험판에 FOV 90과 기기별 기본 그래픽 설정, 화면 크기에 맞춘 GUI 크기 자동 설정을 추가했어요. 실제 기기의 60·120 FPS 유지는 아직 확인 중이에요.",
      "이전 26.1.2 비교용 실험판의 횃불 조명을 클라이언트 지형 렌더링으로 옮겼어요. 서버 블록 갱신 없이 양손의 횃불로 주변을 밝힐 수 있어요.",
      "별도 개발 환경에 26.2 서버와 26.1.2 브라우저 클라이언트 실험판, 인벤토리와 경험치를 새 월드로 옮기는 도구를 추가했어요. 현재 서비스에는 적용하지 않았어요.",
      "추가 다이아를 2~5개짜리 덩어리로 더 자주 찾도록 조정했어요. 기존 청크에도 한 번 적용하며, 이미 있는 광석은 유지해요.",
      "사용하지 않는 화면 구성 요소와 예전 TPA 설정 경로를 정리했어요.",
      "게임 접속 상태의 불필요한 타이머와 사용하지 않는 위치 조회 경로를 없앴어요.",
      "게임 실행 절차를 단순하게 정리하고 서버와 화면이 같은 데이터 형식을 쓰도록 맞췄어요.",
      "관리자 화면의 중복 로그 전송과 스킨 변경 후 불필요한 요청을 없앴어요.",
      "개발 중 생성된 결과 파일은 배포 이미지에서 제외하도록 정리했어요.",
      "모바일 컨트롤이 같은 화면 상태를 반복해서 갱신할 수 있는 문제를 고쳤어요.",
      "게임 WASM의 청크 작업 중복 검사를 한 번의 순회로 바꿔 반복 탐색과 임시 객체 생성을 줄였어요.",
      "반복 갱신 후에도 위치 표시기의 이름 배치가 유지되도록 고쳤어요.",
      "위치 표시기를 갱신할 때 플레이어 위치를 한 번씩만 읽도록 바꿨어요.",
      "스킨을 바꿀 때 위치 표시기에 이전 머리 이미지가 다시 나타날 수 있는 문제를 고쳤어요.",
      "플레이어가 없을 때는 배포 확인 요청을 멈춰 서버의 불필요한 통신을 줄였어요.",
    ],
  },
  {
    dateTime: "2026-09-03",
    label: "2026. 9. 3.",
    changes: [
      "기본 스킨을 진짜 마인크래프트 스티브로 바꿨어요.",
      "위치 표시기에 플레이어 이름, 머리와 직선 거리를 추가했어요.",
      "위치 표시기의 거리는 정수 m로 표시해요.",
      "게임 UI를 닫으면 마우스가 바로 고정되고, 채팅 입력 뒤 기본 채팅창이 남지 않게 고쳤어요.",
      "채팅 메시지에 플레이어 머리를 추가했어요.",
      "새 버전이 배포되면 채팅으로 알리고, 서버 업데이트 전에는 카운트다운을 보여줘요.",
      "관리자에서 실제 마인크래프트 인벤토리 UI, 사용자 보관함, 사용자 정렬을 사용할 수 있어요.",
      "관리자에서 서버 설정, 콘솔, 플레이어 상태와 데이터를 관리할 수 있어요.",
      "접속, 채팅, 명령어와 개인 메시지 기록을 관리자 화면에서 확인할 수 있어요.",
      "스킨 목록에서 각 스킨을 사용하는 사람을 확인하고, 빠졌던 스킨도 다시 고를 수 있어요.",
      "대시보드의 중복 서버 시작 버튼을 없앴어요.",
    ],
  },
  {
    dateTime: "2026-09-02",
    label: "2026. 9. 2.",
    changes: [
      "모바일에서도 인벤토리와 게임 UI를 ESC 버튼으로 닫을 수 있어요.",
      "멀티플레이 스킨의 색이 뒤집혀 보이던 문제를 고쳤어요.",
    ],
  },
  {
    dateTime: "2026-09-01",
    label: "2026. 9. 1.",
    changes: [
      "포탈 전체 글꼴을 갈무리로 통일했어요.",
      "게임 안의 영문 글꼴은 마인크래프트 원본 모양으로 유지했어요.",
      "게임 채팅 입력과 ESC 동작을 더 안정적으로 고쳤어요.",
      "게임 접속 게이트웨이와 사용자 스킨 전달 문제를 고쳤어요.",
      "게임 서버 호환성과 연결 보안을 강화했어요.",
      "링크 공유 미리보기 이미지가 안정적으로 표시되게 고쳤어요.",
    ],
  },
  {
    dateTime: "2026-08-31",
    label: "2026. 8. 31.",
    changes: [
      "멀티플레이 스킨 표시와 위치 표시기의 움직임을 고쳤어요.",
      "로그인과 회원가입 오류 안내를 더 정확하게 보여줘요.",
      "포탈 로고에 마인크래프트 워드마크를 적용했어요.",
      "공유 미리보기의 배경, 글꼴과 외곽선을 다듬었어요.",
    ],
  },
  {
    dateTime: "2026-08-30",
    label: "2026. 8. 30.",
    changes: [
      "내장 게임 클라이언트를 새 버전으로 올렸어요.",
      "스킨 목록을 분류하고 마인크래프트 이름표를 적용했어요.",
      "서버 관리자 기능과 계정 설정을 크게 늘렸어요.",
      "게임 파일을 나눠 받아 실행이 더 빨리 시작되게 했어요.",
      "게임을 보지 않을 때 위치 표시기 갱신을 멈춰 자원 사용을 줄였어요.",
    ],
  },
  {
    dateTime: "2026-08-29",
    label: "2026. 8. 29.",
    changes: [
      "스킨 목록을 늘리고 가려진 3D 미리보기의 렌더링을 멈추게 했어요.",
      "게임 로딩과 캐시를 개선해 다시 접속할 때 더 빠르게 열려요.",
      "로그인 이름과 게임 이름의 동작을 정리했어요.",
      "TPA 요청에 바로 쓸 수 있는 응답 명령어를 보여줘요.",
      "낮에도 침대를 부활 지점으로 지정할 수 있어요.",
      "프론트와 게임 서버를 나눠 배포해 포탈이 더 안정적으로 열려요.",
    ],
  },
  {
    dateTime: "2026-08-28",
    label: "2026. 8. 28.",
    changes: [
      "회원가입 흐름과 모바일 게임 조작을 정식으로 추가했어요.",
      "로그인 화면 전환과 오류 표시를 다듬었어요.",
      "인벤토리 클릭과 드래그가 막히던 구역을 고쳤어요.",
      "게임 채팅과 월드 상호작용이 서로 방해하던 문제를 고쳤어요.",
    ],
  },
  {
    dateTime: "2026-08-26",
    label: "2026. 8. 26.부터",
    changes: [
      "한국어 게임 클라이언트와 포탈 연동을 시작했어요.",
      "모바일 이동, 시점, 공격과 길게 눌러 블록 캐기 조작을 추가했어요.",
      "게임 안 메뉴와 Spawnpoint 브랜딩을 정리했어요.",
      "관리자 플레이어 관리와 사용자별 게임 이름 처리를 추가했어요.",
    ],
  },
] as const;

export function ChangelogDialog() {
  return <Dialog>
    <DialogTrigger asChild>
      <Button variant="ghost" size="icon-sm" className="cursor-pointer text-muted-foreground" aria-label="변경 내역" title="변경 내역"><ScrollText /></Button>
    </DialogTrigger>
    <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto ring-0 sm:max-w-md">
      <DialogHeader>
        <DialogTitle>변경 내역</DialogTitle>
        <DialogDescription>spawnpoint 업데이트 기록입니다.</DialogDescription>
      </DialogHeader>
      <section className="space-y-3">
        {changelog.map((entry, index) => <article key={entry.dateTime} className="rounded-lg border p-4">
          <div className="mb-3 flex items-center gap-2">
            <time dateTime={entry.dateTime} className="font-medium">{entry.label}</time>
            {index === 0 ? <span className="rounded-full bg-[#96ce4d]/15 px-2 py-0.5 text-[11px] font-medium text-[#65952c]">최신</span> : null}
          </div>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
            {entry.changes.map((change) => <li key={change}>{change}</li>)}
          </ul>
        </article>)}
      </section>
    </DialogContent>
  </Dialog>;
}
