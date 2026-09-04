#!/usr/bin/env python3
"""Extract the native 1.12 inventory UI and a compact item texture atlas."""

from __future__ import annotations

import io
import json
import lzma
import math
import runpy
import tarfile
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
CLIENT = ROOT / "vendor/clients/stable-galmuri.epw"
NEW_DEFAULT_PACK = ROOT / "public/game/resource-packs/new-default-v2.tar.gz"
PUBLIC_OUTPUT = ROOT / "public/assets/minecraft/admin-inventory"
MANIFEST_OUTPUT = ROOT / "src/generated/minecraft-item-atlas.ts"
GUI_PREFIX = "assets/minecraft/textures/gui/container/"
TEXTURE_PREFIXES = {
    "item": "assets/minecraft/textures/items/",
    "block": "assets/minecraft/textures/blocks/",
}
ATLAS_COLUMNS = 32
CELL_SIZE = 16
BED_COLORS = (
    "white",
    "orange",
    "magenta",
    "light_blue",
    "yellow",
    "lime",
    "pink",
    "gray",
    "silver",
    "cyan",
    "purple",
    "blue",
    "brown",
    "green",
    "red",
    "black",
)


def load_entries() -> dict[str, bytes]:
    client_tools = runpy.run_path(str(ROOT / "scripts/build-client-font.py"))
    bundle = CLIENT.read_bytes()
    record = client_tools["read_epw_records"](bundle)[0]
    epk = lzma.decompress(
        bundle[record.data_offset : record.data_offset + record.compressed_length]
    )
    _, _, entries = client_tools["parse_epk"](epk)
    files = {entry.name: entry.data for entry in entries}
    if not NEW_DEFAULT_PACK.is_file():
        raise SystemExit(f"Missing bundled resource pack: {NEW_DEFAULT_PACK}")
    with tarfile.open(NEW_DEFAULT_PACK, "r:gz") as archive:
        for member in archive.getmembers():
            if not member.isfile():
                continue
            source = archive.extractfile(member)
            if source is not None:
                files[member.name.removeprefix("./")] = source.read()
    return files


def first_frame(data: bytes) -> Image.Image:
    texture = Image.open(io.BytesIO(data)).convert("RGBA")
    frame_size = min(texture.width, texture.height)
    frame = texture.crop((0, 0, frame_size, frame_size))
    if frame.size != (CELL_SIZE, CELL_SIZE):
        frame = frame.resize((CELL_SIZE, CELL_SIZE), Image.Resampling.NEAREST)
    return frame


def ender_chest_icon(data: bytes) -> Image.Image:
    texture = Image.open(io.BytesIO(data)).convert("RGBA")
    if texture.size != (64, 64):
        raise ValueError("Ender chest texture must be 64 by 64 pixels")
    icon = Image.new("RGBA", (CELL_SIZE, CELL_SIZE))
    top = texture.crop((14, 1, 29, 14)).resize((CELL_SIZE, 5), Image.Resampling.NEAREST)
    front = texture.crop((15, 34, 29, 44)).resize((CELL_SIZE, 11), Image.Resampling.NEAREST)
    icon.paste(top, (0, 0), top)
    icon.paste(front, (0, 5), front)
    return icon


def bed_icon(data: bytes) -> Image.Image:
    texture = Image.open(io.BytesIO(data)).convert("RGBA")
    if texture.size != (64, 64):
        raise ValueError("Bed texture must be 64 by 64 pixels")
    return texture.crop((2, 1, 27, 26)).resize((CELL_SIZE, CELL_SIZE), Image.Resampling.NEAREST)


def model_texture_key(entries: dict[str, bytes], model_path: str) -> str | None:
    textures: dict[str, str] = {}
    current_path = model_path
    visited: set[str] = set()
    while current_path not in visited:
        visited.add(current_path)
        data = entries.get(current_path)
        if data is None:
            break
        model = json.loads(data)
        model_textures = model.get("textures")
        if isinstance(model_textures, dict):
            for name, value in model_textures.items():
                if isinstance(name, str) and isinstance(value, str) and name not in textures:
                    textures[name] = value
        parent = model.get("parent")
        if not isinstance(parent, str) or parent.startswith("builtin/"):
            break
        parent = parent.removeprefix("minecraft:")
        current_path = f"assets/minecraft/models/{parent}.json"

    def resolve(value: str) -> str | None:
        seen: set[str] = set()
        while value.startswith("#"):
            name = value[1:]
            if name in seen or name not in textures:
                return None
            seen.add(name)
            value = textures[name]
        value = value.removeprefix("minecraft:")
        if value.startswith("items/"):
            return f"item:{value.removeprefix('items/')}"
        if value.startswith("blocks/"):
            return f"block:{value.removeprefix('blocks/')}"
        return None

    for name in ("layer0", "front", "top", "up", "all", "side", "particle"):
        value = textures.get(name)
        if value is not None and (key := resolve(value)) is not None:
            return key
    for value in textures.values():
        if (key := resolve(value)) is not None:
            return key
    return None


