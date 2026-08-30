#!/usr/bin/env python3
"""Build the Spawnpoint Eaglercraft client with a crisp bitmap font."""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import lzma
import struct
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path

try:
    from fontTools.ttLib import TTFont
    from PIL import Image, ImageDraw, ImageFont
except ImportError as error:
    raise SystemExit("Install Pillow and fonttools before rebuilding the client font") from error


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BASE = ROOT / "vendor/clients/stable-locale-fixed.epw"
DEFAULT_OUTPUT = ROOT / "vendor/clients/stable-galmuri.epw"
DEFAULT_FONT = ROOT / "vendor/fonts/galmuri/Galmuri11.ttf"
DEFAULT_LICENSE = ROOT / "vendor/fonts/galmuri/LICENSE.txt"
DEFAULT_FINAL_LOAD_SCREEN = ROOT / "vendor/clients/loading-screen-bacon.jpg"

EPW_MAGIC = b"EAG$WASM"
EPW_EPK_COUNT_OFFSET = 96
EPW_EPK_TABLE_OFFSET = 276
EPW_EPK_RECORD_SIZE = 32
EPW_RUNTIME_RECORD_OFFSET = 212
EPW_MAIN_WASM_RECORD_OFFSET = 228
EPK_MAGIC = b"EAGPKG$$"
EPK_END = b":::YEE:>"

RUNTIME_PASSWORD_INPUT = b'h.type="password"'
RUNTIME_TEXT_INPUT = b'h.type="text"'
RUNTIME_MOBILE_GATE = (
    b"!ib&&navigator.userActivation&&navigator.userActivation.hasBeenActive"
)
RUNTIME_SKIP_MOBILE_GATE = (
    b"ib||navigator.userActivation&&navigator.userActivation.hasBeenActive"
)

ASCII_TEXTURE = "assets/minecraft/textures/font/ascii.png"
GLYPH_SIZES = "assets/minecraft/font/glyph_sizes.bin"
CREDITS = "assets/eagler/credits.txt"
FONT_LICENSE = "assets/spawnpoint/fonts/OFL-Galmuri.txt"
EN_US_LANG = "assets/minecraft/lang/en_us.lang"
SPLASHES = "assets/minecraft/texts/splashes.txt"
UNDERWATER_TEXTURE = "assets/minecraft/textures/misc/underwater.png"
FINAL_LOAD_SCREEN = "assets/eagler/eagtek.png"
UNICODE_PAGE = "assets/minecraft/textures/font/unicode_page_{page:02x}.png"

