export function validateReleaseNote(note, expectedVersion) {
  if (!note || !/^v[1-9]\d*$/.test(note.version)) {
    throw new Error("배포 안내에 version을 v142 형태로 작성하세요.");
  }
  for (const [key, limit] of [["title", 60], ["description", 200]]) {
    const value = note[key];
    if (typeof value !== "string" || !value.trim() || value !== value.trim()
      || value.length > limit || /[\x00-\x1f\x7f]/.test(value)) {
      throw new Error(`배포 안내의 ${key}을 1~${limit}자의 한 줄로 작성하세요.`);
    }
  }
  if (expectedVersion && note.version !== expectedVersion) {
    throw new Error(`이번 배포(${expectedVersion})의 제목과 설명을 src/release-note.json에 작성하세요.`);
  }
}