def save_gui_textures(entries: dict[str, bytes]) -> None:
    inventory = Image.open(io.BytesIO(entries[f"{GUI_PREFIX}inventory.png"])).convert("RGBA")
    chest = Image.open(io.BytesIO(entries[f"{GUI_PREFIX}generic_54.png"])).convert("RGBA")
    inventory.crop((0, 0, 176, 166)).save(
        PUBLIC_OUTPUT / "player.png", optimize=True, compress_level=9
    )

    ender = Image.new("RGBA", (176, 167))
    ender.paste(chest.crop((0, 0, 176, 71)), (0, 0))
    ender.paste(chest.crop((0, 126, 176, 222)), (0, 71))
    ender.save(PUBLIC_OUTPUT / "ender.png", optimize=True, compress_level=9)


def save_item_atlas(entries: dict[str, bytes]) -> None:
    textures: list[tuple[str, Image.Image]] = []
    for kind, prefix in TEXTURE_PREFIXES.items():
        for path in sorted(entries):
            if not path.startswith(prefix) or not path.endswith(".png"):
                continue
            key = f"{kind}:{Path(path).stem}"
            textures.append((key, first_frame(entries[path])))

    textures.append(("item:ender_chest", ender_chest_icon(entries["assets/minecraft/textures/entity/chest/ender.png"])))
    for color in BED_COLORS:
        path = f"assets/minecraft/textures/entity/bed/{color}.png"
        textures.append((f"item:bed_{color}", bed_icon(entries[path])))

    rows = math.ceil(len(textures) / ATLAS_COLUMNS)
    atlas = Image.new("RGBA", (ATLAS_COLUMNS * CELL_SIZE, rows * CELL_SIZE))
    indexes: list[tuple[str, int]] = []
    for item_index, (key, texture) in enumerate(textures):
        x = item_index % ATLAS_COLUMNS
        y = item_index // ATLAS_COLUMNS
        atlas.paste(texture, (x * CELL_SIZE, y * CELL_SIZE), texture)
        indexes.append((key, item_index))

    indexes_by_key = dict(indexes)
    item_model_prefix = "assets/minecraft/models/item/"
    for path in sorted(entries):
        if not path.startswith(item_model_prefix) or not path.endswith(".json"):
            continue
        alias = f"item:{Path(path).stem}"
        if alias in indexes_by_key:
            continue
        target = model_texture_key(entries, path)
        if target is None or target not in indexes_by_key:
            continue
        indexes_by_key[alias] = indexes_by_key[target]
        indexes.append((alias, indexes_by_key[target]))
    atlas.save(PUBLIC_OUTPUT / "items.png", optimize=True, compress_level=9)

    lines = [
        "// Generated by scripts/build-admin-inventory-assets.py. Do not edit by hand.",
        f"export const MINECRAFT_ITEM_ATLAS_COLUMNS = {ATLAS_COLUMNS};",
        f"export const MINECRAFT_ITEM_ATLAS_ROWS = {rows};",
        "export const MINECRAFT_ITEM_TEXTURES: Readonly<Record<string, number>> = {",
    ]
    lines.extend(f'  "{key}": {index},' for key, index in indexes)
    lines.append("};")
    MANIFEST_OUTPUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(textures)} New Default item textures and "
        f"{len(indexes) - len(textures)} model aliases into {atlas.width}x{atlas.height} atlas"
    )


def main() -> None:
    if not CLIENT.is_file():
        raise SystemExit(f"Missing generated client: {CLIENT}")
    PUBLIC_OUTPUT.mkdir(parents=True, exist_ok=True)
    MANIFEST_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    entries = load_entries()
    save_gui_textures(entries)
    save_item_atlas(entries)


if __name__ == "__main__":
    main()