MAIN_MENU_PATCH_RANGES = (
    ("holiday splash override", 0x38895C, 0x388A03, "1b2109a60b7c23a91ff97eb07acfe211a2a07e641260137cbf7b267779adcc3e"),
    ("singleplayer button", 0x388A2D, 0x388A86, "33c9d28520973c13f0f0d58f16f7e131e86166275307b9cf0d1a0bf004f220b0"),
    ("credits button", 0x388AE1, 0x388B3D, "43ae64a236d04254ba1ea2a8bc481c87246d6c384dd0ce237f41b808ea63a959"),
    ("secondary version line", 0x389058, 0x389076, "0e6eb40af7b59efab32c5d80ca516963290b3f61bcbf4d9d25cb3c50d303f81f"),
    ("bottom-right credits", 0x389076, 0x389098, "2f0c4a04f9674d9f34bca94df342d34fa422766bddd57967812330245a1aeaf8"),
)
BASE_MAIN_WASM_SHA256 = "d3a20d5f95932bc10ef244debb4058e3716e703329adda3204e9491637348b48"
# GuiMainMenu renders the panorama into a framebuffer, then runs six linear
# ping-pong passes before presenting that framebuffer. The final presentation
# already reads the original panorama texture, so the blur chain can be removed
# without touching panorama rendering, shaders, or the general video pipeline.
PANORAMA_BLUR_PASS_RANGE = (
    0x4DF28A,
    0x4DF43A,
    "9f9875363805aeb23658d2a7e38316d09e22d5b0dfe984f71a55705cad7859a4",
)
# The stock title path renders into a 256x256 framebuffer with sixteen jittered
# samples. Upscaling that tiny result is still visibly soft after removing the
# blur passes. Render one 1024x1024 sample instead: it keeps roughly the same
# fragment workload, matches the supplied 1080px panorama faces, and remains
# isolated from gameplay shaders and the general video pipeline.
PANORAMA_RENDER_PATCHES = (
    ("title framebuffer width", 0x388851, b"\x41\x80\x02", b"\x41\x80\x08"),
    ("title framebuffer height", 0x388854, b"\x41\x80\x02", b"\x41\x80\x08"),
    ("title viewport width", 0x4DF257, b"\x41\x80\x02", b"\x41\x80\x08"),
    ("title viewport height", 0x4DF25A, b"\x41\x80\x02", b"\x41\x80\x08"),
    ("title panorama sample count", 0x5080B9, b"\x41\x10", b"\x41\x01"),
)
# Close Screen stays available only to the bridge's marked synthetic Backquote
# event, which preserves Escape and mobile menu behavior. Real Backquote input
# is blocked before it reaches the runtime. The hidden cinematic-camera slot is
# reused for Fullbright on B, which is otherwise unbound in this client.
CONTROL_KEYCODE_PATCHES = (
    ("fullbright", 0x2D050B, 50, 48),
    ("save toolbar", 0x2D0708, 46, 0),
    ("load toolbar", 0x2D072F, 45, 0),
)
HIDDEN_CONTROL_ROW_PATCH_RANGES = (
    (
        "cinematic camera control",
        0x2D0929,
        0x2D0937,
        "b9c017b9a9c88e1026e740b3ced92c8c81f8910766714cf2e6f1992a39c3bbe4",
    ),
    (
        "spectator outline control",
        0x2D0937,
        0x2D0945,
        "6c3043d984df02d7596a3027e25a8702209654a163607b26ba44146218858a7b",
    ),
    (
        "save toolbar control",
        0x2D0953,
        0x2D0961,
        "1b740471142024287beda12c6f68085be9d7a8f3c847de81522cade162174b36",
    ),
    (
        "load toolbar control",
        0x2D0961,
        0x2D096F,
        "c002ffb48b4a37890fd870ddedade3b780457857e6fff48df951465c0c49c286",
    ),
    (
        "close screen control",
        0x2D098B,
        0x2D0999,
        "020da62eb5f33ee58d55b851f1c6b3a65b65d15d649c4c24aa8ce3a5dab5275b",
    ),
)
CONTROL_ARRAY_LENGTH_PATCH = (0x2D082C, 25, 20)
CONTROL_ARRAY_INDEX_PATCHES = (
    ("swap hands", 0x2D0947, 19, 17),
    ("advancements", 0x2D0971, 22, 18),
    ("zoom", 0x2D097F, 23, 19),
)
FULLBRIGHT_TOGGLE_RANGE = (
    0x31F766,
    0x31F7C3,
    "b145922de2de303cc5db5efbc87beed7b14250d52c6d535468cf21d56aac011d",
)
# Replaces Minecraft.processKeyBinds' cinematic-camera toggle with a real
# GameSettings.gammaSetting toggle. Normal video brightness tops out at 1.0;
# the high value follows the conventional fullbright-mod behavior.
FULLBRIGHT_TOGGLE_WASM = bytes.fromhex(
    """
    02 40 03 40 02 63 92 0f 02 63 bf 0f 20 00 fb 02 ce 0f 27 d6 00
    10 8d 02 08 00 0b 22 02 fb 02 bf 0f 3d d6 00 10 8d 02 08 00 0b
    10 cc 0e 45 0d 01 20 02 20 02 fb 02 bf 0f 51 43 00 00 80 3f 5e
    04 7d 43 00 00 80 3f 05 43 00 00 7a 44 0b fb 05 bf 0f 51 0c 00
    01 01 01 01 01 01 01 0b 0b
    """
)
VOICE_WARNING_CLINIT_RANGE = (
    0x45B006,
    0x45B048,
    "90396c552a19053120e634455e1e6c67fe4e7ee09ee0fc2f97252ab607186e2a",
)
VOICE_WARNING_FLAG_OFFSETS = (0x45B032, 0x45B03C)
NOTIFICATION_BUTTON_PATCH_RANGE = (
    0x45A91F,
    0x45A9D8,
    "ac3c44883a63d88d7abe728a27479475367cc75214a920aa51e0a4af350fd53a",
)
FNAW_SKIN_OPTION_PATCH_RANGES = (
    (
        "FNAW skin option setup",
        0x5BFEC3,
        0x5BFEFE,
        "05024d40a0c8bf5610c29e9a39de6182e985475af414b380e56d3c0de54535c4",
    ),
    (
        "FNAW skin option button",
        0x5BFF08,
        0x5BFFC2,
        "481a0041309689d9895396fa7bf6eeef9da8c6e05de2d11fc7670622b987d780",
    ),
)
FNAW_DONE_BUTTON_Y_PATCH = (0x5BFFF8, 40, 10)
COMPACT_HUD_RENDER_RANGE = (
    0x3240BF,
    0x3245F5,
    "b8576ef882878399351ed8aeefccf88560a66063b36496b356115f8fe91ea2a5",
)
# Keeps the short HUD on one row by measuring the rendered FPS prefix before
# drawing XYZ. The source function hash above prevents applying it to drifted WASM.
COMPACT_HUD_RENDER_ZLIB = base64.b64decode(
    b"eNq1Uztv1EAQ9o7X+LG2dxIh5XSKlFlcAAUdXZqzIA1E/ASucHfhD1DxKigiRAGER0Cioj0FkQMlRZQiBRQREhJQ8g/oaLY4"
    b"Zu2cTyciSEMx653Zmd35vvmci+pQi2pPi1uiGuei2tKSdzsd57M7cpbVW995wOnkWdjW/lcPH0DkKQPA9QQWDvXZNuiTb+We"
    b"vrIieyUYyRY2keuy11wgTQD8XFOo28JTUEmohppOWdjSOIlbGOpw6kiw2oSlZyK2mC2B6iBpauJp2kEijYSe36OE5LVMQLXb"
    b"gWp9sbE/CijBQ992fM9fX8SHLjK9igumzm4nMKr4uHR6MyNVfFr6wjCBWaO2wChSVu50JJ9QVIqBiSiun+TynU5gFw6SmT4H"
    b"JlbcgMtMUk8pvH/epE1/FxhD9StvnHOTKry9bDIrRrmZp/lC2GCUezRvcsrxCVBOKQ6hS3mxsSnwEXSBx0tBizTHx3AGL3me"
    b"16uXcjweh/g26lJAiG/8EgY8MY8Evut33QSVm/Ix458Zuxtw3w2YQpK43VcBfmd5jDLycNS3C6Os5UeTLhJ86Rr7970TOV1d"
    b"kVVeDC8HxauLymATXJ0J/oWS4llDBZODzbd43kay+qtrYlxb3N4LPuQdqyutNZSStjDKGiHlnJviFtRyyRu1cEeId5ZrMTDb"
    b"jcxbDAEFFsa5b+QRxyxgIEnpDRZHKZxK1jgQDlgDFJEcOP/z6/27N/GpPOZCQs6Oyh/790L8KbuKUiee1ImH6X7fN3N15479"
    b"uVnq/xMaqDY0iTZDkLCwofnfX6NwjSFOwMY1VIrdEh3hjU+Cl7PjY/HiNzipPFedPPFDXyn1G1chHBU="
)
VERBOSE_FPS_LITERAL = b"\x09fps | C: "
# The prefix stores the decoded character count, not the UTF-8 byte count.
# Section sign is two bytes but one character, so this replacement has eight
# characters while keeping the original ten-byte binary layout.
COMPACT_FPS_LITERAL = b"\x08fps | \xc2\xa7r"
OLD_VERSION_STRING = b"\x10Minecraft 1.12.2\x05 Demo"
SPAWNPOINT_VERSION_STRING = b"\x10spawnpoint v1.12\x05 Demo"

