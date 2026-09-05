import org.bukkit.GameRule;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.server.ServerLoadEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** Used only by the offline fresh-world generator, never installed on the preview. */
public final class FreshSpawn extends JavaPlugin implements Listener {
    @Override public void onEnable() { getServer().getPluginManager().registerEvents(this, this); }
    @EventHandler public void ready(ServerLoadEvent event) {
        World world = getServer().getWorld("world");
        Location initial = world.getSpawnLocation();
        Location safe = null;
        search: for (int radius = 0; radius <= 64; radius += 4) {
            for (int x = -radius; x <= radius; x += 4) for (int z = -radius; z <= radius; z += 4) {
                Block ground = world.getHighestBlockAt(initial.getBlockX() + x, initial.getBlockZ() + z);
                if (!ground.getType().isOccluding() || ground.isLiquid() || ground.getType().name().endsWith("LEAVES")) continue;
                if (!ground.getRelative(0, 1, 0).getType().isAir() || !ground.getRelative(0, 2, 0).getType().isAir()) continue;
                safe = ground.getLocation().add(0.5, 1, 0.5); break search;
            }
        }
        if (safe == null) throw new IllegalStateException("No safe spawn found; do not export this world");
        world.setSpawnLocation(safe);
        world.setGameRule(GameRule.SPAWN_RADIUS, 0);
        getLogger().info("VERIFIED_FRESH_SPAWN " + safe.getBlockX() + " " + safe.getBlockY() + " " + safe.getBlockZ());
        getServer().getScheduler().runTaskLater(this, () -> getServer().shutdown(), 40);
    }
}
