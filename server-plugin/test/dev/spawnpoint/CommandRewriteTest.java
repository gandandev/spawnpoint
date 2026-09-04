package dev.spawnpoint;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import javax.imageio.ImageIO;
import net.lax1dude.eaglercraft.backend.server.api.IEaglerPlayer;
import net.lax1dude.eaglercraft.backend.server.api.skins.IEaglerPlayerSkin;
import net.lax1dude.eaglercraft.backend.server.base.skins.SkinImageLoaderImpl;
import net.lax1dude.eaglercraft.v1_8.socket.protocol.GamePluginMessageProtocol;
import net.lax1dude.eaglercraft.v1_8.socket.protocol.pkt.GameMessagePacket;
import net.lax1dude.eaglercraft.v1_8.socket.protocol.pkt.server.SPacketForceClientSkinCustomV4EAG;
import net.lax1dude.eaglercraft.v1_8.socket.protocol.pkt.server.SPacketInvalidatePlayerCacheV4EAG;
import net.lax1dude.eaglercraft.v1_8.socket.protocol.pkt.server.SPacketOtherSkinCustomV3EAG;
import net.lax1dude.eaglercraft.v1_8.socket.protocol.pkt.server.SPacketOtherSkinCustomV4EAG;
import net.lax1dude.eaglercraft.v1_8.socket.protocol.pkt.server.SPacketOtherSkinCustomV5EAG;
import net.lax1dude.eaglercraft.v1_8.socket.protocol.util.SkinPacketVersionCache;

public final class CommandRewriteTest {
    private static final String ADMIN = "sp_aaaaaaaaaaaaa";
    private static final String FRIEND = "sp_bbbbbbbbbbbbb";
    private static final String MOSS_RUNNER = "sp_ccccccccccccc";
    private static final String MOSS = "sp_ddddddddddddd";
    private static final List<SpawnpointBridgePlugin.CommandTargetName> TARGETS = List.of(
        new SpawnpointBridgePlugin.CommandTargetName("관리자", ADMIN),
        new SpawnpointBridgePlugin.CommandTargetName("친구", FRIEND),
        new SpawnpointBridgePlugin.CommandTargetName("이끼 러너", MOSS_RUNNER),
        new SpawnpointBridgePlugin.CommandTargetName("이끼", MOSS)
    );