FONT_SIZE = 12
CELL_SIZE = 16
PAGE_SIZE = CELL_SIZE * 16
VERTICAL_OFFSET = 1


@dataclass
class EpkEntry:
    kind: bytes
    name: str
    data: bytes


@dataclass
class EpkRecord:
    table_offset: int
    data_offset: int
    compressed_length: int
    raw_length: int


def read_epw_records(epw: bytes) -> list[EpkRecord]:
    if epw[:8] != EPW_MAGIC:
        raise ValueError("Input is not an Eaglercraft EPW bundle")
    count = struct.unpack_from("<I", epw, EPW_EPK_COUNT_OFFSET)[0]
    if count < 1:
        raise ValueError("EPW bundle has no asset packages")

    records: list[EpkRecord] = []
    for index in range(count):
        table_offset = EPW_EPK_TABLE_OFFSET + index * EPW_EPK_RECORD_SIZE
        data_offset, compressed_length, raw_length = struct.unpack_from(
            "<III", epw, table_offset + 16
        )
        if data_offset + compressed_length > len(epw):
            raise ValueError(f"EPW asset package {index} extends past the end of the bundle")
        records.append(EpkRecord(table_offset, data_offset, compressed_length, raw_length))
    return records


def read_u8_string(data: bytes, offset: int) -> tuple[bytes, int]:
    length = data[offset]
    start = offset + 1
    return data[start : start + length], start + length


def parse_epk(epk: bytes) -> tuple[bytes, bytes, list[EpkEntry]]:
    if epk[:8] != EPK_MAGIC or epk[-8:] != EPK_END:
        raise ValueError("Embedded asset package is not a supported EPK file")

    offset = 8
    _, offset = read_u8_string(epk, offset)
    _, offset = read_u8_string(epk, offset)
    comment_length = int.from_bytes(epk[offset : offset + 2], "big")
    offset += 2 + comment_length + 8
    count_offset = offset
    entry_count = int.from_bytes(epk[offset : offset + 4], "big")
    offset += 4
    compression = epk[offset : offset + 1]
    offset += 1
    if compression != b"0":
        raise ValueError(f"Unsupported inner EPK compression: {compression!r}")

    entries: list[EpkEntry] = []
    for _ in range(entry_count):
        kind = epk[offset : offset + 4]
        offset += 4
        if kind == b"END$":
            raise ValueError("EPK ended before all declared entries were read")
        name_bytes, offset = read_u8_string(epk, offset)
        name = name_bytes.decode("utf-8")
        stored_length = int.from_bytes(epk[offset : offset + 4], "big")
        offset += 4

        if kind == b"FILE":
            if stored_length < 5:
                raise ValueError(f"EPK file is incomplete: {name}")
            expected_crc = int.from_bytes(epk[offset : offset + 4], "big")
            offset += 4
            file_length = stored_length - 5
            file_data = epk[offset : offset + file_length]
            offset += file_length
            if zlib.crc32(file_data) & 0xFFFFFFFF != expected_crc:
                raise ValueError(f"EPK file has an invalid checksum: {name}")
            if epk[offset : offset + 2] != b":>":
                raise ValueError(f"EPK file has an invalid terminator: {name}")
            offset += 2
        else:
            file_data = epk[offset : offset + stored_length]
            offset += stored_length
            if epk[offset : offset + 1] != b">":
                raise ValueError(f"EPK object has an invalid terminator: {name}")
            offset += 1
        entries.append(EpkEntry(kind, name, file_data))

    if epk[offset : offset + 4] != b"END$":
        raise ValueError("EPK is missing its END marker")
    return epk[:count_offset], compression, entries


