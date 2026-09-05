import java.nio.file.*;
import java.util.*;
import net.minecraft.SharedConstants;
import net.minecraft.nbt.*;
import net.minecraft.server.Bootstrap;

public final class InventoryTransferTest {
    static void check(boolean result, String message) {
        if (!result) throw new AssertionError(message);
    }

    public static void main(String[] args) throws Exception {
        SharedConstants.tryDetectVersion(); Bootstrap.bootStrap();
        Path root = Path.of(args[0]).toAbsolutePath(); Files.createDirectories(root);
        Path old = root.resolve("old-world"), fresh = root.resolve("fresh-world");
        Files.createDirectories(old.resolve("playerdata")); Files.createDirectories(old.resolve("data"));
        Files.createDirectories(fresh);
        String uuid = "a01e3843-e521-3998-958a-f459800e4d11"; // Offline-mode Player, also used for the local join rehearsal.
        CompoundTag fixture = TagParser.parseCompoundFully("""
            {DataVersion:1343,Inventory:[
              {Slot:0b,id:"minecraft:diamond_sword",Count:1b,Damage:7s,tag:{ench:[{id:16s,lvl:5s}],display:{Name:"테스트 검 🗡",Lore:["잃어버리면 안 되는 검"]}}},
              {Slot:8b,id:"minecraft:wool",Count:32b,Damage:14s},
              {Slot:100b,id:"minecraft:diamond_boots",Count:1b,Damage:3s},
              {Slot:-106b,id:"minecraft:shield",Count:1b,Damage:1s},
              {Slot:9b,id:"minecraft:purple_shulker_box",Count:1b,Damage:0s,tag:{BlockEntityTag:{Items:[{Slot:3b,id:"minecraft:diamond",Count:12b}]}}},
              {Slot:10b,id:"minecraft:filled_map",Count:1b,Damage:7s},
              {Slot:11b,id:"minecraft:written_book",Count:1b,tag:{author:"Player",title:"기록",pages:['{"text":"안녕 세계"}']}}
            ],EnderItems:[{Slot:2b,id:"minecraft:diamond",Count:64b}],
            XpP:0.5f,XpLevel:12,XpTotal:300,SelectedItemSlot:8,Score:42,
            Dimension:-1,Pos:[300d,64d,100d],SpawnX:20,SpawnY:70,SpawnZ:20,
            Health:2f,Fire:200s,FallDistance:50f,WorldUUIDMost:1L,WorldUUIDLeast:2L,
            RootVehicle:{Entity:{id:"minecraft:boat"}},ActiveEffects:[{Id:19b,Duration:200}],
            abilities:{flying:1b,mayfly:1b},playerGameType:1}
            """);
        Path player = old.resolve("playerdata/" + uuid + ".dat");
        NbtIo.writeCompressed(fixture, player);
        CompoundTag level = TagParser.parseCompoundFully("{Data:{DataVersion:" + InventoryTransfer.currentVersion()
            + ",spawn:{dimension:\"minecraft:overworld\",pos:[I;32,80,-16]}}}");
        NbtIo.writeCompressed(level, fresh.resolve("level.dat"));
        CompoundTag oldLevel = TagParser.parseCompoundFully("{Data:{DataVersion:1343}}");
        NbtIo.writeCompressed(oldLevel, old.resolve("level.dat"));
        CompoundTag map = TagParser.parseCompoundFully("{data:{dimension:0b,scale:0b,xCenter:0,zCenter:0,width:128s,height:128s,trackingPosition:1b}}");
        byte[] colors = new byte[16384]; Arrays.fill(colors, (byte) 12);
        map.getCompoundOrEmpty("data").putByteArray("colors", colors);
        NbtIo.writeCompressed(map, old.resolve("data/map_7.dat"));
        CompoundTag counters = TagParser.parseCompoundFully("{map:7s}");
        NbtIo.write(counters, old.resolve("data/idcounts.dat"));
        Files.createDirectories(old.resolve("region")); Files.writeString(old.resolve("region/do-not-copy.mca"), "old terrain");
        String before = InventoryTransfer.digest(player);
        Path output = root.resolve("export");
        InventoryTransfer.export(old, fresh, output);
        CompoundTag result = InventoryTransfer.read(output.resolve("world/players/data/" + uuid + ".dat"));
        check(before.equals(InventoryTransfer.digest(player)), "source changed");
        check(InventoryTransfer.itemCount(result) == 102, "stack amounts lost");
        check(result.getIntOr("DataVersion", 0) == InventoryTransfer.currentVersion(), "old version left on converted data");
        check(result.getIntOr("XpTotal", 0) == 300 && result.getIntOr("XpLevel", 0) == 12, "XP lost");
        check(result.getIntOr("SelectedItemSlot", -1) == 8, "selected hotbar slot lost");
        String items = result.toString();
        check(items.contains("minecraft:red_wool") && items.contains("count:32"), "legacy item variant lost");
        check(items.contains("테스트 검 🗡") && items.contains("잃어버리면 안 되는 검"), "Unicode name/lore lost");
        check(items.contains("minecraft:sharpness") && items.contains("minecraft:damage"), "enchantments or durability lost");
        check(items.contains("minecraft:container") && items.contains("count:12"), "nested shulker contents lost");
        check(items.contains("minecraft:written_book_content") && items.contains("안녕 세계"), "book content lost");
        check(items.contains("minecraft:map_id"), "filled map ID lost");
        check(result.getCompoundOrEmpty("equipment").contains("feet") && result.getCompoundOrEmpty("equipment").contains("offhand"), "armor/offhand lost");
        for (String key : List.of("respawn", "SpawnX", "RootVehicle", "abilities", "ActiveEffects", "Fire", "FallDistance", "WorldUUIDMost"))
            check(!result.contains(key), "old world state copied: " + key);
        check(result.getListOrEmpty("Pos").toString().equals("[32.5d,80.0d,-15.5d]"), "unsafe old position");
        check(!Files.exists(output.resolve("world/region")), "terrain copied");
        try (var files = Files.walk(output.resolve("world/data"))) {
            var savedMaps = files.filter(p -> p.toString().endsWith(".dat")).toList();
            check(savedMaps.size() == 2, "map/counter missing");
            check(savedMaps.stream().anyMatch(p -> p.toString().contains("last_id")), "map counter not moved to modern path");
            Path counter = savedMaps.stream().filter(p -> p.toString().contains("last_id")).findFirst().orElseThrow();
            var mapIndex = net.minecraft.world.level.saveddata.maps.MapIndex.CODEC.parse(NbtOps.INSTANCE,
                InventoryTransfer.read(counter).getCompoundOrEmpty("data")).getOrThrow();
            check(mapIndex.getNextMapId().id() > 7, "next map would overwrite an imported map");
            Path mapFile = savedMaps.stream().filter(p -> !p.toString().contains("last_id")).findFirst().orElseThrow();
            check(Arrays.equals(InventoryTransfer.read(mapFile).getCompoundOrEmpty("data").getByteArray("colors").orElseThrow(), colors), "map pixels changed");
        }
        boolean rejected = false;
        try { InventoryTransfer.export(old, fresh, output); } catch (java.io.IOException expected) { rejected = true; }
        check(rejected, "existing export overwritten");
        rejected = false;
        try { InventoryTransfer.export(old, fresh, old.resolve("unsafe")); } catch (java.io.IOException expected) { rejected = true; }
        check(rejected, "export into source allowed");
        CompoundTag future = fixture.copy(); future.putInt("DataVersion", InventoryTransfer.currentVersion());
        rejected = false;
        try { InventoryTransfer.convertPlayer(future, new int[]{0,80,0}); } catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected, "unsupported input version accepted");
        var literal = TagParser.parseCompoundFully("{components:{\"minecraft:custom_name\":\"검\"}}");
        var objectText = TagParser.parseCompoundFully("{components:{\"minecraft:custom_name\":{text:\"검\"}}}");
        var styled = TagParser.parseCompoundFully("{components:{\"minecraft:custom_name\":{text:\"검\",bold:1b}}}");
        check(InventoryVerify.canonical(literal, false).equals(InventoryVerify.canonical(objectText, false)), "equivalent saved text rejected");
        check(!InventoryVerify.canonical(literal, false).equals(InventoryVerify.canonical(styled, false)), "text styling loss hidden");
        System.out.println("PASS: 1.12.2 inventory conversion, nested items, maps, safe reset, source integrity, overwrite refusal");
    }
}