    public static void main(String[] args) {
        assertRewrite("/tell " + FRIEND + " 안녕 친구", "/tell 친구 안녕 친구");
        assertRewrite("/minecraft:msg " + FRIEND + " 반가워", "/minecraft:msg 친구 반가워");
        assertTellAlias("/minecraft:tell " + FRIEND + " 안녕 친구", "친구", "안녕", "친구");
        assertTellAlias("/minecraft:tell " + MOSS_RUNNER + " 반가워", "이끼", "러너", "반가워");
        assertRewrite("/ban " + FRIEND, "/ban 친구");
        assertRewrite("/tell " + MOSS_RUNNER + " 안녕", "/tell 이끼 러너 안녕");
        assertRewrite("/tell " + MOSS + " 러너 안녕", "/tell \"이끼\" 러너 안녕");
        assertRewrite("/tp " + ADMIN + " " + FRIEND, "/tp 관리자 친구");
        assertRewrite("/gamemode creative " + ADMIN, "/gamemode creative 관리자");
        assertRewrite(
            "/playsound minecraft:block.note.harp master " + ADMIN + " ~ ~ ~ 1",
            "/playsound minecraft:block.note.harp master 관리자 ~ ~ ~ 1"
        );
        assertRewrite(
            "/scoreboard players operation " + ADMIN + " 점수 += " + FRIEND + " 점수",
            "/scoreboard players operation 관리자 점수 += 친구 점수"
        );
        assertRewrite("/tell @a 안녕", "/tell @a 안녕");
        assertRewrite("/tell " + FRIEND + " 안녕", "/tell " + FRIEND + " 안녕");
        assertRewrite("/say 친구", "/say 친구");
        assertWhisper("sp_bbbbbbbbbbbbb", "안녕 친구", "/tell sp_bbbbbbbbbbbbb 안녕 친구");
        assertWhisper("sp_bbbbbbbbbbbbb", "반가워", "/minecraft:msg sp_bbbbbbbbbbbbb 반가워");
        assertNoWhisper("/say sp_bbbbbbbbbbbbb 안녕");
        assertNoWhisper("/tell @a 안녕");
        assertNoWhisper("/tell sp_bbbbbbbbbbbbb");

        String decomposedFriend = Normalizer.normalize("친구", Normalizer.Form.NFD);
        assertRewrite("/tell " + FRIEND + " 안녕", "/tell " + decomposedFriend + " 안녕");

        List<SpawnpointBridgePlugin.CommandTargetName> duplicates = List.of(
            new SpawnpointBridgePlugin.CommandTargetName("중복", ADMIN),
            new SpawnpointBridgePlugin.CommandTargetName("중복", FRIEND)
        );
        SpawnpointBridgePlugin.CommandRewrite ambiguous = SpawnpointBridgePlugin.rewriteDisplayNameCommand(
            "/tell 중복 안녕",
            duplicates
        );
        if (!ambiguous.ambiguousDisplayName() || !"/tell 중복 안녕".equals(ambiguous.message())) {
            throw new AssertionError("duplicate display names must stop the command");
        }
        assertBrowserSkinChannels();
        assertObserverSkinInvalidation();
        assertDiamondBonusDeterminismAndMarkers();
        System.out.println("plugin command rewrite tests passed");
    }