def build_epk(prefix: bytes, compression: bytes, entries: list[EpkEntry]) -> bytes:
    output = bytearray(prefix)
    output.extend(len(entries).to_bytes(4, "big"))
    output.extend(compression)
    for entry in entries:
        name = entry.name.encode("utf-8")
        if len(name) > 255:
            raise ValueError(f"EPK path is too long: {entry.name}")
        output.extend(entry.kind)
        output.append(len(name))
        output.extend(name)
        if entry.kind == b"FILE":
            output.extend((len(entry.data) + 5).to_bytes(4, "big"))
            output.extend((zlib.crc32(entry.data) & 0xFFFFFFFF).to_bytes(4, "big"))
            output.extend(entry.data)
            output.extend(b":>")
        else:
            output.extend(len(entry.data).to_bytes(4, "big"))
            output.extend(entry.data)
            output.extend(b">")
    output.extend(b"END$")
    output.extend(EPK_END)
    return bytes(output)


def png_bytes(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True, compress_level=9)
    return output.getvalue()


def render_glyph(
    image: Image.Image,
    draw: ImageDraw.ImageDraw,
    font: ImageFont.FreeTypeFont,
    character: str,
    cell_x: int,
    cell_y: int,
) -> tuple[int, int] | None:
    bounds = font.getbbox(character)
    if bounds is None:
        return None
    left, _, right, _ = bounds
    if right - left > CELL_SIZE:
        raise ValueError(f"Glyph does not fit a Minecraft cell: U+{ord(character):04X}")
    draw.rectangle(
        (cell_x, cell_y, cell_x + CELL_SIZE - 1, cell_y + CELL_SIZE - 1),
        fill=(255, 255, 255, 0),
    )
    draw.text(
        (cell_x - left, cell_y + VERTICAL_OFFSET),
        character,
        font=font,
        fill=(255, 255, 255, 255),
    )
    alpha_bounds = image.crop(
        (cell_x, cell_y, cell_x + CELL_SIZE, cell_y + CELL_SIZE)
    ).getchannel("A").getbbox()
    if alpha_bounds is None:
        return None
    glyph_left, _, glyph_right, _ = alpha_bounds
    return glyph_left, glyph_right - 1


