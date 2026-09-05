import com.google.gson.GsonBuilder;
import java.io.IOException;
import java.io.DataInputStream;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.Pattern;
import net.minecraft.SharedConstants;
import net.minecraft.nbt.*;
import net.minecraft.server.Bootstrap;
import net.minecraft.util.datafix.*;
import net.minecraft.world.level.saveddata.maps.MapId;
import net.minecraft.world.level.saveddata.maps.MapIndex;
import net.minecraft.world.level.saveddata.maps.MapItemSavedData;
import ca.spottedleaf.dataconverter.minecraft.MCDataConverter;
import ca.spottedleaf.dataconverter.minecraft.datatypes.MCTypeRegistry;

/** Offline export only. Never opens a server, edits the source, or overwrites a destination. */
public final class InventoryTransfer {
    private static final Pattern PLAYER = Pattern.compile("[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}\\.dat");
    private static final List<String> KEEP = List.of(
        "Inventory", "equipment", "EnderItems", "SelectedItemSlot", "XpP", "XpLevel", "XpTotal", "Score"
    );
    private static final int LEGACY_VERSION = 1343;

    public static void main(String[] args) throws Exception {
        if (args.length != 3) throw new IllegalArgumentException(
            "Usage: InventoryTransfer OLD_WORLD FRESH_26_WORLD NEW_EXPORT_DIRECTORY");
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        export(Path.of(args[0]), Path.of(args[1]), Path.of(args[2]));
    }

    static CompoundTag read(Path path) throws IOException {
        if (Files.isSymbolicLink(path)) throw new IOException("Refusing symbolic link: " + path);
        byte[] header;
        try (var stream = Files.newInputStream(path)) { header = stream.readNBytes(2); }
        if (header.length == 2 && header[0] == (byte) 0x1f && header[1] == (byte) 0x8b)
            return NbtIo.readCompressed(path, NbtAccounter.create(32L * 1024 * 1024));
        try (var input = new DataInputStream(Files.newInputStream(path))) {
            return NbtIo.read(input, NbtAccounter.create(32L * 1024 * 1024));
        }
    }

    static int currentVersion() { return SharedConstants.getCurrentVersion().dataVersion().version(); }

    static CompoundTag convertPlayer(CompoundTag old, int[] spawn) {
        int version = old.getIntOr("DataVersion", LEGACY_VERSION);
        if (version != LEGACY_VERSION) throw new IllegalArgumentException(
            "Expected Minecraft 1.12.2 player DataVersion 1343, got " + version);
        for (String key : List.of("Inventory", "EnderItems")) {
            if (old.contains(key) && old.getList(key).isEmpty()) throw new IllegalArgumentException("Invalid " + key);
        }
        int before = itemCount(old);
        CompoundTag carry = new CompoundTag();
        for (String key : KEEP) if (old.contains(key)) carry.put(key, old.get(key).copy());
        // Use the same converter as Paper's PlayerDataStorage, including its legacy fixes.
        CompoundTag updated = MCDataConverter.convertTag(MCTypeRegistry.PLAYER, carry, version, currentVersion());
        if (before != itemCount(updated)) throw new IllegalStateException("Item count changed during conversion");
        CompoundTag result = new CompoundTag();
        for (String key : KEEP) if (updated.contains(key)) result.put(key, updated.get(key).copy());
        result.putInt("DataVersion", currentVersion());
        result.putString("Dimension", "minecraft:overworld");
        ListTag pos = new ListTag();
        pos.add(DoubleTag.valueOf(spawn[0] + 0.5));
        pos.add(DoubleTag.valueOf(spawn[1]));
        pos.add(DoubleTag.valueOf(spawn[2] + 0.5));
        result.put("Pos", pos);
        result.putFloat("Health", 20);
        result.putInt("foodLevel", 20);
        result.putFloat("foodSaturationLevel", 5);
        result.putInt("playerGameType", 0);
        // No old bed, vehicle, death location, fall, fire, effects, or world UUID tags survive.
        return result;
    }

    static int itemCount(CompoundTag player) {
        int count = 0;
        for (String key : List.of("Inventory", "EnderItems")) {
            for (Tag item : player.getListOrEmpty(key)) {
                if (!(item instanceof CompoundTag c)) throw new IllegalArgumentException("Invalid item");
                count = Math.addExact(count, count(c));
            }
        }
        for (Tag item : player.getCompoundOrEmpty("equipment").values()) {
            if (!(item instanceof CompoundTag c)) throw new IllegalArgumentException("Invalid equipment");
            count = Math.addExact(count, count(c));
        }
        return count;
    }

    private static int count(CompoundTag item) {
        int count = item.getIntOr("count", item.getByteOr("Count", (byte) 0));
        if (count <= 0 || item.getStringOr("id", "").isBlank()) throw new IllegalArgumentException("Invalid item stack");
        return count;
    }

