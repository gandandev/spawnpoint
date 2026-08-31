export const SPAWNPOINT_MINECRAFT_WORDMARK_ROWS = [
  "..........................................#........#..",
  "...................................................#..",
  ".####.#.##...###..#...#.####..#.##...###..#.####..###.",
  "#.....##..#.....#.#...#.#...#.##..#.#...#.#.#...#..#..",
  ".###..#...#..####.#.#.#.#...#.#...#.#...#.#.#...#..#..",
  "....#.####..#...#.#.#.#.#...#.####..#...#.#.#...#..#..",
  "####..#......####..####.#...#.#......###..#.#...#...#.",
  "......#.......................#.......................",
] as const;

export const SPAWNPOINT_MINECRAFT_WORDMARK_WIDTH = SPAWNPOINT_MINECRAFT_WORDMARK_ROWS[0].length;
export const SPAWNPOINT_MINECRAFT_WORDMARK_HEIGHT = SPAWNPOINT_MINECRAFT_WORDMARK_ROWS.length;

export const SPAWNPOINT_MINECRAFT_WORDMARK_PATH = SPAWNPOINT_MINECRAFT_WORDMARK_ROWS
  .flatMap((row, y) => {
    const segments: string[] = [];
    let x = 0;
    while (x < row.length) {
      while (x < row.length && row[x] === ".") x += 1;
      if (x >= row.length) break;
      const start = x;
      while (x < row.length && row[x] === "#") x += 1;
      const length = x - start;
      segments.push(`M${start} ${y}h${length}v1h-${length}z`);
    }
    return segments;
  })
  .join("");