def apply_font(
    entries: list[EpkEntry],
    font_path: Path,
    license_path: Path,
    final_load_screen_path: Path,
) -> dict[str, int]:
    by_name = {entry.name: index for index, entry in enumerate(entries)}
    for required in (
        ASCII_TEXTURE,
        GLYPH_SIZES,
        CREDITS,
        EN_US_LANG,
        SPLASHES,
        UNDERWATER_TEXTURE,
        FINAL_LOAD_SCREEN,
    ):
        if required not in by_name:
            raise ValueError(f"Base client is missing required asset: {required}")

    language = entries[by_name[EN_US_LANG]].data.decode("utf-8", errors="strict")
    edit_profile = "eaglercraft.menu.editProfile=Edit Profile"
    if language.count(edit_profile) != 1:
        raise ValueError("Base client does not contain exactly one Edit Profile label")
    entries[by_name[EN_US_LANG]].data = language.replace(
        edit_profile, "eaglercraft.menu.editProfile=포탈로 돌아가기"
    ).encode("utf-8")
    entries[by_name[SPLASHES]].data = "대미덕에디션\n".encode("utf-8")

    underwater_index = by_name[UNDERWATER_TEXTURE]
    underwater = Image.open(io.BytesIO(entries[underwater_index].data))
    if underwater.size != (16, 16):
        raise ValueError("Minecraft underwater overlay must be 16 by 16 pixels")
    entries[underwater_index].data = png_bytes(
        Image.new("RGBA", underwater.size, (255, 255, 255, 0))
    )

    final_load_screen = Image.open(final_load_screen_path).convert("RGB")
    final_load_screen.thumbnail((256, 256), Image.Resampling.LANCZOS)
    branded_load_screen = Image.new("RGB", (256, 256), (11, 17, 12))
    branded_load_screen.paste(
        final_load_screen,
        (
            (branded_load_screen.width - final_load_screen.width) // 2,
            (branded_load_screen.height - final_load_screen.height) // 2,
        ),
    )
    entries[by_name[FINAL_LOAD_SCREEN]].data = png_bytes(branded_load_screen)

    font = ImageFont.truetype(
        str(font_path), FONT_SIZE, layout_engine=ImageFont.Layout.BASIC
    )
    tt_font = TTFont(font_path, lazy=True)
    cmap = tt_font.getBestCmap() or {}
    code_points = sorted(
        code_point
        for code_point in cmap
        if 0x20 < code_point <= 0xFFFF and not 0xD800 <= code_point <= 0xDFFF
    )
    hangul_count = sum(0xAC00 <= code_point <= 0xD7A3 for code_point in code_points)
    if hangul_count != 11_172:
        raise ValueError(f"Font does not cover all modern Hangul syllables: {hangul_count}/11172")

    glyph_sizes = bytearray(entries[by_name[GLYPH_SIZES]].data)
    if len(glyph_sizes) != 65_536:
        raise ValueError("Minecraft glyph_sizes.bin must contain 65,536 bytes")

    pages: dict[int, list[int]] = {}
    for code_point in code_points:
        pages.setdefault(code_point >> 8, []).append(code_point)

    replaced_pages = 0
    added_pages = 0
    for page_number, page_code_points in pages.items():
        page_name = UNICODE_PAGE.format(page=page_number)
        if page_name in by_name:
            image = Image.open(io.BytesIO(entries[by_name[page_name]].data)).convert("RGBA")
            if image.size != (PAGE_SIZE, PAGE_SIZE):
                raise ValueError(f"Unicode page has an unexpected size: {page_name}")
        else:
            image = Image.new("RGBA", (PAGE_SIZE, PAGE_SIZE), (255, 255, 255, 0))
            added_pages += 1

        draw = ImageDraw.Draw(image)
        for code_point in page_code_points:
            slot = code_point & 0xFF
            cell_x = (slot & 0x0F) * CELL_SIZE
            cell_y = (slot >> 4) * CELL_SIZE
            horizontal_bounds = render_glyph(
                image, draw, font, chr(code_point), cell_x, cell_y
            )
            if horizontal_bounds is not None:
                left, right = horizontal_bounds
                glyph_sizes[code_point] = (left << 4) | right

        rendered = png_bytes(image)
        if page_name in by_name:
            entries[by_name[page_name]].data = rendered
        else:
            by_name[page_name] = len(entries)
            entries.append(EpkEntry(b"FILE", page_name, rendered))
        replaced_pages += 1

    ascii_index = by_name[ASCII_TEXTURE]
    ascii_image = Image.open(io.BytesIO(entries[ascii_index].data)).convert("RGBA")
    if ascii_image.size != (128, 128):
        raise ValueError("Base Minecraft ASCII texture must be 128 by 128 pixels")
    ascii_image = ascii_image.resize((PAGE_SIZE, PAGE_SIZE), Image.Resampling.NEAREST)
    ascii_draw = ImageDraw.Draw(ascii_image)
    for code_point in range(0x20, 0x7F):
        slot_x = (code_point & 0x0F) * CELL_SIZE
        slot_y = (code_point >> 4) * CELL_SIZE
        ascii_draw.rectangle(
            (slot_x, slot_y, slot_x + CELL_SIZE - 1, slot_y + CELL_SIZE - 1),
            fill=(255, 255, 255, 0),
        )
        if code_point > 0x20 and code_point in cmap:
            render_glyph(ascii_image, ascii_draw, font, chr(code_point), slot_x, slot_y)
    entries[ascii_index].data = png_bytes(ascii_image)
    entries[by_name[GLYPH_SIZES]].data = bytes(glyph_sizes)

    license_text = license_path.read_text(encoding="utf-8").strip()
    credit_marker = "Spawnpoint bitmap font derived from Galmuri11"
    credits_index = by_name[CREDITS]
    credits = entries[credits_index].data.decode("utf-8", errors="strict").rstrip()
    if credit_marker not in credits:
        credits += (
            "\n\n"
            "==============================================================================\n"
            f"{credit_marker}\n"
            "Copyright (c) 2019-2025 Lee Minseo (https://quiple.dev/font/galmuri).\n"
            "The derived bitmap assets are distributed under the SIL Open Font License 1.1.\n\n"
            f"{license_text}\n"
        )
    entries[credits_index].data = credits.encode("utf-8")

    license_data = (license_text + "\n").encode("utf-8")
    if FONT_LICENSE in by_name:
        entries[by_name[FONT_LICENSE]].data = license_data
    else:
        entries.append(EpkEntry(b"FILE", FONT_LICENSE, license_data))

    return {
        "glyphs": len(code_points),
        "hangul": hangul_count,
        "pages": replaced_pages,
        "added_pages": added_pages,
    }


def patch_epw(base_epw: bytes, new_epk: bytes) -> bytes:
    records = read_epw_records(base_epw)
    target = records[0]
    compressed = lzma.compress(
        new_epk,
        format=lzma.FORMAT_XZ,
        check=lzma.CHECK_CRC32,
        preset=8 | lzma.PRESET_EXTREME,
    )
    old_end = target.data_offset + target.compressed_length
    delta = len(compressed) - target.compressed_length
    output = bytearray(base_epw[: target.data_offset])
    output.extend(compressed)
    output.extend(base_epw[old_end:])

    struct.pack_into(
        "<III",
        output,
        target.table_offset + 16,
        target.data_offset,
        len(compressed),
        len(new_epk),
    )
    for record in records[1:]:
        struct.pack_into("<I", output, record.table_offset + 16, record.data_offset + delta)

    struct.pack_into("<I", output, 8, len(output))
    struct.pack_into("<I", output, 12, 0)
    struct.pack_into("<I", output, 12, zlib.crc32(output[16:]) & 0xFFFFFFFF)
    return bytes(output)


