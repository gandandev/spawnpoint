#!/usr/bin/env python3
"""Build the Spawnpoint Eaglercraft client with a crisp bitmap font."""

from __future__ import annotations

import argparse
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
UNICODE_PAGE = "assets/minecraft/textures/font/unicode_page_{page:02x}.png"

MAIN_MENU_PATCH_RANGES = (
    ("holiday splash override", 0x38895C, 0x388A03, "1b2109a60b7c23a91ff97eb07acfe211a2a07e641260137cbf7b267779adcc3e"),
    ("singleplayer button", 0x388A2D, 0x388A86, "33c9d28520973c13f0f0d58f16f7e131e86166275307b9cf0d1a0bf004f220b0"),
    ("credits button", 0x388AE1, 0x388B3D, "43ae64a236d04254ba1ea2a8bc481c87246d6c384dd0ce237f41b808ea63a959"),
    ("secondary version line", 0x389058, 0x389076, "0e6eb40af7b59efab32c5d80ca516963290b3f61bcbf4d9d25cb3c50d303f81f"),
    ("bottom-right credits", 0x389076, 0x389098, "2f0c4a04f9674d9f34bca94df342d34fa422766bddd57967812330245a1aeaf8"),
)
BASE_MAIN_WASM_SHA256 = "d3a20d5f95932bc10ef244debb4058e3716e703329adda3204e9491637348b48"
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


def apply_font(entries: list[EpkEntry], font_path: Path, license_path: Path) -> dict[str, int]:
    by_name = {entry.name: index for index, entry in enumerate(entries)}
    for required in (ASCII_TEXTURE, GLYPH_SIZES, CREDITS, EN_US_LANG, SPLASHES):
        if required not in by_name:
            raise ValueError(f"Base client is missing required asset: {required}")

    language = entries[by_name[EN_US_LANG]].data.decode("utf-8", errors="strict")
    edit_profile = "eaglercraft.menu.editProfile=Edit Profile"
    if language.count(edit_profile) != 1:
        raise ValueError("Base client does not contain exactly one Edit Profile label")
    entries[by_name[EN_US_LANG]].data = language.replace(
        edit_profile, "eaglercraft.menu.editProfile=메뉴"
    ).encode("utf-8")
    entries[by_name[SPLASHES]].data = "대미덕에디션\n".encode("utf-8")

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
    args = parser.parse_args()

    for source in (args.base, args.font, args.license):
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
    stats = apply_font(entries, args.font, args.license)
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