    static String digest(Path file) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file)));
    }

    static void export(Path oldWorld, Path freshWorld, Path destination) throws Exception {
        oldWorld = oldWorld.toRealPath();
        freshWorld = freshWorld.toRealPath();
        Path parent = destination.toAbsolutePath().getParent().toRealPath();
        destination = parent.resolve(destination.getFileName());
        if (Files.exists(destination, LinkOption.NOFOLLOW_LINKS)
            || destination.startsWith(oldWorld) || destination.startsWith(freshWorld)
            || oldWorld.startsWith(destination) || freshWorld.startsWith(destination)) {
            throw new IOException("Export must be a new directory outside both worlds");
        }
        CompoundTag level = read(freshWorld.resolve("level.dat")).getCompoundOrEmpty("Data");
        if (read(oldWorld.resolve("level.dat")).getCompoundOrEmpty("Data").getIntOr("DataVersion", -1) != LEGACY_VERSION)
            throw new IOException("Legacy world must be Minecraft 1.12.2, DataVersion 1343");
        if (level.getIntOr("DataVersion", -1) != currentVersion()) throw new IOException("Fresh world must be Minecraft 26.2");
        CompoundTag spawnTag = level.getCompoundOrEmpty("spawn");
        if (!spawnTag.getStringOr("dimension", "").equals("minecraft:overworld")) throw new IOException("Expected an Overworld spawn");
        int[] spawn = spawnTag.getIntArray("pos").orElseThrow(() -> new IOException("Fresh world has no spawn"));
        if (spawn.length != 3 || spawn[1] < -64 || spawn[1] > 319) throw new IOException("Invalid spawn coordinates");
        Path sourcePlayers = oldWorld.resolve("playerdata");
        if (Files.isSymbolicLink(sourcePlayers) || !Files.isDirectory(sourcePlayers)) throw new IOException("Missing legacy playerdata directory");
        List<Path> players;
        try (var files = Files.list(sourcePlayers)) {
            players = files.filter(p -> PLAYER.matcher(p.getFileName().toString()).matches()).sorted().toList();
        }
        if (players.isEmpty()) throw new IOException("No legacy player saves found");
        // Complete conversion and validation before creating any output directory.
        Map<Path, CompoundTag> pending = new LinkedHashMap<>();
        Map<Path, String> hashes = new LinkedHashMap<>();
        List<Map<String, Object>> receipts = new ArrayList<>();
        for (Path player : players) {
            String hash = digest(player);
            CompoundTag old = read(player);
            CompoundTag converted = convertPlayer(old, spawn);
            pending.put(Path.of("world/players/data", player.getFileName().toString()), converted);
            hashes.put(player, hash);
            receipts.add(Map.of("uuid", player.getFileName().toString().replace(".dat", ""),
                "sourceSha256", hash, "itemCount", itemCount(converted),
                "xpLevel", converted.getIntOr("XpLevel", 0)));
        }
        int mapCount = 0;
        int maxMapId = -1;
        Path maps = oldWorld.resolve("data");
        if (Files.isSymbolicLink(maps)) throw new IOException("Refusing symbolic map directory");
        if (Files.isDirectory(maps)) {
            try (var files = Files.list(maps)) {
                for (Path file : files.sorted().toList()) {
                    var matcher = Pattern.compile("map_(\\d+)\\.dat").matcher(file.getFileName().toString());
                    if (!matcher.matches()) continue;
                    int id = Integer.parseInt(matcher.group(1));
                    maxMapId = Math.max(maxMapId, id);
                    hashes.put(file, digest(file));
                    CompoundTag map = read(file);
                    CompoundTag converted = DataFixTypes.SAVED_DATA_MAP_DATA.updateToCurrentVersion(
                        DataFixers.getDataFixer(), map, map.getIntOr("DataVersion", LEGACY_VERSION));
                    converted.putInt("DataVersion", currentVersion());
                    var key = MapItemSavedData.type(new MapId(id)).id();
                    pending.put(Path.of("world/data", key.getNamespace(), key.getPath() + ".dat"), converted);
                    mapCount++;
                }
            }
            Path counters = maps.resolve("idcounts.dat");
            if (mapCount > 0) {
                if (!Files.exists(counters)) throw new IOException("Maps exist but idcounts.dat is missing; refusing map ID collisions");
                hashes.put(counters, digest(counters));
                CompoundTag old = read(counters);
                // 1.12 stores this at the root. The data fixer adds the modern data wrapper itself.
                CompoundTag converted = DataFixTypes.SAVED_DATA_MAP_INDEX.updateToCurrentVersion(
                    DataFixers.getDataFixer(), old, old.getIntOr("DataVersion", LEGACY_VERSION));
                converted.putInt("DataVersion", currentVersion());
                var index = MapIndex.CODEC.parse(NbtOps.INSTANCE, converted.getCompoundOrEmpty("data")).getOrThrow();
                if (index.getNextMapId().id() <= maxMapId)
                    throw new IOException("Map counter would overwrite an imported map");
                var key = MapIndex.TYPE.id();
                pending.put(Path.of("world/data", key.getNamespace(), key.getPath() + ".dat"), converted);
            }
        }
        for (var entry : hashes.entrySet()) {
            if (!digest(entry.getKey()).equals(entry.getValue())) throw new IOException("Source changed during conversion; use a stopped backup");
        }
        Files.createDirectory(destination);
        for (var entry : pending.entrySet()) {
            Path file = destination.resolve(entry.getKey());
            Files.createDirectories(file.getParent());
            NbtIo.writeCompressed(entry.getValue(), file);
            if (!read(file).equals(entry.getValue())) throw new IOException("Output round-trip failed: " + file);
        }
        Map<String, Object> report = new LinkedHashMap<>();
        report.put("status", "exported-not-installed");
        report.put("minecraft", "26.2");
        report.put("dataVersion", currentVersion());
        report.put("spawn", spawn);
        report.put("spawnSafety", "Uses configured world spawn. Operator must verify solid ground and clear headroom before export.");
        report.put("players", receipts);
        report.put("maps", mapCount);
        report.put("terrainCopied", false);
        report.put("preserved", KEEP);
        report.put("reset", List.of("terrain", "position", "bedSpawn", "health", "hunger", "effects", "gameMode", "advancements", "statistics"));
        Files.writeString(destination.resolve("transfer-report.json"), new GsonBuilder().setPrettyPrinting().create().toJson(report) + "\n", StandardOpenOption.CREATE_NEW);
        System.out.println("Exported " + players.size() + " players and " + mapCount + " maps to " + destination);
    }
}