def epw_slice_offset_fields(epw: bytes) -> list[int]:
    fields = list(range(24, 88, 8))
    fields.extend((180, 196, 212, 228, 244, 260))
    count = struct.unpack_from("<I", epw, EPW_EPK_COUNT_OFFSET)[0]
    for index in range(count):
        record = EPW_EPK_TABLE_OFFSET + index * EPW_EPK_RECORD_SIZE
        fields.extend((record, record + 8, record + 16))
    return fields


def patch_runtime(epw: bytes) -> bytes:
    if epw[:8] != EPW_MAGIC:
        raise ValueError("Input is not an Eaglercraft EPW bundle")
    stored_length, stored_crc = struct.unpack_from("<II", epw, 8)
    if stored_length != len(epw):
        raise ValueError("EPW stored length does not match the bundle size")
    if stored_crc != zlib.crc32(epw[16:]) & 0xFFFFFFFF:
        raise ValueError("EPW checksum does not match the bundle contents")

    data_offset, compressed_length, raw_length, reserved = struct.unpack_from(
        "<IIII", epw, EPW_RUNTIME_RECORD_OFFSET
    )
    old_end = data_offset + compressed_length
    if old_end > len(epw):
        raise ValueError("EPW runtime extends past the end of the bundle")
    runtime = lzma.decompress(epw[data_offset:old_end])
    if len(runtime) != raw_length:
        raise ValueError("EPW runtime has an unexpected uncompressed length")
    if runtime.count(RUNTIME_PASSWORD_INPUT) != 1:
        raise ValueError("EPW runtime does not contain exactly one password input")
    if runtime.count(RUNTIME_MOBILE_GATE) != 1:
        raise ValueError("EPW runtime does not contain exactly one mobile launch gate")

    runtime = runtime.replace(RUNTIME_PASSWORD_INPUT, RUNTIME_TEXT_INPUT)
    runtime = runtime.replace(RUNTIME_MOBILE_GATE, RUNTIME_SKIP_MOBILE_GATE)
    compressed = lzma.compress(
        runtime,
        format=lzma.FORMAT_XZ,
        check=lzma.CHECK_CRC32,
        preset=8 | lzma.PRESET_EXTREME,
    )
    delta = len(compressed) - compressed_length
    output = bytearray(epw[:data_offset])
    output.extend(compressed)
    output.extend(epw[old_end:])

    for field in epw_slice_offset_fields(epw):
        if field == EPW_RUNTIME_RECORD_OFFSET:
            continue
        old_offset = struct.unpack_from("<I", epw, field)[0]
        if old_offset >= old_end:
            struct.pack_into("<I", output, field, old_offset + delta)

    struct.pack_into(
        "<IIII",
        output,
        EPW_RUNTIME_RECORD_OFFSET,
        data_offset,
        len(compressed),
        len(runtime),
        reserved,
    )
    struct.pack_into("<I", output, 8, len(output))
    struct.pack_into("<I", output, 12, 0)
    struct.pack_into("<I", output, 12, zlib.crc32(output[16:]) & 0xFFFFFFFF)
    return bytes(output)


