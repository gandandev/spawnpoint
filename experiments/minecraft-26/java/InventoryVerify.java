import java.nio.file.Path;
import java.util.List;
import java.util.Objects;
import net.minecraft.SharedConstants;
import net.minecraft.nbt.*;

/** Compare an exported inventory with the same player's stopped server save after a rehearsal login. */
public final class InventoryVerify {
    private static final List<String> TEXT = List.of("minecraft:custom_name", "minecraft:item_name", "minecraft:lore", "minecraft:written_book_content");
    // Paper writes an unstyled literal component as "text" instead of {text:"text"}.
    // Keep every other field exact, including styles, enchantments and nested item counts.
    static Tag canonical(Tag tag, boolean textComponent) {
        if (tag instanceof CompoundTag compound) {
            if (textComponent && compound.size() == 1 && compound.getString("text").isPresent())
                return StringTag.valueOf(compound.getString("text").orElseThrow());
            var result = new CompoundTag();
            for (String key : compound.keySet()) result.put(key, canonical(compound.get(key), textComponent || TEXT.contains(key)));
            return result;
        }
        if (tag instanceof ListTag list) {
            var result = new ListTag();
            for (Tag child : list) result.add(canonical(child, textComponent));
            return result;
        }
        return tag;
    }
    public static void main(String[] args) throws Exception {
        if (args.length != 2) throw new IllegalArgumentException("Usage: InventoryVerify EXPORTED_PLAYER SAVED_PLAYER");
        SharedConstants.tryDetectVersion();
        var expected = InventoryTransfer.read(Path.of(args[0]));
        var actual = InventoryTransfer.read(Path.of(args[1]));
        for (String key : List.of("Inventory", "equipment", "EnderItems", "XpP", "XpLevel", "XpTotal", "Score")) {
            if (!Objects.equals(canonical(expected.get(key), false), canonical(actual.get(key), false))) {
                System.err.println("Saved field changed: " + key);
                System.exit(1);
            }
        }
        if (actual.getIntOr("DataVersion", -1) != InventoryTransfer.currentVersion()) throw new AssertionError("Wrong saved data version");
        System.out.println("PASS: server saved the exported inventory, equipment, Ender Chest and XP without changes");
    }
}