    private static void assertDiamondBonusDeterminismAndMarkers() {
        long seed = 0x4d6f737352756e6eL;
        int selected = 0;
        int samples = 16_384;
        for (int index = 0; index < samples; index++) {
            int x = index - samples / 2;
            int z = Math.floorDiv(index * 37, 19) - samples / 4;
            boolean first = SpawnpointBridgePlugin.shouldAddDiamondBonus(seed, x, z, 0.35D);
            boolean second = SpawnpointBridgePlugin.shouldAddDiamondBonus(seed, x, z, 0.35D);
            if (first != second) throw new AssertionError("diamond chunk selection must be deterministic");
            if (first) selected++;
        }
        if (selected < samples * 0.33D || selected > samples * 0.40D) {
            throw new AssertionError("balanced diamond selection must stay close to the configured 35% target");
        }
        if (SpawnpointBridgePlugin.shouldAddDiamondBonus(seed, 0, 0, 0.0D)
            || !SpawnpointBridgePlugin.shouldAddDiamondBonus(seed, 0, 0, 1.0D)) {
            throw new AssertionError("diamond chunk selection must respect rate bounds");
        }
        for (int tileX = -32; tileX < 32; tileX++) {
            for (int tileZ = -32; tileZ < 32; tileZ++) {
                int tileSelected = 0;
                int[] rows = new int[4];
                int[] columns = new int[4];
                for (int localX = 0; localX < 4; localX++) {
                    for (int localZ = 0; localZ < 4; localZ++) {
                        int chunkX = tileX * 4 + localX;
                        int chunkZ = tileZ * 4 + localZ;
                        boolean balanced = SpawnpointBridgePlugin.shouldAddDiamondBonus(seed, chunkX, chunkZ, 0.35D);
                        boolean legacy = SpawnpointBridgePlugin.shouldAddLegacyDiamondBonus(seed, chunkX, chunkZ, 0.25D);
                        if (legacy && !balanced) throw new AssertionError("balanced selection must preserve every legacy selected chunk");
                        if (balanced) {
                            tileSelected++;
                            rows[localZ]++;
                            columns[localX]++;
                        }
                    }
                }
                if (tileSelected < 5) throw new AssertionError("every 4x4 tile must contain at least five selected chunks");
                for (int lane = 0; lane < 4; lane++) {
                    if (rows[lane] == 0 || columns[lane] == 0) {
                        throw new AssertionError("every 4x4 tile row and column must contain a selected chunk");
                    }
                }
            }
        }

        List<SpawnpointBridgePlugin.DiamondBonusBlock> vein = SpawnpointBridgePlugin.diamondBonusVein(seed, -12, 7, 0);
        if (vein.size() != 5 || new HashSet<>(vein).size() != vein.size()) {
            throw new AssertionError("diamond bonus vein must have five unique blocks");
        }
        for (int index = 0; index < vein.size(); index++) {
            SpawnpointBridgePlugin.DiamondBonusBlock block = vein.get(index);
            if (block.y() < 5 || block.y() > 12
                || Math.floorMod(block.x(), 16) < 1 || Math.floorMod(block.x(), 16) > 14
                || Math.floorMod(block.z(), 16) < 1 || Math.floorMod(block.z(), 16) > 14) {
                throw new AssertionError("diamond bonus vein escaped its safe Y or chunk bounds");
            }
            if (index > 0) {
                SpawnpointBridgePlugin.DiamondBonusBlock previous = vein.get(index - 1);
                int distance = Math.abs(block.x() - previous.x()) + Math.abs(block.y() - previous.y()) + Math.abs(block.z() - previous.z());
                if (distance != 1) throw new AssertionError("diamond bonus vein must remain contiguous");
            }
        }

        Path marker = null;
        try {
            marker = Files.createTempFile("spawnpoint-diamond-marker-", ".bin");
            Set<SpawnpointBridgePlugin.ProcessedChunk> legacy = Set.of(
                new SpawnpointBridgePlugin.ProcessedChunk(UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), -12, 7),
                new SpawnpointBridgePlugin.ProcessedChunk(UUID.fromString("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), 4, -19)
            );
            Set<SpawnpointBridgePlugin.ProcessedChunk> balanced = Set.of(
                new SpawnpointBridgePlugin.ProcessedChunk(UUID.fromString("cccccccc-cccc-4ccc-8ccc-cccccccccccc"), 21, 8)
            );
            SpawnpointBridgePlugin.writeDiamondMarkers(marker, legacy, balanced);
            SpawnpointBridgePlugin.DiamondMarkerState roundTrip = SpawnpointBridgePlugin.readDiamondMarkers(marker);
            if (!roundTrip.legacyProcessedChunks().equals(legacy)
                || !roundTrip.balancedProcessedChunks().equals(balanced)
                || roundTrip.requiresMigration()) {
                throw new AssertionError("version 2 diamond markers must survive a restart round trip");
            }

            try (DataOutputStream output = new DataOutputStream(Files.newOutputStream(marker))) {
                output.writeInt(0x5350444D);
                output.writeInt(1);
                output.writeInt(legacy.size());
                for (SpawnpointBridgePlugin.ProcessedChunk entry : legacy) {
                    output.writeLong(entry.worldId().getMostSignificantBits());
                    output.writeLong(entry.worldId().getLeastSignificantBits());
                    output.writeInt(entry.chunkX());
                    output.writeInt(entry.chunkZ());
                }
            }
            SpawnpointBridgePlugin.DiamondMarkerState migration = SpawnpointBridgePlugin.readDiamondMarkers(marker);
            if (!migration.legacyProcessedChunks().equals(legacy)
                || !migration.balancedProcessedChunks().isEmpty()
                || !migration.requiresMigration()) {
                throw new AssertionError("version 1 diamond markers must migrate without losing legacy chunks");
            }
        } catch (IOException exception) {
            throw new AssertionError("diamond marker round trip failed", exception);
        } finally {
            if (marker != null) {
                try {
                    Files.deleteIfExists(marker);
                } catch (IOException ignored) {
                    // Temporary diagnostics are best-effort cleanup.
                }
            }
        }
    }

    private static void assertBrowserSkinChannels() {
        BufferedImage sourceImage = new BufferedImage(64, 64, BufferedImage.TYPE_INT_ARGB);
        int[] colors = {
            0xffe21c64,
            0xff12c85a,
            0xff246ef0,
            0x0017a9e3,
            0x7f35b76d,
            0x80cb4197,
            0xfe956327,
        };
        int[] pixelIndexes = {0, 1, 2, 32, 33, 34, 35};
        for (int index = 0; index < colors.length; index++) {
            sourceImage.setRGB(pixelIndexes[index], 0, colors[index]);
        }

        BufferedImage pngImage = roundTripPng(sourceImage);
        byte[] encoded = SpawnpointBridgePlugin.encodeEaglerSkinPixels(pngImage);
        byte[][] expectedV4Pixels = {
            {0x64, 0x1c, (byte) 0xf1},
            {0x5a, (byte) 0xc8, (byte) 0x89},
            {(byte) 0xf0, 0x6e, (byte) 0x92},
            {(byte) 0xe3, (byte) 0xa9, 0x0b},
            {0x6d, (byte) 0xb7, 0x1a},
            {(byte) 0x97, 0x41, (byte) 0xe5},
            {0x27, 0x63, (byte) 0xca},
        };
        for (int index = 0; index < pixelIndexes.length; index++) {
            int encodedOffset = pixelIndexes[index] * 3;
            if (!Arrays.equals(
                expectedV4Pixels[index],
                Arrays.copyOfRange(encoded, encodedOffset, encodedOffset + 3)
            )) {
                throw new AssertionError("plugin V4 skin encoding changed channel or alpha-bit order");
            }
        }

        UUID playerUuid = UUID.fromString("12345678-1234-4234-9234-123456789abc");
        IEaglerPlayerSkin skin = SkinImageLoaderImpl.loadSkinImageData64x64Eagler(encoded, 0);
        SPacketForceClientSkinCustomV4EAG selfPacket =
            (SPacketForceClientSkinCustomV4EAG) skin.getForceSkinPacketV4();
        SPacketOtherSkinCustomV4EAG otherV4Packet = (SPacketOtherSkinCustomV4EAG) skin.getSkinPacket(
            playerUuid.getMostSignificantBits(),
            playerUuid.getLeastSignificantBits(),
            GamePluginMessageProtocol.V4
        );
        if (!Arrays.equals(encoded, selfPacket.customSkin) || !Arrays.equals(encoded, otherV4Packet.customSkin)) {
            throw new AssertionError("fresh self and observer V4 skin packets must contain identical texture bytes");
        }
        SPacketOtherSkinCustomV5EAG otherV5Packet =
            (SPacketOtherSkinCustomV5EAG) skin.getSkinPacket(37, GamePluginMessageProtocol.V5);
        if (!Arrays.equals(encoded, otherV5Packet.customSkin)) {
            throw new AssertionError("fresh V5 observer packet must preserve the plugin V4 texture bytes");
        }

        byte[] selfTexture = SkinPacketVersionCache.convertToV3Raw(selfPacket.customSkin);
        byte[] otherTexture = SkinPacketVersionCache.convertToV3Raw(otherV4Packet.customSkin);
        byte[] otherV5Texture = SkinPacketVersionCache.convertToV3Raw(otherV5Packet.customSkin);
        SPacketOtherSkinCustomV3EAG otherV3Packet = (SPacketOtherSkinCustomV3EAG) skin.getSkinPacket(
            playerUuid.getMostSignificantBits(),
            playerUuid.getLeastSignificantBits(),
            GamePluginMessageProtocol.V3
        );
        if (!Arrays.equals(selfTexture, otherTexture) || !Arrays.equals(selfTexture, otherV5Texture)
            || !Arrays.equals(selfTexture, otherV3Packet.customSkin)
            || !Arrays.equals(selfTexture, skin.getCustomSkinPixels_ABGR8_64x64())) {
            throw new AssertionError("fresh self and every observer protocol must reach identical ABGR texture bytes");
        }

        for (int index = 0; index < colors.length; index++) {
            int source = colors[index];
            int expected = ((source & 0x80000000) == 0 ? 0 : 0xff000000)
                | (source & 0x00feffff);
            int byteIndex = pixelIndexes[index] * 4;
            int actual = abgrTexturePixel(selfTexture, byteIndex);
            if (actual != expected) {
                throw new AssertionError(
                    "browser skin packet changed pixel " + index
                        + ": expected 0x" + Integer.toHexString(expected)
                        + " but got 0x" + Integer.toHexString(actual)
                );
            }
        }

        int transparentOuterLayer = abgrTexturePixel(selfTexture, pixelIndexes[3] * 4);
        int alpha127OuterLayer = abgrTexturePixel(selfTexture, pixelIndexes[4] * 4);
        int alpha128OuterLayer = abgrTexturePixel(selfTexture, pixelIndexes[5] * 4);
        int alpha254OuterLayer = abgrTexturePixel(selfTexture, pixelIndexes[6] * 4);
        if ((transparentOuterLayer >>> 24) != 0 || (alpha127OuterLayer >>> 24) != 0
            || (alpha128OuterLayer >>> 24) != 0xff || (alpha254OuterLayer >>> 24) != 0xff) {
            throw new AssertionError("Eagler V4 alpha must use its documented one-bit threshold");
        }
    }

    private static BufferedImage roundTripPng(BufferedImage source) {
        try {
            ByteArrayOutputStream encoded = new ByteArrayOutputStream();
            if (!ImageIO.write(source, "png", encoded)) throw new IOException("PNG writer is unavailable");
            BufferedImage decoded = ImageIO.read(new ByteArrayInputStream(encoded.toByteArray()));
            if (decoded == null) throw new IOException("diagnostic PNG could not be decoded");
            return decoded;
        } catch (IOException exception) {
            throw new AssertionError("could not build the diagnostic skin PNG", exception);
        }
    }

    private static int abgrTexturePixel(byte[] texture, int byteIndex) {
        return (Byte.toUnsignedInt(texture[byteIndex]) << 24)
            | Byte.toUnsignedInt(texture[byteIndex + 1])
            | (Byte.toUnsignedInt(texture[byteIndex + 2]) << 8)
            | (Byte.toUnsignedInt(texture[byteIndex + 3]) << 16);
    }

    private static void assertObserverSkinInvalidation() {
        UUID joiningUuid = UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        List<GameMessagePacket> selfPackets = new ArrayList<>();
        List<GameMessagePacket> v3Packets = new ArrayList<>();
        List<GameMessagePacket> v4Packets = new ArrayList<>();
        List<GameMessagePacket> failedPackets = new ArrayList<>();
        List<GameMessagePacket> v5Packets = new ArrayList<>();
        List<IEaglerPlayer<Object>> observers = List.of(
            observer(joiningUuid, GamePluginMessageProtocol.V4, selfPackets),
            observer(UUID.fromString("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"), GamePluginMessageProtocol.V3, v3Packets),
            observer(UUID.fromString("cccccccc-cccc-4ccc-8ccc-cccccccccccc"), GamePluginMessageProtocol.V4, v4Packets),
            observer(
                UUID.fromString("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"),
                GamePluginMessageProtocol.V4,
                failedPackets,
                true
            ),
            observer(UUID.fromString("dddddddd-dddd-4ddd-8ddd-dddddddddddd"), GamePluginMessageProtocol.V5, v5Packets)
        );

        int invalidated = SpawnpointBridgePlugin.invalidateObserverSkinCaches(joiningUuid, observers);
        if (invalidated != 2 || !selfPackets.isEmpty() || !v3Packets.isEmpty() || !failedPackets.isEmpty()
            || v4Packets.size() != 1 || v5Packets.size() != 1) {
            throw new AssertionError("skin invalidation must isolate a failed observer and continue to later V4+ observers");
        }
        assertSkinInvalidationPacket(joiningUuid, v4Packets.get(0));
        assertSkinInvalidationPacket(joiningUuid, v5Packets.get(0));
    }

    private static void assertSkinInvalidationPacket(UUID expectedUuid, GameMessagePacket message) {
        if (!(message instanceof SPacketInvalidatePlayerCacheV4EAG packet) || packet.players.size() != 1) {
            throw new AssertionError("observer did not receive one skin invalidation request");
        }
        SPacketInvalidatePlayerCacheV4EAG.InvalidateRequest request = packet.players.iterator().next();
        if (!request.invalidateSkin || request.invalidateCape
            || request.uuidMost != expectedUuid.getMostSignificantBits()
            || request.uuidLeast != expectedUuid.getLeastSignificantBits()) {
            throw new AssertionError("observer skin invalidation packet has the wrong flags or UUID");
        }
    }

    private static IEaglerPlayer<Object> observer(
        UUID uuid,
        GamePluginMessageProtocol protocol,
        List<GameMessagePacket> packets
    ) {
        return observer(uuid, protocol, packets, false);
    }

    @SuppressWarnings("unchecked")
    private static IEaglerPlayer<Object> observer(
        UUID uuid,
        GamePluginMessageProtocol protocol,
        List<GameMessagePacket> packets,
        boolean failSend
    ) {
        return (IEaglerPlayer<Object>) Proxy.newProxyInstance(
            CommandRewriteTest.class.getClassLoader(),
            new Class<?>[] {IEaglerPlayer.class},
            (proxy, method, args) -> switch (method.getName()) {
                case "getUniqueId" -> uuid;
                case "getEaglerProtocol" -> protocol;
                case "sendEaglerMessage" -> {
                    if (failSend) throw new IllegalStateException("observer disconnected");
                    packets.add((GameMessagePacket) args[0]);
                    yield null;
                }
                case "toString" -> "observer[" + uuid + "," + protocol + "]";
                default -> throw new UnsupportedOperationException("unexpected observer method: " + method.getName());
            }
        );
    }

    private static void assertRewrite(String expected, String input) {
        SpawnpointBridgePlugin.CommandRewrite rewrite = SpawnpointBridgePlugin.rewriteDisplayNameCommand(input, TARGETS);
        if (rewrite.ambiguousDisplayName() || !expected.equals(rewrite.message())) {
            throw new AssertionError("expected <" + expected + "> but got <" + rewrite.message() + ">");
        }
    }

    private static void assertTellAlias(String expected, String... args) {
        SpawnpointBridgePlugin.CommandRewrite rewrite = SpawnpointBridgePlugin.rewriteTellAliasCommand(args, TARGETS);
        if (rewrite.ambiguousDisplayName() || !expected.equals(rewrite.message())) {
            throw new AssertionError("expected <" + expected + "> but got <" + rewrite.message() + ">");
        }
    }

    private static void assertWhisper(String expectedTarget, String expectedMessage, String command) {
        SpawnpointBridgePlugin.WhisperCommand whisper = SpawnpointBridgePlugin.parseWhisperCommand(command);
        if (whisper == null || !expectedTarget.equals(whisper.target()) || !expectedMessage.equals(whisper.message())) {
            throw new AssertionError("could not parse whisper command <" + command + ">");
        }
    }

    private static void assertNoWhisper(String command) {
        if (SpawnpointBridgePlugin.parseWhisperCommand(command) != null) {
            throw new AssertionError("non-whisper command was captured <" + command + ">");
        }
    }
}