def read_uleb(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    shift = 0
    while offset < len(data):
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if byte & 0x80 == 0:
            return value, offset
        shift += 7
        if shift > 35:
            break
    raise ValueError("WASM contains an invalid unsigned LEB128 value")


def encode_uleb(value: int) -> bytes:
    encoded = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        encoded.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(encoded)


def patch_wasm_data_string(wasm: bytes) -> bytes:
    if wasm[:8] != b"\x00asm\x01\x00\x00\x00":
        raise ValueError("EPW main program is not a supported WASM module")

    output = bytearray(wasm[:8])
    offset = 8
    patched = False
    while offset < len(wasm):
        section_id = wasm[offset]
        offset += 1
        section_length, payload_offset = read_uleb(wasm, offset)
        payload_end = payload_offset + section_length
        if payload_end > len(wasm):
            raise ValueError("WASM section extends past the end of the module")
        payload = wasm[payload_offset:payload_end]

        if section_id == 11:
            segment_count, segment_offset = read_uleb(payload, 0)
            if segment_count != 1:
                raise ValueError("WASM data section does not contain exactly one segment")
            flags, segment_offset = read_uleb(payload, segment_offset)
            if flags != 0 or payload[segment_offset] != 0x41:
                raise ValueError("WASM data segment has an unsupported offset expression")
            segment_offset += 1
            while segment_offset < len(payload) and payload[segment_offset] & 0x80:
                segment_offset += 1
            segment_offset += 1
            if segment_offset >= len(payload) or payload[segment_offset] != 0x0B:
                raise ValueError("WASM data segment offset expression is incomplete")
            segment_offset += 1
            length_offset = segment_offset
            data_length, data_offset = read_uleb(payload, length_offset)
            segment_data = payload[data_offset:]
            if len(segment_data) != data_length:
                raise ValueError("WASM data segment has an unexpected length")
            if len(SPAWNPOINT_VERSION_STRING) != len(OLD_VERSION_STRING):
                raise ValueError("Replacement version string must preserve the WASM data layout")
            if segment_data.count(OLD_VERSION_STRING) != 1:
                raise ValueError("WASM data segment does not contain the expected version string")
            segment_data = segment_data.replace(OLD_VERSION_STRING, SPAWNPOINT_VERSION_STRING)
            payload = payload[:length_offset] + encode_uleb(len(segment_data)) + segment_data
            patched = True

        output.append(section_id)
        output.extend(encode_uleb(len(payload)))
        output.extend(payload)
        offset = payload_end

    if not patched:
        raise ValueError("WASM module is missing its data section")
    return bytes(output)


def patch_main_menu(epw: bytes) -> bytes:
    data_offset, compressed_length, raw_length, reserved = struct.unpack_from(
        "<IIII", epw, EPW_MAIN_WASM_RECORD_OFFSET
    )
    old_end = data_offset + compressed_length
    if old_end > len(epw):
        raise ValueError("EPW main program extends past the end of the bundle")
    wasm = bytearray(lzma.decompress(epw[data_offset:old_end]))
    if len(wasm) != raw_length:
        raise ValueError("EPW main program has an unexpected uncompressed length")
    if hashlib.sha256(wasm).hexdigest() != BASE_MAIN_WASM_SHA256:
        raise ValueError("EPW main program does not match the known-good base client")

    for name, start, end, expected_hash in MAIN_MENU_PATCH_RANGES:
        current = bytes(wasm[start:end])
        if hashlib.sha256(current).hexdigest() != expected_hash:
            raise ValueError(f"EPW main program has an unexpected {name} implementation")
        wasm[start:end] = b"\x01" * (end - start)
    blur_start, blur_end, expected_blur_hash = PANORAMA_BLUR_PASS_RANGE
    if hashlib.sha256(wasm[blur_start:blur_end]).hexdigest() != expected_blur_hash:
        raise ValueError("EPW main program has an unexpected title panorama blur chain")
    wasm[blur_start:blur_end] = b"\x01" * (blur_end - blur_start)
    for name, offset, expected, replacement in PANORAMA_RENDER_PATCHES:
        if wasm[offset : offset + len(expected)] != expected:
            raise ValueError(f"EPW main program has an unexpected {name}")
        if len(replacement) != len(expected):
            raise ValueError(f"Replacement for {name} must preserve the WASM byte layout")
        wasm[offset : offset + len(expected)] = replacement
    for name, offset, expected_keycode, replacement_keycode in CONTROL_KEYCODE_PATCHES:
        if wasm[offset : offset + 2] != bytes((0x41, expected_keycode)):
            raise ValueError(f"EPW main program has an unexpected {name} key mapping")
        wasm[offset + 1] = replacement_keycode
    array_offset, expected_length, replacement_length = CONTROL_ARRAY_LENGTH_PATCH
    if wasm[array_offset : array_offset + 2] != bytes((0x41, expected_length)):
        raise ValueError("EPW main program has an unexpected controls array length")
    wasm[array_offset + 1] = replacement_length
    for name, offset, expected_index, replacement_index in CONTROL_ARRAY_INDEX_PATCHES:
        if wasm[offset : offset + 2] != bytes((0x41, expected_index)):
            raise ValueError(f"EPW main program has an unexpected {name} control index")
        wasm[offset + 1] = replacement_index
    for name, start, end, expected_hash in HIDDEN_CONTROL_ROW_PATCH_RANGES:
        current = bytes(wasm[start:end])
        if hashlib.sha256(current).hexdigest() != expected_hash:
            raise ValueError(f"EPW main program has an unexpected {name} row")
        wasm[start:end] = b"\x01" * (end - start)
    fullbright_start, fullbright_end, expected_fullbright_hash = FULLBRIGHT_TOGGLE_RANGE
    if (
        hashlib.sha256(wasm[fullbright_start:fullbright_end]).hexdigest()
        != expected_fullbright_hash
    ):
        raise ValueError("EPW main program has an unexpected cinematic-camera toggle")
    if len(FULLBRIGHT_TOGGLE_WASM) != fullbright_end - fullbright_start:
        raise ValueError("Fullbright toggle must preserve the WASM byte layout")
    wasm[fullbright_start:fullbright_end] = FULLBRIGHT_TOGGLE_WASM
    voice_start, voice_end, expected_voice_hash = VOICE_WARNING_CLINIT_RANGE
    if hashlib.sha256(wasm[voice_start:voice_end]).hexdigest() != expected_voice_hash:
        raise ValueError("EPW main program has an unexpected voice warning initializer")
    for offset in VOICE_WARNING_FLAG_OFFSETS:
        if wasm[offset] != 1:
            raise ValueError("EPW main program has an unexpected voice warning flag")
        wasm[offset] = 0
    notification_start, notification_end, expected_notification_hash = (
        NOTIFICATION_BUTTON_PATCH_RANGE
    )
    if (
        hashlib.sha256(wasm[notification_start:notification_end]).hexdigest()
        != expected_notification_hash
    ):
        raise ValueError("EPW main program has an unexpected notification button implementation")
    wasm[notification_start:notification_end] = b"\x01" * (
        notification_end - notification_start
    )
    for name, start, end, expected_hash in FNAW_SKIN_OPTION_PATCH_RANGES:
        current = bytes(wasm[start:end])
        if hashlib.sha256(current).hexdigest() != expected_hash:
            raise ValueError(f"EPW main program has an unexpected {name} implementation")
        wasm[start:end] = b"\x01" * (end - start)
    done_y_offset, expected_done_y, replacement_done_y = FNAW_DONE_BUTTON_Y_PATCH
    if wasm[done_y_offset] != expected_done_y:
        raise ValueError("EPW main program has an unexpected skin menu Done button position")
    wasm[done_y_offset] = replacement_done_y
    hud_start, hud_end, expected_hud_hash = COMPACT_HUD_RENDER_RANGE
    if hashlib.sha256(wasm[hud_start:hud_end]).hexdigest() != expected_hud_hash:
        raise ValueError("EPW main program has an unexpected compact HUD renderer")
    compact_hud = zlib.decompress(COMPACT_HUD_RENDER_ZLIB)
    if compact_hud[-1:] != b"\x0b" or len(compact_hud) > hud_end - hud_start:
        raise ValueError("Compact HUD renderer has an invalid function body")
    compact_hud = (
        compact_hud[:-1]
        + b"\x01" * (hud_end - hud_start - len(compact_hud))
        + compact_hud[-1:]
    )
    wasm[hud_start:hud_end] = compact_hud
    if (
        wasm.count(VERBOSE_FPS_LITERAL) != 1
        or wasm.count(COMPACT_FPS_LITERAL) != 0
    ):
        raise ValueError("EPW main program has an unexpected FPS label")
    fps_offset = wasm.index(VERBOSE_FPS_LITERAL)
    wasm[fps_offset : fps_offset + len(VERBOSE_FPS_LITERAL)] = COMPACT_FPS_LITERAL
    patched_wasm = patch_wasm_data_string(bytes(wasm))
    compressed = lzma.compress(
        patched_wasm,
        format=lzma.FORMAT_XZ,
        check=lzma.CHECK_CRC32,
        preset=8 | lzma.PRESET_EXTREME,
    )
    delta = len(compressed) - compressed_length
    output = bytearray(epw[:data_offset])
    output.extend(compressed)
    output.extend(epw[old_end:])

    for field in epw_slice_offset_fields(epw):
        if field == EPW_MAIN_WASM_RECORD_OFFSET:
            continue
        old_offset = struct.unpack_from("<I", epw, field)[0]
        if old_offset >= old_end:
            struct.pack_into("<I", output, field, old_offset + delta)

    struct.pack_into(
        "<IIII",
        output,
        EPW_MAIN_WASM_RECORD_OFFSET,
        data_offset,
        len(compressed),
        len(patched_wasm),
        reserved,
    )
    struct.pack_into("<I", output, 8, len(output))
    struct.pack_into("<I", output, 12, 0)
    struct.pack_into("<I", output, 12, zlib.crc32(output[16:]) & 0xFFFFFFFF)
    return bytes(output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, default=DEFAULT_BASE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--font", type=Path, default=DEFAULT_FONT)
    parser.add_argument("--license", type=Path, default=DEFAULT_LICENSE)
    parser.add_argument(
        "--final-load-screen", type=Path, default=DEFAULT_FINAL_LOAD_SCREEN
    )
    args = parser.parse_args()

    for source in (args.base, args.font, args.license, args.final_load_screen):
        if not source.is_file():
            raise SystemExit(f"Missing input file: {source}")

    base_epw = args.base.read_bytes()
    first_record = read_epw_records(base_epw)[0]
    base_epk = lzma.decompress(
        base_epw[
            first_record.data_offset : first_record.data_offset
            + first_record.compressed_length
        ]
    )
    if len(base_epk) != first_record.raw_length:
        raise ValueError("Embedded asset package has an unexpected uncompressed length")

    prefix, compression, entries = parse_epk(base_epk)
    stats = apply_font(entries, args.font, args.license, args.final_load_screen)
    new_epk = build_epk(prefix, compression, entries)
    output = patch_main_menu(patch_runtime(patch_epw(base_epw, new_epk)))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(output)

    print(
        f"Wrote {args.output.relative_to(ROOT)} with {stats['glyphs']:,} glyphs, "
        f"{stats['hangul']:,} Hangul syllables, and {stats['pages']} Unicode pages "
        f"({stats['added_pages']} new)"
    )
    print(f"Bundle size: {len(output):,} bytes")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, lzma.LZMAError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error
