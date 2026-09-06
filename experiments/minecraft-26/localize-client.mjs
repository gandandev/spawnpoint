export const launcherTranslations = [
  ["Loading Eaglercraft 26.2 runtime…", "Eaglercraft 26.2 실행 환경을 불러오는 중…"],
  ["Downloading assets… ", "게임 파일을 받는 중… "],
  ["<div><strong>Rotate your device</strong>Eaglercraft requires landscape mode on phones.</div>", "<div><strong>기기를 가로로 돌려 주세요</strong></div>"],
  ["Eaglercraft could not continue.", "Eaglercraft를 계속 실행할 수 없습니다."],
  ["This report was cached and will still be available after reloading.", "이 오류 보고서는 저장되었으며 새로고침한 뒤에도 확인할 수 있습니다."],
  ["The previous game stopped responding or its renderer was terminated. Its last stall and memory telemetry were recovered.", "이전 게임이 응답하지 않았거나 화면 처리가 중단되었습니다. 마지막 멈춤과 메모리 기록을 복구했습니다."],
  ["The previous game session ended unexpectedly. Its crash and memory telemetry was recovered.", "이전 게임이 갑자기 끝났습니다. 오류와 메모리 기록을 복구했습니다."],
  ["Download Report", "오류 보고서 받기"],
  ["Dismiss", "닫기"],
];

export function localizeLauncher(html) {
  for (const [english, korean] of launcherTranslations) {
    const matches = html.split(english).length - 1;
    if (matches !== 1) {
      throw new Error(`26.2 launcher has ${matches} copies of: ${english}`);
    }
    html = html.replace(english, korean);
  }
  return html;
}
