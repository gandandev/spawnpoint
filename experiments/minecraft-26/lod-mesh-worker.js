self.onmessage = ({ data }) => {
  const tiles = new Map(data.tiles.map(t => [`${t.x},${t.z}`, t]));
  const output = [];
  function height(x, z, fallback) {
    const tx = Math.floor(x / 16), tz = Math.floor(z / 16), tile = tiles.get(`${tx},${tz}`);
    return tile ? tile.cells[((Math.floor(z - tz * 16) >> 2) * 4 + (Math.floor(x - tx * 16) >> 2)) * 2] : fallback - 8;
  }
  function quad(points, color, shade) {
    const rgb = [(color >> 16 & 255) / 255 * shade, (color >> 8 & 255) / 255 * shade, (color & 255) / 255 * shade];
    for (const i of [0, 1, 2, 0, 2, 3]) output.push(...points[i], ...rgb);
  }
  for (const tile of tiles.values()) for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) {
    const px = tile.x * 16 + x * 4, pz = tile.z * 16 + z * 4;
    const y = tile.cells[(z * 4 + x) * 2], color = tile.cells[(z * 4 + x) * 2 + 1];
    quad([[px,y,pz],[px+4,y,pz],[px+4,y,pz+4],[px,y,pz+4]], color, 1);
    const east = height(px + 4, pz, y), south = height(px, pz + 4, y);
    if (east !== y) quad([[px+4,y,pz],[px+4,east,pz],[px+4,east,pz+4],[px+4,y,pz+4]], color, .72);
    if (south !== y) quad([[px,y,pz+4],[px,south,pz+4],[px+4,south,pz+4],[px+4,y,pz+4]], color, .86);
  }
  const vertices = new Float32Array(output);
  self.postMessage({ world: data.world, vertices }, [vertices.buffer]);
};
