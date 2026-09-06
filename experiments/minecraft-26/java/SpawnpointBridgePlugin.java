package dev.spawnpoint;

import com.mojang.authlib.GameProfile;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.awt.image.BufferedImage;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.imageio.ImageIO;
import net.md_5.bungee.api.chat.BaseComponent;
import net.md_5.bungee.api.chat.ClickEvent;
import net.md_5.bungee.api.chat.HoverEvent;
import net.md_5.bungee.api.chat.TextComponent;
import net.md_5.bungee.api.chat.TranslatableComponent;
import net.md_5.bungee.chat.ComponentSerializer;
import org.bukkit.ChatColor;
import org.bukkit.BanList;
import org.bukkit.Chunk;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Statistic;
import org.bukkit.World;
import org.bukkit.advancement.Advancement;
import org.bukkit.block.Block;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.PluginCommand;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.world.ChunkLoadEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerAdvancementDoneEvent;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.event.player.PlayerBedEnterEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerLoginEvent;
import org.bukkit.event.player.PlayerGameModeChangeEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.block.data.type.Bed;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

public final class SpawnpointBridgePlugin extends JavaPlugin implements Listener, CommandExecutor {
    private static final int DEFAULT_BRIDGE_PORT = 25_566;
    private static final int MAX_REQUEST_BYTES = 8 * 1_024;
    private static final int MAX_RESPONSE_BYTES = 1_024 * 1_024;
    private static final long MAIN_THREAD_TIMEOUT_SECONDS = 3L;
    private static final double LOCATOR_RANGE_SQUARED = 128.0D * 128.0D;
    private static final long TPA_REQUEST_MILLIS = 60_000L;
    private static final long TPA_REQUEST_TICKS = 60L * 20L;
    private static final long TPA_COOLDOWN_MILLIS = 3_000L;
    private static final long COMMAND_IDENTITY_REFRESH_TICKS = 10L * 20L;
    private static final int IDENTITY_RESOLVE_ATTEMPTS = 40;
    private static final int DIAMOND_BONUS_Y_MIN = -58;
    private static final int DIAMOND_BONUS_Y_MAX = -50;
    private static final int DIAMOND_BONUS_VEIN_SIZE = 5;
    private static final int DIAMOND_BONUS_CANDIDATES = 6;
    private static final double LEGACY_DIAMOND_BONUS_RATE = 0.25D;
    private static final double DEFAULT_DIAMOND_BONUS_RATE = 0.70D;
    private static final int DIAMOND_BONUS_PROFILE_VERSION = 3;
    private static final int DIAMOND_BALANCE_TILE_SIZE = 4;
    private static final int DIAMOND_BALANCE_TILE_CELLS = DIAMOND_BALANCE_TILE_SIZE * DIAMOND_BALANCE_TILE_SIZE;
    private static final int DIAMOND_BONUS_CHUNKS_PER_TICK = 1;
    private static final long DIAMOND_MARKER_FLUSH_TICKS = 20L * 60L;
    private static final int DIAMOND_MARKER_MAGIC = 0x5350444D;
    private static final int LEGACY_DIAMOND_MARKER_VERSION = 1;
    private static final int DIAMOND_MARKER_VERSION = 3;
    private static final int MAX_DIAMOND_MARKERS = 5_000_000;
    private static final Pattern TECHNICAL_GAME_USERNAME = Pattern.compile("(?i)sp_[a-f0-9]{13}");
    private static final Pattern PLAYER_KEY = Pattern.compile("(?i)(?:[a-z0-9_]{3,16}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})");
    private static final Set<String> TITLE_COLORS = Set.of(
        "white", "gray", "red", "gold", "yellow", "green", "aqua", "blue", "light_purple"
    );
    private static final Set<String> WHISPER_COMMANDS = Set.of(
        "tell", "msg", "w", "whisper", "message", "pm", "dm"
    );

    private byte[] secret;
    private String portalOrigin;
    private HttpServer bridgeServer;
    private ExecutorService bridgeExecutor;
    private ExecutorService historyExecutor;
    private BukkitTask locatorSnapshotTask;
    private BukkitTask commandIdentityRefreshTask;
    private BukkitTask diamondBonusTask;
    private BukkitTask diamondMarkerFlushTask;
    private boolean tpaEnabled;
    private boolean keepInventory;
    private boolean diamondBonusEnabled;
    private double diamondBonusRate;
    private double existingChunkDiamondBonusRate;
    private final Map<String, PlayerIdentity> pendingIdentities = new ConcurrentHashMap<>();
    private final Map<UUID, PlayerIdentity> activeIdentities = new ConcurrentHashMap<>();
    private volatile Map<String, JsonObject> locatorSnapshots = Map.of();
    private volatile List<CommandTargetName> commandTargets = List.of();
    private final Map<UUID, TeleportRequest> teleportRequests = new HashMap<>();
    private final Map<UUID, BukkitTask> teleportExpiryTasks = new HashMap<>();
    private final Map<UUID, Long> teleportRequestCooldowns = new HashMap<>();
    private final Map<UUID, String> advancementRuleRestores = new HashMap<>();
    private final Object diamondMarkerLock = new Object();
    private final Object diamondMarkerWriteLock = new Object();
    private final Set<ProcessedChunk> legacyProcessedDiamondChunks = new HashSet<>();
    private final Set<ProcessedChunk> balancedProcessedDiamondChunks = new HashSet<>();
    private final Set<ProcessedChunk> processedDiamondChunks = new HashSet<>();
    private final Set<ProcessedChunk> queuedDiamondChunks = new HashSet<>();
    private final Deque<Chunk> diamondChunkQueue = new ArrayDeque<>();
    private long diamondMarkerGeneration;
    private long flushedDiamondMarkerGeneration = -1L;
    private boolean diamondMarkersLoaded;
    private boolean advancementReflectionWarningLogged;
    private boolean deathTranslationWarningLogged;
    private boolean packetReflectionWarningLogged;
    private boolean commandIdentityWarningLogged;
    private volatile boolean historyEventWarningLogged;

    @Override
    public void onEnable() {
        try {
            this.secret = loadSecret();
        } catch (IOException exception) {
            getLogger().severe("Could not load the shared session secret: " + exception.getMessage());
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        boolean migrateDiamondBonusProfile = getConfig().getInt("diamond-bonus.profile-version", 0) < DIAMOND_BONUS_PROFILE_VERSION;
        getConfig().addDefault("tpa-enabled", true);
        getConfig().addDefault("keep-inventory", true);
        getConfig().addDefault("diamond-bonus.enabled", true);
        getConfig().addDefault("diamond-bonus.rate", DEFAULT_DIAMOND_BONUS_RATE);
        getConfig().addDefault("diamond-bonus.existing-chunk-rate", 0.50D);
        getConfig().addDefault("diamond-bonus.profile-version", DIAMOND_BONUS_PROFILE_VERSION);
        getConfig().options().copyDefaults(true);
        if (migrateDiamondBonusProfile) {
            getConfig().set("diamond-bonus.rate", DEFAULT_DIAMOND_BONUS_RATE);
            getConfig().set("diamond-bonus.existing-chunk-rate", 0.50D);
            getConfig().set("diamond-bonus.profile-version", DIAMOND_BONUS_PROFILE_VERSION);
        }
        try {
            savePluginConfig();
        } catch (IOException exception) {
            getLogger().severe("Could not save the default TPA setting: " + exception.getMessage());
        }
        this.tpaEnabled = getConfig().getBoolean("tpa-enabled", true);
        this.keepInventory = getConfig().getBoolean("keep-inventory", true);
        this.diamondBonusEnabled = getConfig().getBoolean("diamond-bonus.enabled", true);
        this.diamondBonusRate = boundedDiamondBonusRate(getConfig().getDouble("diamond-bonus.rate", DEFAULT_DIAMOND_BONUS_RATE));
        this.existingChunkDiamondBonusRate = boundedDiamondBonusRate(getConfig().getDouble("diamond-bonus.existing-chunk-rate", 0.50D));
        registerCommand("tpa");
        registerCommand("tpaccept");
        registerCommand("tpdeny");
        registerCommand("spawnpointtell");
        this.portalOrigin = env("PORTAL_INTERNAL_ORIGIN", "http://127.0.0.1:3000").replaceAll("/+$", "");
        this.historyExecutor = new ThreadPoolExecutor(
            1,
            1,
            0L,
            TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(2048),
            new HistoryThreadFactory(),
            new ThreadPoolExecutor.AbortPolicy()
        );
        getServer().getPluginManager().registerEvents(this, this);
        applyKeepInventory(keepInventory);
        initializeDiamondBonus();
        startBridgeServer();
        if (!isEnabled()) return;
        this.locatorSnapshotTask = getServer().getScheduler().runTaskTimer(this, this::refreshLocatorSnapshots, 1L, 1L);
        this.commandIdentityRefreshTask = getServer().getScheduler().runTaskTimerAsynchronously(
            this,
            this::refreshCommandTargets,
            1L,
            COMMAND_IDENTITY_REFRESH_TICKS
        );
        getLogger().info("Site-ticket authentication and the loopback server bridge are active.");
    }

    private void applyKeepInventory(boolean enabled) {
        int updatedWorlds = 0;
        for (World world : getServer().getWorlds()) {
            if (world.setGameRule(org.bukkit.GameRule.KEEP_INVENTORY, enabled)) {
                updatedWorlds++;
            } else {
                getLogger().warning("Could not update keepInventory in world " + world.getName() + ".");
            }
        }
        getLogger().info("Set keepInventory=" + enabled + " in " + updatedWorlds + " loaded worlds.");
    }

    @Override
    public void onDisable() {
        if (locatorSnapshotTask != null) locatorSnapshotTask.cancel();
        if (commandIdentityRefreshTask != null) commandIdentityRefreshTask.cancel();
        if (diamondBonusTask != null) diamondBonusTask.cancel();
        if (diamondMarkerFlushTask != null) diamondMarkerFlushTask.cancel();
        flushDiamondMarkers();
        restoreAdvancementAnnouncementRules();
        getServer().getOnlinePlayers().forEach(this::removeDisplayNamePacketHandler);
        locatorSnapshots = Map.of();
        commandTargets = List.of();
        pendingIdentities.clear();
        activeIdentities.clear();
        teleportRequests.clear();
        teleportExpiryTasks.values().forEach(BukkitTask::cancel);
        teleportExpiryTasks.clear();
        teleportRequestCooldowns.clear();
        if (historyExecutor != null) {
            historyExecutor.shutdown();
            try {
                if (!historyExecutor.awaitTermination(3, TimeUnit.SECONDS)) historyExecutor.shutdownNow();
            } catch (InterruptedException exception) {
                historyExecutor.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }
        if (bridgeServer != null) bridgeServer.stop(0);
        if (bridgeExecutor != null) {
            bridgeExecutor.shutdownNow();
            try {
                if (!bridgeExecutor.awaitTermination(2, TimeUnit.SECONDS)) {
                    getLogger().warning("The server bridge worker did not stop cleanly.");
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private void initializeDiamondBonus() {
        if (!diamondBonusEnabled || diamondBonusRate <= 0.0D) return;
        try {
            synchronized (diamondMarkerLock) {
                DiamondMarkerState markerState = readDiamondMarkers(diamondMarkerPath());
                legacyProcessedDiamondChunks.addAll(markerState.legacyProcessedChunks);
                balancedProcessedDiamondChunks.addAll(markerState.balancedProcessedChunks);
                processedDiamondChunks.addAll(markerState.frequentProcessedChunks);
                diamondMarkerGeneration = processedDiamondChunks.size();
                flushedDiamondMarkerGeneration = markerState.requiresMigration ? -1L : diamondMarkerGeneration;
                diamondMarkersLoaded = true;
            }
        } catch (IOException exception) {
            // Reprocessing a damaged marker file would duplicate ore. Leave the
            // feature off until an operator explicitly repairs or removes it.
            diamondBonusEnabled = false;
            getLogger().severe("Diamond bonus is disabled because its processed-chunk marker could not be read: " + exception.getMessage());
            return;
        }
        diamondBonusTask = getServer().getScheduler().runTaskTimer(this, this::processDiamondBonusQueue, 1L, 1L);
        diamondMarkerFlushTask = getServer().getScheduler().runTaskTimerAsynchronously(
            this,
            this::flushDiamondMarkers,
            DIAMOND_MARKER_FLUSH_TICKS,
            DIAMOND_MARKER_FLUSH_TICKS
        );
        for (World world : getServer().getWorlds()) {
            for (Chunk chunk : world.getLoadedChunks()) queueDiamondBonusChunk(chunk);
        }
        getLogger().info("Diamond bonus profile 3 is enabled: 2-5 ore per vein at Y=-58..-50, target near "
            + Math.round(diamondBonusRate * 100.0D) + "% of new normal-world chunks, " + Math.round(Math.min(diamondBonusRate, existingChunkDiamondBonusRate) * 100.0D)
            + "% of previously processed chunks."
            + (legacyProcessedDiamondChunks.isEmpty() ? "" : " Legacy coverage is preserved without duplicate veins."));
    }

    @EventHandler(priority = EventPriority.NORMAL)
    public void onDiamondBonusChunkLoad(ChunkLoadEvent event) {
        queueDiamondBonusChunk(event.getChunk());
    }

    private void queueDiamondBonusChunk(Chunk chunk) {
        if (!diamondBonusEnabled || diamondBonusRate <= 0.0D) return;
        World world = chunk.getWorld();
        if (world.getEnvironment() != World.Environment.NORMAL) return;
        ProcessedChunk marker = new ProcessedChunk(world.getUID(), chunk.getX(), chunk.getZ());
        synchronized (diamondMarkerLock) {
            if (processedDiamondChunks.contains(marker) || !queuedDiamondChunks.add(marker)) return;
            diamondChunkQueue.addLast(chunk);
        }
    }

    private void processDiamondBonusQueue() {
        for (int index = 0; index < DIAMOND_BONUS_CHUNKS_PER_TICK; index++) {
            Chunk chunk;
            ProcessedChunk marker;
            synchronized (diamondMarkerLock) {
                chunk = diamondChunkQueue.pollFirst();
                if (chunk == null) return;
                marker = new ProcessedChunk(chunk.getWorld().getUID(), chunk.getX(), chunk.getZ());
                queuedDiamondChunks.remove(marker);
                if (processedDiamondChunks.contains(marker)) continue;
            }
            if (!chunk.isLoaded()) continue;
            applyDiamondBonus(chunk);
            synchronized (diamondMarkerLock) {
                if (processedDiamondChunks.add(marker)) diamondMarkerGeneration++;
            }
        }
    }

    private void applyDiamondBonus(Chunk chunk) {
        World world = chunk.getWorld();
        ProcessedChunk marker = new ProcessedChunk(world.getUID(), chunk.getX(), chunk.getZ());
        // Older chunks retain their earlier bonus ore, so they need fewer new veins.
        boolean previouslyProcessed = legacyProcessedDiamondChunks.contains(marker) || balancedProcessedDiamondChunks.contains(marker);
        double rate = previouslyProcessed ? Math.min(diamondBonusRate, existingChunkDiamondBonusRate) : diamondBonusRate;
        if (!shouldAddDiamondBonus(world.getSeed(), chunk.getX(), chunk.getZ(), rate)) return;
        for (int candidate = 0; candidate < DIAMOND_BONUS_CANDIDATES; candidate++) {
            List<DiamondBonusBlock> vein = frequentDiamondBonusVein(world.getSeed(), chunk.getX(), chunk.getZ(), candidate);
            if (vein.size() < 2 || vein.size() > 5 || !vein.stream().allMatch(position -> isFullyEnclosedStone(world, position))) {
                continue;
            }
            // Validate the whole vein before changing any block. Every source
            // was enclosed by stone in the generated terrain, even though vein
            // members become adjacent diamonds after this loop.
            for (DiamondBonusBlock position : vein) {
                Block target = world.getBlockAt(position.x, position.y, position.z);
                target.setType(target.getType() == Material.DEEPSLATE ? Material.DEEPSLATE_DIAMOND_ORE : Material.DIAMOND_ORE);
            }
            return;
        }
    }

    private static boolean isDiamondHost(Material material) {
        return material == Material.STONE || material == Material.DEEPSLATE;
    }

    private static boolean isFullyEnclosedStone(World world, DiamondBonusBlock position) {
        Block block = world.getBlockAt(position.x, position.y, position.z);
        if (!isDiamondHost(block.getType())) return false;
        return isDiamondHost(block.getRelative(1, 0, 0).getType())
            && isDiamondHost(block.getRelative(-1, 0, 0).getType())
            && isDiamondHost(block.getRelative(0, 1, 0).getType())
            && isDiamondHost(block.getRelative(0, -1, 0).getType())
            && isDiamondHost(block.getRelative(0, 0, 1).getType())
            && isDiamondHost(block.getRelative(0, 0, -1).getType());
    }

    static boolean shouldAddDiamondBonus(long worldSeed, int chunkX, int chunkZ, double rate) {
        rate = boundedDiamondBonusRate(rate);
        if (rate <= 0.0D) return false;
        if (rate >= 1.0D) return true;
        if (rate <= LEGACY_DIAMOND_BONUS_RATE) {
            return shouldAddLegacyDiamondBonus(worldSeed, chunkX, chunkZ, rate);
        }

        int tileX = Math.floorDiv(chunkX, DIAMOND_BALANCE_TILE_SIZE);
        int tileZ = Math.floorDiv(chunkZ, DIAMOND_BALANCE_TILE_SIZE);
        int localX = Math.floorMod(chunkX, DIAMOND_BALANCE_TILE_SIZE);
        int localZ = Math.floorMod(chunkZ, DIAMOND_BALANCE_TILE_SIZE);
        boolean[] selected = new boolean[DIAMOND_BALANCE_TILE_CELLS];
        int[] rowCounts = new int[DIAMOND_BALANCE_TILE_SIZE];
        int[] columnCounts = new int[DIAMOND_BALANCE_TILE_SIZE];
        int selectedCount = 0;
        for (int index = 0; index < DIAMOND_BALANCE_TILE_CELLS; index++) {
            int candidateLocalX = index % DIAMOND_BALANCE_TILE_SIZE;
            int candidateLocalZ = index / DIAMOND_BALANCE_TILE_SIZE;
            int candidateX = tileX * DIAMOND_BALANCE_TILE_SIZE + candidateLocalX;
            int candidateZ = tileZ * DIAMOND_BALANCE_TILE_SIZE + candidateLocalZ;
            if (!shouldAddLegacyDiamondBonus(worldSeed, candidateX, candidateZ, LEGACY_DIAMOND_BONUS_RATE)) continue;
            selected[index] = true;
            rowCounts[candidateLocalZ]++;
            columnCounts[candidateLocalX]++;
            selectedCount++;
        }

        double desiredInTile = rate * DIAMOND_BALANCE_TILE_CELLS;
        int targetCount = (int) Math.floor(desiredInTile);
        double fractionalTarget = desiredInTile - targetCount;
        long quotaSample = mixDiamondSeed(worldSeed, tileX, tileZ, 64);
        double quotaFraction = (double) (quotaSample >>> 11) * 0x1.0p-53;
        if (quotaFraction < fractionalTarget) targetCount++;

        while (selectedCount < targetCount || hasEmptyDiamondBalanceLane(rowCounts) || hasEmptyDiamondBalanceLane(columnCounts)) {
            int bestIndex = -1;
            int bestCoverageScore = Integer.MIN_VALUE;
            long bestTieBreaker = 0L;
            for (int index = 0; index < DIAMOND_BALANCE_TILE_CELLS; index++) {
                if (selected[index]) continue;
                int candidateLocalX = index % DIAMOND_BALANCE_TILE_SIZE;
                int candidateLocalZ = index / DIAMOND_BALANCE_TILE_SIZE;
                int coverageScore = (rowCounts[candidateLocalZ] == 0 ? 100 : 0)
                    + (columnCounts[candidateLocalX] == 0 ? 100 : 0)
                    - rowCounts[candidateLocalZ]
                    - columnCounts[candidateLocalX];
                int candidateX = tileX * DIAMOND_BALANCE_TILE_SIZE + candidateLocalX;
                int candidateZ = tileZ * DIAMOND_BALANCE_TILE_SIZE + candidateLocalZ;
                long tieBreaker = mixDiamondSeed(worldSeed, candidateX, candidateZ, 65);
                if (coverageScore > bestCoverageScore
                    || (coverageScore == bestCoverageScore && (bestIndex < 0 || Long.compareUnsigned(tieBreaker, bestTieBreaker) < 0))) {
                    bestIndex = index;
                    bestCoverageScore = coverageScore;
                    bestTieBreaker = tieBreaker;
                }
            }
            if (bestIndex < 0) break;
            selected[bestIndex] = true;
            int selectedLocalX = bestIndex % DIAMOND_BALANCE_TILE_SIZE;
            int selectedLocalZ = bestIndex / DIAMOND_BALANCE_TILE_SIZE;
            rowCounts[selectedLocalZ]++;
            columnCounts[selectedLocalX]++;
            selectedCount++;
        }
        return selected[localZ * DIAMOND_BALANCE_TILE_SIZE + localX];
    }

    private static boolean hasEmptyDiamondBalanceLane(int[] counts) {
        for (int count : counts) {
            if (count == 0) return true;
        }
        return false;
    }

    static boolean shouldAddLegacyDiamondBonus(long worldSeed, int chunkX, int chunkZ, double rate) {
        rate = boundedDiamondBonusRate(rate);
        if (rate <= 0.0D) return false;
        if (rate >= 1.0D) return true;
        long sample = mixDiamondSeed(worldSeed, chunkX, chunkZ, 0);
        double fraction = (double) (sample >>> 11) * 0x1.0p-53;
        return fraction < rate;
    }

    // Keep the old layout stable for migration fixtures and historical benchmarks.
    static List<DiamondBonusBlock> diamondBonusVein(long worldSeed, int chunkX, int chunkZ, int candidate) {
        return createDiamondVein(worldSeed, chunkX, chunkZ, candidate + 1,
            DIAMOND_BONUS_VEIN_SIZE, DIAMOND_BONUS_Y_MIN, DIAMOND_BONUS_Y_MAX);
    }

    static List<DiamondBonusBlock> frequentDiamondBonusVein(long worldSeed, int chunkX, int chunkZ, int candidate) {
        // Choose the size once per chunk so failed candidates do not favor small veins.
        int size = 2 + deterministicDiamondBound(mixDiamondSeed(worldSeed, chunkX, chunkZ, 100), 4);
        return createDiamondVein(worldSeed, chunkX, chunkZ, candidate + 101, size, DIAMOND_BONUS_Y_MIN, DIAMOND_BONUS_Y_MAX);
    }

    private static List<DiamondBonusBlock> createDiamondVein(long worldSeed, int chunkX, int chunkZ, int salt, int size, int minY, int maxY) {
        long state = mixDiamondSeed(worldSeed, chunkX, chunkZ, salt);
        int localX = 2 + deterministicDiamondBound(state, 12);
        state = mix64(state);
        int localY = minY + deterministicDiamondBound(state, maxY - minY + 1);
        state = mix64(state);
        int localZ = 2 + deterministicDiamondBound(state, 12);
        List<DiamondBonusBlock> result = new ArrayList<>();
        result.add(new DiamondBonusBlock(chunkX * 16 + localX, localY, chunkZ * 16 + localZ));
        int[][] directions = {{1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}, {0, 0, 1}, {0, 0, -1}};
        while (result.size() < size) {
            DiamondBonusBlock previous = result.get(result.size() - 1);
            DiamondBonusBlock next = null;
            for (int attempt = 0; attempt < directions.length; attempt++) {
                state = mix64(state);
                int[] direction = directions[deterministicDiamondBound(state, directions.length)];
                int x = previous.x + direction[0];
                int y = previous.y + direction[1];
                int z = previous.z + direction[2];
                int localCandidateX = Math.floorMod(x, 16);
                int localCandidateZ = Math.floorMod(z, 16);
                DiamondBonusBlock possible = new DiamondBonusBlock(x, y, z);
                if (localCandidateX >= 1 && localCandidateX <= 14
                    && localCandidateZ >= 1 && localCandidateZ <= 14
                    && y >= minY && y <= maxY
                    && !result.contains(possible)) {
                    next = possible;
                    break;
                }
            }
            if (next == null) return List.of();
            result.add(next);
        }
        return result;
    }

    private static double boundedDiamondBonusRate(double value) {
        if (!Double.isFinite(value)) return DEFAULT_DIAMOND_BONUS_RATE;
        return Math.max(0.0D, Math.min(1.0D, value));
    }

    private static long mixDiamondSeed(long worldSeed, int chunkX, int chunkZ, int salt) {
        long value = worldSeed;
        value ^= ((long) chunkX) * 0x9E3779B97F4A7C15L;
        value ^= ((long) chunkZ) * 0xC2B2AE3D27D4EB4FL;
        value ^= ((long) salt) * 0x165667B19E3779F9L;
        return mix64(value);
    }

    private static long mix64(long value) {
        value ^= value >>> 33;
        value *= 0xff51afd7ed558ccdL;
        value ^= value >>> 33;
        value *= 0xc4ceb9fe1a85ec53L;
        return value ^ value >>> 33;
    }

    private static int deterministicDiamondBound(long value, int bound) {
        return (int) Long.remainderUnsigned(value, bound);
    }

    private Path diamondMarkerPath() {
        return getDataFolder().toPath().resolve("diamond-bonus-processed.bin");
    }

    private void flushDiamondMarkers() {
        if (!diamondMarkersLoaded) return;
        List<ProcessedChunk> snapshot;
        long generation;
        synchronized (diamondMarkerLock) {
            if (flushedDiamondMarkerGeneration >= diamondMarkerGeneration) return;
            snapshot = new ArrayList<>(processedDiamondChunks);
            generation = diamondMarkerGeneration;
        }
        try {
            synchronized (diamondMarkerWriteLock) {
                synchronized (diamondMarkerLock) {
                    // onDisable can flush a newer snapshot while the async
                    // task is waiting here. Never let that older snapshot
                    // overwrite the newer marker file afterward.
                    if (flushedDiamondMarkerGeneration >= generation) return;
                }
                writeDiamondMarkers(diamondMarkerPath(), legacyProcessedDiamondChunks, balancedProcessedDiamondChunks, snapshot);
                synchronized (diamondMarkerLock) {
                    flushedDiamondMarkerGeneration = Math.max(flushedDiamondMarkerGeneration, generation);
                }
            }
        } catch (IOException exception) {
            getLogger().warning("Could not persist diamond bonus markers: " + exception.getMessage());
        }
    }

    static DiamondMarkerState readDiamondMarkers(Path path) throws IOException {
        if (!Files.exists(path)) return new DiamondMarkerState(new HashSet<>(), new HashSet<>(), new HashSet<>(), false);
        try (DataInputStream input = new DataInputStream(new BufferedInputStream(Files.newInputStream(path)))) {
            if (input.readInt() != DIAMOND_MARKER_MAGIC) throw new IOException("unknown marker format");
            int version = input.readInt();
            if (version == LEGACY_DIAMOND_MARKER_VERSION) {
                Set<ProcessedChunk> legacyMarkers = readDiamondMarkerEntries(input);
                if (input.read() != -1) throw new IOException("unexpected marker data");
                return new DiamondMarkerState(legacyMarkers, new HashSet<>(), new HashSet<>(), true);
            }
            if (version != 2 && version != DIAMOND_MARKER_VERSION) throw new IOException("unknown marker format");
            Set<ProcessedChunk> legacyMarkers = readDiamondMarkerEntries(input);
            Set<ProcessedChunk> balancedMarkers = readDiamondMarkerEntries(input);
            Set<ProcessedChunk> frequentMarkers = version == 2 ? new HashSet<>() : readDiamondMarkerEntries(input);
            if (input.read() != -1) throw new IOException("unexpected marker data");
            return new DiamondMarkerState(legacyMarkers, balancedMarkers, frequentMarkers, version == 2);
        }
    }

    private static Set<ProcessedChunk> readDiamondMarkerEntries(DataInputStream input) throws IOException {
        int count = input.readInt();
        if (count < 0 || count > MAX_DIAMOND_MARKERS) throw new IOException("invalid marker count");
        Set<ProcessedChunk> markers = new HashSet<>();
        for (int index = 0; index < count; index++) {
            UUID worldId = new UUID(input.readLong(), input.readLong());
            markers.add(new ProcessedChunk(worldId, input.readInt(), input.readInt()));
        }
        return markers;
    }

    static void writeDiamondMarkers(
        Path path,
        Iterable<ProcessedChunk> legacyMarkers,
        Iterable<ProcessedChunk> balancedMarkers,
        Iterable<ProcessedChunk> frequentMarkers
    ) throws IOException {
        List<ProcessedChunk> legacySnapshot = new ArrayList<>();
        legacyMarkers.forEach(legacySnapshot::add);
        List<ProcessedChunk> balancedSnapshot = new ArrayList<>();
        balancedMarkers.forEach(balancedSnapshot::add);
        List<ProcessedChunk> frequentSnapshot = new ArrayList<>();
        frequentMarkers.forEach(frequentSnapshot::add);
        if (frequentSnapshot.size() > MAX_DIAMOND_MARKERS || legacySnapshot.size() > MAX_DIAMOND_MARKERS || balancedSnapshot.size() > MAX_DIAMOND_MARKERS) {
            throw new IOException("too many diamond markers");
        }
        Files.createDirectories(path.getParent());
        Path temporary = path.resolveSibling(path.getFileName() + ".tmp");
        try (DataOutputStream output = new DataOutputStream(new BufferedOutputStream(Files.newOutputStream(temporary)))) {
            output.writeInt(DIAMOND_MARKER_MAGIC);
            output.writeInt(DIAMOND_MARKER_VERSION);
            writeDiamondMarkerEntries(output, legacySnapshot);
            writeDiamondMarkerEntries(output, balancedSnapshot);
            writeDiamondMarkerEntries(output, frequentSnapshot);
        }
        try {
            Files.move(temporary, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException exception) {
            Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static void writeDiamondMarkerEntries(DataOutputStream output, List<ProcessedChunk> markers) throws IOException {
        output.writeInt(markers.size());
        for (ProcessedChunk marker : markers) {
            output.writeLong(marker.worldId.getMostSignificantBits());
            output.writeLong(marker.worldId.getLeastSignificantBits());
            output.writeInt(marker.chunkX);
            output.writeInt(marker.chunkZ);
        }
    }

    private void registerCommand(String name) {
        PluginCommand command = getCommand(name);
        if (command == null) throw new IllegalStateException("Missing command registration: " + name);
        command.setExecutor(this);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        return switch (command.getName().toLowerCase(Locale.ROOT)) {
            case "tpa" -> handleTpa(sender, args);
            case "tpaccept" -> handleTpaResponse(sender, args, true);
            case "tpdeny" -> handleTpaResponse(sender, args, false);
            case "spawnpointtell" -> handleTellAlias(sender, args);
            default -> false;
        };
    }

    private boolean handleTellAlias(CommandSender sender, String[] args) {
        if (args.length < 2) return false;
        CommandRewrite rewrite = rewriteTellAliasCommand(args, commandTargets);
        if (rewrite.ambiguousDisplayName) {
            sender.sendMessage("같은 이름을 쓰는 플레이어가 여러 명이에요. 정확한 게임 ID를 입력하세요.");
            return true;
        }
        if (!getServer().dispatchCommand(sender, rewrite.message.substring(1))) {
            sender.sendMessage("귓속말을 보내지 못했어요. 받는 사람과 문구를 확인하세요.");
        } else if (sender instanceof Player player) {
            recordWhisperHistory(player, rewrite.message);
        }
        return true;
    }

    static CommandRewrite rewriteTellAliasCommand(String[] args, List<CommandTargetName> targets) {
        return rewriteDisplayNameCommand("/minecraft:tell " + String.join(" ", args), targets);
    }

    private boolean handleTpa(CommandSender sender, String[] args) {
        boolean settingArgument = args.length == 1
            && ("on".equalsIgnoreCase(args[0]) || "off".equalsIgnoreCase(args[0]));
        if (settingArgument) {
            if (!sender.isOp()) {
                sender.sendMessage("TPA 설정을 변경할 권한이 없어요.");
                return true;
            }
            boolean enabled = "on".equalsIgnoreCase(args[0]);
            try {
                setTpaEnabled(enabled);
            } catch (IllegalStateException exception) {
                getLogger().warning(exception.getMessage());
                sender.sendMessage("TPA 설정을 저장하지 못했어요.");
                return true;
            }
            sender.sendMessage(enabled ? "TPA를 켰어요." : "TPA를 껐어요.");
            return true;
        }
        if (!(sender instanceof Player requester)) {
            sender.sendMessage("플레이어만 TPA 요청을 보낼 수 있어요.");
            return true;
        }
        if (!tpaEnabled) {
            requester.sendMessage("TPA가 꺼져 있어요.");
            return true;
        }
        if (args.length == 0) {
            sendTpaPlayerList(requester);
            return true;
        }
        String targetName = String.join(" ", args);
        PlayerLookup lookup = findOnlinePlayer(requester, targetName);
        if (lookup.duplicateDisplayName) {
            requester.sendMessage("같은 이름을 쓰는 플레이어가 여러 명이에요. 관리자에게 알려주세요.");
            return true;
        }
        Player target = lookup.player;
        if (target == null) {
            requester.sendMessage("온라인 플레이어를 찾지 못했어요.");
            return true;
        }
        if (target.getUniqueId().equals(requester.getUniqueId())) {
            requester.sendMessage("자기 자신에게는 요청할 수 없어요.");
            return true;
        }

        long now = System.currentTimeMillis();
        long cooldownUntil = teleportRequestCooldowns.getOrDefault(requester.getUniqueId(), 0L);
        if (cooldownUntil > now) {
            requester.sendMessage("TPA 요청은 3초에 한 번 보낼 수 있어요.");
            return true;
        }

        UUID targetId = target.getUniqueId();
        TeleportRequest previous = teleportRequests.get(targetId);
        if (previous != null && expireTeleportRequest(targetId, previous)) previous = null;
        TeleportRequest request = new TeleportRequest(
            requester.getUniqueId(),
            targetId,
            System.currentTimeMillis() + TPA_REQUEST_MILLIS
        );
        cancelTeleportExpiration(targetId);
        teleportRequests.put(targetId, request);
        scheduleTeleportExpiration(request);
        teleportRequestCooldowns.put(requester.getUniqueId(), System.currentTimeMillis() + TPA_COOLDOWN_MILLIS);
        if (previous != null && !previous.requesterId.equals(requester.getUniqueId())) {
            Player previousRequester = getServer().getPlayer(previous.requesterId);
            if (previousRequester != null) {
                previousRequester.sendMessage(playerLabel(target) + "님에게 보낸 TPA 요청이 새 요청으로 바뀌었어요.");
            }
        }
        requester.sendMessage(playerLabel(target) + "님에게 TPA 요청을 보냈어요.");
        sendTeleportRequestMessage(target, requester);
        return true;
    }

    private void sendTpaPlayerList(Player requester) {
        List<? extends Player> targets = getServer().getOnlinePlayers().stream()
            .filter(candidate -> !candidate.getUniqueId().equals(requester.getUniqueId()))
            .filter(requester::canSee)
            .sorted(Comparator.comparing(SpawnpointBridgePlugin::playerLabel, String.CASE_INSENSITIVE_ORDER))
            .toList();
        if (targets.isEmpty()) {
            requester.sendMessage("온라인인 다른 플레이어가 없어요.");
            return;
        }

        TextComponent marker = new TextComponent("» ");
        marker.setBold(true);
        marker.setColor(net.md_5.bungee.api.ChatColor.GOLD);

        TextComponent prompt = new TextComponent("순간이동할 플레이어를 선택하세요");
        prompt.setColor(net.md_5.bungee.api.ChatColor.GRAY);
        requester.spigot().sendMessage(marker, prompt);

        for (Player target : targets) {
            String name = playerLabel(target);
            TextComponent indent = new TextComponent("  ");
            TextComponent bullet = new TextComponent("• ");
            bullet.setColor(net.md_5.bungee.api.ChatColor.DARK_GRAY);

            TextComponent playerButton = new TextComponent(name);
            playerButton.setBold(true);
            playerButton.setColor(net.md_5.bungee.api.ChatColor.GREEN);
            playerButton.setClickEvent(new ClickEvent(ClickEvent.Action.RUN_COMMAND, "/tpa " + target.getName()));
            playerButton.setHoverEvent(hoverText("클릭해서 " + name + "님에게 요청"));
            requester.spigot().sendMessage(indent, bullet, playerButton);
        }
    }

    private static void sendTeleportRequestMessage(Player target, Player requester) {
        TextComponent marker = new TextComponent("» ");
        marker.setBold(true);
        marker.setColor(net.md_5.bungee.api.ChatColor.GOLD);

        TextComponent requesterName = new TextComponent(playerLabel(requester));
        requesterName.setBold(true);
        requesterName.setColor(net.md_5.bungee.api.ChatColor.YELLOW);

        TextComponent request = new TextComponent("님이 순간이동을 요청했어요!");
        request.setColor(net.md_5.bungee.api.ChatColor.GRAY);

        target.spigot().sendMessage(marker, requesterName, request);

        TextComponent commandHint = new TextComponent("        채팅에 /수락 또는 /거절을 입력하세요.");
        commandHint.setColor(net.md_5.bungee.api.ChatColor.GRAY);
        target.spigot().sendMessage(commandHint);

        TextComponent indent = new TextComponent("        ");

        TextComponent accept = new TextComponent("수락");
        accept.setBold(true);
        accept.setColor(net.md_5.bungee.api.ChatColor.GREEN);
        accept.setClickEvent(new ClickEvent(ClickEvent.Action.RUN_COMMAND, "/tpaccept __spawnpoint_chat"));
        accept.setHoverEvent(hoverText("클릭해서 수락"));

        TextComponent spacing = new TextComponent("      ");

        TextComponent deny = new TextComponent("거절");
        deny.setBold(true);
        deny.setColor(net.md_5.bungee.api.ChatColor.RED);
        deny.setClickEvent(new ClickEvent(ClickEvent.Action.RUN_COMMAND, "/tpdeny __spawnpoint_chat"));
        deny.setHoverEvent(hoverText("클릭해서 거절"));

        target.spigot().sendMessage(indent, accept, spacing, deny);
    }

    private static HoverEvent hoverText(String text) {
        return new HoverEvent(HoverEvent.Action.SHOW_TEXT, TextComponent.fromLegacyText(text));
    }

    private boolean handleTpaResponse(CommandSender sender, String[] args, boolean accept) {
        boolean chatButton = args.length == 1 && "__spawnpoint_chat".equals(args[0]);
        if (!chatButton && args.length != 0) return false;
        if (!(sender instanceof Player target)) {
            sender.sendMessage("플레이어만 사용할 수 있어요.");
            return true;
        }
        try {
            if (!tpaEnabled) {
                target.sendMessage("TPA가 꺼져 있어요.");
                return true;
            }
            UUID targetId = target.getUniqueId();
            TeleportRequest request = teleportRequests.get(targetId);
            if (request == null) {
                target.sendMessage("받은 TPA 요청이 없어요.");
                return true;
            }
            if (expireTeleportRequest(targetId, request)) return true;
            teleportRequests.remove(targetId, request);
            cancelTeleportExpiration(targetId);

            Player requester = getServer().getPlayer(request.requesterId);
            if (requester == null) {
                target.sendMessage("요청한 플레이어가 접속 중이 아니에요.");
                return true;
            }
            if (!accept) {
                sendTeleportResponse(target, "거절했습니다");
                requester.sendMessage(playerLabel(target) + "님이 TPA 요청을 거절했어요.");
                return true;
            }
            if (!requester.teleport(target)) {
                target.sendMessage("지금은 순간이동할 수 없어요.");
                requester.sendMessage("지금은 순간이동할 수 없어요.");
                return true;
            }
            sendTeleportResponse(target, "수락했습니다");
            requester.sendMessage(playerLabel(target) + "님에게 순간이동했어요.");
            return true;
        } finally {
            if (chatButton) closeChat(target);
        }
    }

    private static void sendTeleportResponse(Player target, String text) {
        TextComponent indent = new TextComponent("        ");
        TextComponent response = new TextComponent(text);
        response.setColor(net.md_5.bungee.api.ChatColor.GRAY);
        response.setItalic(true);
        target.spigot().sendMessage(indent, response);
    }

    private void closeChat(Player player) {
        getServer().getScheduler().runTask(this, () -> {
            if (player.isOnline()) player.closeInventory();
        });
    }

    private static String playerLabel(Player player) {
        String displayName = resolvedPlayerName(player);
        return displayName == null ? "플레이어" : displayName;
    }

    private PlayerLookup findOnlinePlayer(Player requester, String name) {
        for (Player candidate : getServer().getOnlinePlayers()) {
            if (candidate.getName().equalsIgnoreCase(name) && requester.canSee(candidate)) {
                return new PlayerLookup(candidate, false);
            }
        }
        Player displayNameMatch = null;
        for (Player candidate : getServer().getOnlinePlayers()) {
            if (!requester.canSee(candidate) || !candidate.getDisplayName().equals(name)) continue;
            if (displayNameMatch != null) return new PlayerLookup(null, true);
            displayNameMatch = candidate;
        }
        return new PlayerLookup(displayNameMatch, false);
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onPlayerCommand(PlayerCommandPreprocessEvent event) {
        if (isQuietSpectator(event.getPlayer())) { event.setCancelled(true); return; }
        String command = event.getMessage().trim().split("\\s+", 2)[0].toLowerCase(Locale.ROOT);
        if (command.equals("/list") || command.equals("/minecraft:list") || command.equals("/bukkit:list")) {
            event.setCancelled(true);
            List<String> names = getServer().getOnlinePlayers().stream()
                .filter(player -> !isQuietSpectator(player) && event.getPlayer().canSee(player))
                .map(SpawnpointBridgePlugin::playerLabel).sorted().toList();
            event.getPlayer().sendMessage("접속 중인 플레이어: " + names.size() + "명 / " + getServer().getMaxPlayers() + "명");
            if (!names.isEmpty()) event.getPlayer().sendMessage(String.join(", ", names));
            return;
        }
        Map<String, CommandTargetName> targetsByTechnicalName = new HashMap<>();
        for (CommandTargetName target : commandTargets) {
            targetsByTechnicalName.put(target.technicalName.toLowerCase(Locale.ROOT), target);
        }
        for (Player candidate : getServer().getOnlinePlayers()) {
            String technicalKey = candidate.getName().toLowerCase(Locale.ROOT);
            if (!event.getPlayer().canSee(candidate)) {
                targetsByTechnicalName.remove(technicalKey);
                continue;
            }
            String displayName = resolvedPlayerName(candidate);
            if (displayName == null) continue;
            targetsByTechnicalName.put(technicalKey, new CommandTargetName(displayName, candidate.getName()));
        }
        List<CommandTargetName> targets = new ArrayList<>(targetsByTechnicalName.values());
        CommandRewrite rewrite = rewriteDisplayNameCommand(event.getMessage(), targets);
        if (rewrite.ambiguousDisplayName) {
            event.setCancelled(true);
            event.getPlayer().sendMessage("같은 이름을 쓰는 플레이어가 여러 명이에요. 관리자에게 알려주세요.");
        } else if (!rewrite.message.equals(event.getMessage())) {
            event.setMessage(rewrite.message);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerWhisperCommand(PlayerCommandPreprocessEvent event) {
        recordWhisperHistory(event.getPlayer(), event.getMessage());
    }

    private void refreshCommandTargets() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) URI.create(portalOrigin + "/api/internal/game-identities").toURL().openConnection();
            connection.setConnectTimeout(2_000);
            connection.setReadTimeout(2_000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Authorization", "Bearer " + new String(secret, StandardCharsets.UTF_8));
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IOException("portal returned " + connection.getResponseCode());
            }
            byte[] response;
            try (InputStream input = connection.getInputStream()) {
                response = input.readNBytes(MAX_RESPONSE_BYTES + 1);
            }
            if (response.length > MAX_RESPONSE_BYTES) throw new IOException("portal response is too large");
            JsonObject body = new JsonParser().parse(new String(response, StandardCharsets.UTF_8)).getAsJsonObject();
            JsonArray identities = body.getAsJsonArray("identities");
            if (identities == null) throw new JsonParseException("identities are missing");
            List<CommandTargetName> refreshed = new ArrayList<>();
            for (JsonElement element : identities) {
                if (!element.isJsonObject()) continue;
                JsonObject identity = element.getAsJsonObject();
                String displayName = string(identity, "displayName");
                String gameUsername = string(identity, "gameUsername");
                if (!isSafeDisplayName(displayName) || gameUsername == null || !gameUsername.matches("[A-Za-z0-9_]{3,16}")) continue;
                refreshed.add(new CommandTargetName(displayName, gameUsername));
            }
            commandTargets = List.copyOf(refreshed);
            commandIdentityWarningLogged = false;
        } catch (IOException | IllegalArgumentException | IllegalStateException | JsonParseException exception) {
            if (!commandIdentityWarningLogged) {
                commandIdentityWarningLogged = true;
                getLogger().warning("Could not refresh command names; keeping the previous cache: " + exception.getMessage());
            }
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void recordPlayerHistory(String type, Player player, String message) {
        recordPlayerHistory(type, player, message, null);
    }

    private void recordPlayerHistory(String type, Player player, String message, Player recipient) {
        PlayerIdentity identity = activeIdentities.get(player.getUniqueId());
        JsonObject event = new JsonObject();
        event.addProperty("eventId", UUID.randomUUID().toString());
        event.addProperty("type", type);
        event.addProperty("occurredAt", System.currentTimeMillis());
        event.addProperty("accountId", identity == null ? null : identity.accountId);
        event.addProperty("uuid", player.getUniqueId().toString());
        event.addProperty("gameUsername", player.getName());
        event.addProperty("displayName", identity == null ? player.getName() : identity.displayName);
        if (message != null) event.addProperty("message", message);
        if (recipient != null) {
            PlayerIdentity recipientIdentity = activeIdentities.get(recipient.getUniqueId());
            event.addProperty("recipientUuid", recipient.getUniqueId().toString());
            event.addProperty("recipientGameUsername", recipient.getName());
            event.addProperty(
                "recipientDisplayName",
                recipientIdentity == null ? playerLabel(recipient) : recipientIdentity.displayName
            );
        }
        byte[] body = event.toString().getBytes(StandardCharsets.UTF_8);
        if (body.length > MAX_REQUEST_BYTES) return;
        ExecutorService executor = historyExecutor;
        if (executor == null || executor.isShutdown()) return;
        try {
            executor.execute(() -> postPlayerHistory(body));
        } catch (RejectedExecutionException exception) {
            warnHistoryFailure("history queue is full; one event was skipped");
        }
    }

    private void recordWhisperHistory(Player sender, String commandMessage) {
        WhisperCommand whisper = parseWhisperCommand(commandMessage);
        if (whisper == null) return;
        Player recipient = null;
        for (Player candidate : getServer().getOnlinePlayers()) {
            if (candidate.getName().equalsIgnoreCase(whisper.target) && sender.canSee(candidate)) {
                recipient = candidate;
                break;
            }
        }
        if (recipient != null) recordPlayerHistory("whisper", sender, whisper.message, recipient);
    }

    private void postPlayerHistory(byte[] body) {
        IOException lastFailure = null;
        for (int attempt = 0; attempt < 3; attempt++) {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) URI.create(portalOrigin + "/api/internal/player-history").toURL().openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(2_000);
                connection.setReadTimeout(2_000);
                connection.setUseCaches(false);
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                connection.setRequestProperty("Authorization", "Bearer " + new String(secret, StandardCharsets.UTF_8));
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                try (var output = connection.getOutputStream()) {
                    output.write(body);
                }
                int status = connection.getResponseCode();
                if (status == HttpURLConnection.HTTP_NO_CONTENT) {
                    historyEventWarningLogged = false;
                    return;
                }
                lastFailure = new IOException("portal returned " + status);
            } catch (IOException | IllegalArgumentException exception) {
                lastFailure = exception instanceof IOException
                    ? (IOException) exception
                    : new IOException(exception.getMessage(), exception);
            } finally {
                if (connection != null) connection.disconnect();
            }
            if (attempt < 2) {
                try {
                    Thread.sleep(100L * (attempt + 1));
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
        warnHistoryFailure(lastFailure == null ? "unknown error" : lastFailure.getMessage());
    }

    private void warnHistoryFailure(String reason) {
        if (historyEventWarningLogged) return;
        historyEventWarningLogged = true;
        getLogger().warning("Could not persist a player history event: " + reason);
    }

    static CommandRewrite rewriteDisplayNameCommand(String message, List<CommandTargetName> targets) {
        List<CommandSpan> spans = commandSpans(message);
        if (spans.isEmpty()) return new CommandRewrite(message, false);
        String command = spanValue(message, spans.get(0));
        if (!command.startsWith("/")) return new CommandRewrite(message, false);
        command = command.substring(1);
        int namespaceSeparator = command.lastIndexOf(':');
        if (namespaceSeparator >= 0) command = command.substring(namespaceSeparator + 1);
        command = command.toLowerCase(Locale.ROOT);

        return switch (command) {
            case "tell", "msg", "w", "whisper", "message", "pm", "dm",
                "kick", "ban", "pardon", "op", "deop", "kill", "give", "clear",
                "effect", "enchant", "spawnpoint", "tellraw", "testfor", "title",
                "execute", "entitydata", "stopsound" -> rewriteCommandTargets(message, targets, 0);
            case "tp", "teleport", "spectate" -> rewriteCommandTargets(message, targets, 0, 1);
            case "gamemode", "xp", "advancement", "recipe" -> rewriteCommandTargets(message, targets, 1);
            case "playsound", "achievement" -> rewriteCommandTargets(message, targets, 2);
            case "replaceitem", "stats" -> "entity".equalsIgnoreCase(commandArgument(message, 0))
                ? rewriteCommandTargets(message, targets, 1)
                : new CommandRewrite(message, false);
            case "scoreboard" -> rewriteScoreboardTargets(message, targets);
            default -> new CommandRewrite(message, false);
        };
    }

    static WhisperCommand parseWhisperCommand(String message) {
        List<CommandSpan> spans = commandSpans(message);
        if (spans.size() < 3) return null;
        String command = spanValue(message, spans.get(0));
        if (!command.startsWith("/")) return null;
        command = command.substring(1);
        int namespaceSeparator = command.lastIndexOf(':');
        if (namespaceSeparator >= 0) command = command.substring(namespaceSeparator + 1);
        if (!WHISPER_COMMANDS.contains(command.toLowerCase(Locale.ROOT))) return null;
        String target = spanValue(message, spans.get(1));
        if (target.startsWith("@")) return null;
        String whisperMessage = message.substring(spans.get(2).start).trim();
        if (target.isEmpty() || whisperMessage.isEmpty()) return null;
        return new WhisperCommand(target, whisperMessage);
    }

    private static CommandRewrite rewriteScoreboardTargets(String message, List<CommandTargetName> targets) {
        if (!"players".equalsIgnoreCase(commandArgument(message, 0))) {
            return new CommandRewrite(message, false);
        }
        if ("operation".equalsIgnoreCase(commandArgument(message, 1))) {
            return rewriteCommandTargets(message, targets, 2, 5);
        }
        return rewriteCommandTargets(message, targets, 2);
    }

    private static CommandRewrite rewriteCommandTargets(
        String message,
        List<CommandTargetName> targets,
        int... argumentIndexes
    ) {
        String rewritten = message;
        for (int argumentIndex : argumentIndexes) {
            TargetRewrite targetRewrite = rewriteCommandTarget(rewritten, targets, argumentIndex);
            if (targetRewrite.ambiguousDisplayName) return new CommandRewrite(message, true);
            rewritten = targetRewrite.message;
        }
        return new CommandRewrite(rewritten, false);
    }

    private static TargetRewrite rewriteCommandTarget(
        String message,
        List<CommandTargetName> targets,
        int argumentIndex
    ) {
        List<CommandSpan> spans = commandSpans(message);
        int spanIndex = argumentIndex + 1;
        if (spanIndex >= spans.size()) return new TargetRewrite(message, false);
        CommandSpan targetSpan = spans.get(spanIndex);
        String token = spanValue(message, targetSpan);
        if (token.startsWith("@")) return new TargetRewrite(message, false);
        for (CommandTargetName target : targets) {
            if (target.technicalName.equalsIgnoreCase(token)) return new TargetRewrite(message, false);
        }

        CommandTargetName bestTarget = null;
        int bestEnd = -1;
        boolean ambiguous = false;
        for (CommandTargetName target : targets) {
            int matchEnd = displayNameMatchEnd(message, targetSpan.start, target.displayName);
            if (matchEnd < 0) continue;
            if (matchEnd > bestEnd) {
                bestTarget = target;
                bestEnd = matchEnd;
                ambiguous = false;
            } else if (matchEnd == bestEnd && bestTarget != null
                && !bestTarget.technicalName.equalsIgnoreCase(target.technicalName)) {
                ambiguous = true;
            }
        }
        if (bestTarget == null) return new TargetRewrite(message, false);
        if (ambiguous) return new TargetRewrite(message, true);
        return new TargetRewrite(
            message.substring(0, targetSpan.start) + bestTarget.technicalName + message.substring(bestEnd),
            false
        );
    }

    private static int displayNameMatchEnd(String message, int start, String displayName) {
        String normalizedDisplayName = Normalizer.normalize(displayName, Normalizer.Form.NFC);
        if (start < message.length() && message.charAt(start) == '"') {
            int closingQuote = message.indexOf('"', start + 1);
            if (closingQuote < 0) return -1;
            String candidate = Normalizer.normalize(message.substring(start + 1, closingQuote), Normalizer.Form.NFC);
            if (!candidate.equalsIgnoreCase(normalizedDisplayName)) return -1;
            int end = closingQuote + 1;
            return end == message.length() || Character.isWhitespace(message.charAt(end)) ? end : -1;
        }

        int limit = Math.min(message.length(), start + Math.max(64, displayName.length() * 3));
        for (int end = start + 1; end <= limit; end++) {
            if (end < message.length() && !Character.isWhitespace(message.charAt(end))) continue;
            String candidate = Normalizer.normalize(message.substring(start, end), Normalizer.Form.NFC);
            if (candidate.equalsIgnoreCase(normalizedDisplayName)) return end;
        }
        return -1;
    }

    private static String commandArgument(String message, int argumentIndex) {
        List<CommandSpan> spans = commandSpans(message);
        int spanIndex = argumentIndex + 1;
        return spanIndex < spans.size() ? spanValue(message, spans.get(spanIndex)) : "";
    }

    private static List<CommandSpan> commandSpans(String message) {
        List<CommandSpan> spans = new ArrayList<>();
        int cursor = 0;
        while (cursor < message.length()) {
            while (cursor < message.length() && Character.isWhitespace(message.charAt(cursor))) cursor++;
            if (cursor >= message.length()) break;
            int start = cursor;
            if (message.charAt(cursor) == '"') {
                cursor++;
                while (cursor < message.length() && message.charAt(cursor) != '"') cursor++;
                if (cursor < message.length()) cursor++;
            } else {
                while (cursor < message.length() && !Character.isWhitespace(message.charAt(cursor))) cursor++;
            }
            spans.add(new CommandSpan(start, cursor));
        }
        return spans;
    }

    private static String spanValue(String message, CommandSpan span) {
        String value = message.substring(span.start, span.end);
        return value.length() >= 2 && value.charAt(0) == '"' && value.charAt(value.length() - 1) == '"'
            ? value.substring(1, value.length() - 1)
            : value;
    }

    private void scheduleTeleportExpiration(TeleportRequest request) {
        scheduleTeleportExpiration(request, TPA_REQUEST_TICKS);
    }

    private void scheduleTeleportExpiration(TeleportRequest request, long delayTicks) {
        BukkitTask task = getServer().getScheduler().runTaskLater(this, () -> {
            if (teleportRequests.get(request.targetId) != request) return;
            long remainingMillis = request.expiresAt - System.currentTimeMillis();
            if (remainingMillis > 0L) {
                scheduleTeleportExpiration(request, Math.max(1L, (remainingMillis + 49L) / 50L));
                return;
            }
            expireTeleportRequest(request.targetId, request);
        }, delayTicks);
        teleportExpiryTasks.put(request.targetId, task);
    }

    private boolean expireTeleportRequest(UUID targetId, TeleportRequest request) {
        if (teleportRequests.get(targetId) != request || request.expiresAt > System.currentTimeMillis()) return false;
        teleportRequests.remove(targetId, request);
        cancelTeleportExpiration(targetId);
        Player requester = getServer().getPlayer(request.requesterId);
        Player target = getServer().getPlayer(targetId);
        if (requester != null) requester.sendMessage("보낸 TPA 요청이 만료됐어요.");
        if (target != null) target.sendMessage("받은 TPA 요청이 만료됐어요.");
        return true;
    }

    private JsonObject snapshotSettings() {
        JsonObject result = new JsonObject();
        result.addProperty("tpaEnabled", tpaEnabled);
        result.addProperty("keepInventory", keepInventory);
        return result;
    }

    private JsonObject setTpaEnabled(boolean enabled) {
        boolean previous = this.tpaEnabled;
        getConfig().set("tpa-enabled", enabled);
        try {
            savePluginConfig();
        } catch (IOException exception) {
            getConfig().set("tpa-enabled", previous);
            throw new IllegalStateException("Could not save the TPA setting: " + exception.getMessage(), exception);
        }
        this.tpaEnabled = enabled;
        if (!enabled) cancelAllTeleportRequests();
        return snapshotSettings();
    }

    private JsonObject setKeepInventory(boolean enabled) {
        boolean previous = this.keepInventory;
        getConfig().set("keep-inventory", enabled);
        try {
            savePluginConfig();
        } catch (IOException exception) {
            getConfig().set("keep-inventory", previous);
            throw new IllegalStateException("Could not save the keep-inventory setting: " + exception.getMessage(), exception);
        }
        this.keepInventory = enabled;
        applyKeepInventory(enabled);
        return snapshotSettings();
    }

    private void savePluginConfig() throws IOException {
        getConfig().save(new File(getDataFolder(), "config.yml"));
    }

    private void cancelAllTeleportRequests() {
        teleportRequestCooldowns.clear();
        if (teleportRequests.isEmpty()) return;
        Map<UUID, TeleportRequest> cancelled = new HashMap<>(teleportRequests);
        teleportRequests.clear();
        teleportExpiryTasks.values().forEach(BukkitTask::cancel);
        teleportExpiryTasks.clear();
        Set<UUID> notified = new HashSet<>();
        for (Map.Entry<UUID, TeleportRequest> entry : cancelled.entrySet()) {
            notified.add(entry.getValue().requesterId);
            notified.add(entry.getKey());
        }
        for (UUID playerId : notified) {
            Player player = getServer().getPlayer(playerId);
            if (player != null) player.sendMessage("TPA가 꺼져 요청이 취소됐어요.");
        }
    }

    private void removeTeleportRequestsFor(Player player) {
        UUID playerId = player.getUniqueId();
        teleportRequestCooldowns.remove(playerId);
        Iterator<Map.Entry<UUID, TeleportRequest>> iterator = teleportRequests.entrySet().iterator();
        while (iterator.hasNext()) {
            Map.Entry<UUID, TeleportRequest> entry = iterator.next();
            TeleportRequest request = entry.getValue();
            if (!entry.getKey().equals(playerId) && !request.requesterId.equals(playerId)) continue;
            iterator.remove();
            cancelTeleportExpiration(entry.getKey());
            UUID otherId = entry.getKey().equals(playerId) ? request.requesterId : entry.getKey();
            Player other = getServer().getPlayer(otherId);
            if (other != null) other.sendMessage("상대방이 나가 TPA 요청이 취소됐어요.");
        }
    }

    private void cancelTeleportExpiration(UUID targetId) {
        BukkitTask task = teleportExpiryTasks.remove(targetId);
        if (task != null) task.cancel();
    }

    private void startBridgeServer() {
        int port = integerEnv("SPAWNPOINT_BRIDGE_PORT", DEFAULT_BRIDGE_PORT, 1, 65_535);
        try {
            bridgeServer = HttpServer.create(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 0);
            bridgeExecutor = Executors.newFixedThreadPool(2, new BridgeThreadFactory());
            bridgeServer.setExecutor(bridgeExecutor);
            bridgeServer.createContext("/v1/", this::handleBridgeRequest);
            bridgeServer.start();
            getLogger().info("Admin bridge listening on 127.0.0.1:" + port + ".");
        } catch (IOException | RuntimeException exception) {
            getLogger().severe("Could not start the loopback server bridge; disabling the plugin: " + exception.getMessage());
            if (bridgeServer != null) bridgeServer.stop(0);
            bridgeServer = null;
            if (bridgeExecutor != null) bridgeExecutor.shutdownNow();
            bridgeExecutor = null;
            getServer().getPluginManager().disablePlugin(this);
        }
    }

    private void handleBridgeRequest(HttpExchange exchange) throws IOException {
        try {
            if (!isAuthorized(exchange)) {
                sendError(exchange, 401, "unauthorized");
                return;
            }
            String method = exchange.getRequestMethod();
            String path = exchange.getRequestURI().getRawPath();
            if ("POST".equals(method) && "/v1/identity".equals(path)) {
                JsonObject request = parseRequestObject(exchange);
                Ticket ticket = verifyPath("/gateway?ticket=" + string(request, "ticket"));
                if (ticket == null) { sendError(exchange, 401, "invalid_ticket"); return; }
                pendingIdentities.put(ticket.username.toLowerCase(Locale.ROOT),
                    new PlayerIdentity(ticket.accountId, ticket.displayName, ticket.skinPath, ticket.spectator, ticket.operatorUsername));
                JsonObject result = new JsonObject(); result.addProperty("ok", true);
                sendJson(exchange, 200, result); return;
            }

            if ("GET".equals(method) && "/v1/health".equals(path)) {
                JsonObject body = onMainThread(() -> {
                    JsonObject health = new JsonObject();
                    health.addProperty("ok", true);
                    health.addProperty("onlinePlayers", getServer().getOnlinePlayers().stream().filter(player -> !isQuietSpectator(player)).count());
                    return health;
                });
                sendJson(exchange, 200, body);
                return;
            }
            if ("GET".equals(method) && "/v1/players".equals(path)) {
                sendJson(exchange, 200, onMainThread(this::snapshotPlayers));
                return;
            }
            if ("GET".equals(method) && "/v1/locators".equals(path)) {
                JsonObject root = new JsonObject();
                JsonObject snapshots = new JsonObject();
                locatorSnapshots.forEach(snapshots::add);
                root.add("snapshots", snapshots);
                sendJson(exchange, 200, root);
                return;
            }
            if ("GET".equals(method) && path.startsWith("/v1/terrain/")) {
                String[] parts = path.substring("/v1/terrain/".length()).split("/");
                if (parts.length != 2 || !parts[0].matches("[0-9a-f-]{36}") || !parts[1].matches("[0-9]{1,6}")) {
                    sendError(exchange, 400, "invalid_request"); return;
                }
                sendJson(exchange, 200, onMainThread(() -> snapshotTerrain(parts[0], Integer.parseInt(parts[1]))));
                return;
            }
            if ("GET".equals(method) && "/v1/settings".equals(path)) {
                sendJson(exchange, 200, onMainThread(this::snapshotSettings));
                return;
            }
            if ("PUT".equals(method) && "/v1/settings/tpa".equals(path)) {
                JsonObject request = parseRequestObject(exchange);
                if (request == null || request.entrySet().size() != 1 || !request.has("enabled")
                    || !request.get("enabled").isJsonPrimitive()
                    || !request.getAsJsonPrimitive("enabled").isBoolean()) {
                    sendError(exchange, 400, "invalid_request");
                    return;
                }
                boolean enabled = request.get("enabled").getAsBoolean();
                sendJson(exchange, 200, onMainThread(() -> setTpaEnabled(enabled)));
                return;
            }
            if ("PUT".equals(method) && "/v1/settings/keep-inventory".equals(path)) {
                JsonObject request = parseRequestObject(exchange);
                if (request == null || request.entrySet().size() != 1 || !request.has("enabled")
                    || !request.get("enabled").isJsonPrimitive()
                    || !request.getAsJsonPrimitive("enabled").isBoolean()) {
                    sendError(exchange, 400, "invalid_request");
                    return;
                }
                boolean enabled = request.get("enabled").getAsBoolean();
                sendJson(exchange, 200, onMainThread(() -> setKeepInventory(enabled)));
                return;
            }
            if ("POST".equals(method) && "/v1/titles".equals(path)) {
                JsonObject request = parseRequestObject(exchange);
                if (request == null || request.entrySet().size() != 5
                    || !request.has("title") || !request.get("title").isJsonPrimitive()
                    || !request.getAsJsonPrimitive("title").isString()
                    || !request.has("subtitle") || !request.get("subtitle").isJsonPrimitive()
                    || !request.getAsJsonPrimitive("subtitle").isString()
                    || !request.has("color") || !request.get("color").isJsonPrimitive()
                    || !request.getAsJsonPrimitive("color").isString()
                    || !request.has("audience") || !request.get("audience").isJsonPrimitive()
                    || !request.getAsJsonPrimitive("audience").isString()
                    || !request.has("targets") || !request.get("targets").isJsonArray()) {
                    sendError(exchange, 400, "invalid_request");
                    return;
                }
                String title = request.get("title").getAsString().trim();
                String subtitle = request.get("subtitle").getAsString().trim();
                String color = request.get("color").getAsString().toLowerCase(Locale.ROOT);
                String audience = request.get("audience").getAsString();
                if (!isSafeTitleText(title, 64) || !isSafeTitleText(subtitle, 128)
                    || (title.isEmpty() && subtitle.isEmpty()) || !TITLE_COLORS.contains(color)
                    || !("all".equals(audience) || "selected".equals(audience))) {
                    sendError(exchange, 400, "invalid_request");
                    return;
                }
                JsonArray targetValues = request.getAsJsonArray("targets");
                if (targetValues.size() > 100 || ("selected".equals(audience) && targetValues.size() == 0)) {
                    sendError(exchange, 400, "invalid_request");
                    return;
                }
                List<String> targets = new ArrayList<>();
                for (JsonElement value : targetValues) {
                    if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
                        sendError(exchange, 400, "invalid_request");
                        return;
                    }
                    String target = value.getAsString();
                    if (!PLAYER_KEY.matcher(target).matches()) {
                        sendError(exchange, 400, "invalid_request");
                        return;
                    }
                    if (!targets.contains(target)) targets.add(target);
                }
                sendJson(exchange, 200, onMainThread(() -> showTitle(audience, targets, title, subtitle, color)));
                return;
            }
            String chatPrefix = "/v1/chat/";
            if ("POST".equals(method) && path.startsWith(chatPrefix)) {
                String encodedAccountId = path.substring(chatPrefix.length());
                if (encodedAccountId.isEmpty() || encodedAccountId.contains("/")) {
                    sendError(exchange, 400, "invalid_account");
                    return;
                }
                String accountId = URLDecoder.decode(encodedAccountId, StandardCharsets.UTF_8);
                UUID.fromString(accountId);
                JsonObject request = parseRequestObject(exchange);
                if (request == null || request.entrySet().size() != 1 || !request.has("message")
                    || !request.get("message").isJsonPrimitive()
                    || !request.getAsJsonPrimitive("message").isString()) {
                    sendError(exchange, 400, "invalid_request");
                    return;
                }
                String message = request.get("message").getAsString().trim();
                if (message.isEmpty() || message.length() > 256 || message.indexOf('\r') >= 0
                    || message.indexOf('\n') >= 0 || message.indexOf('\0') >= 0 || "/".equals(message)) {
                    sendError(exchange, 400, "invalid_message");
                    return;
                }
                JsonObject result = onMainThread(() -> sendPlayerChat(accountId, message));
                if (result == null) {
                    sendError(exchange, 404, "player_not_found");
                    return;
                }
                sendJson(exchange, 200, result);
                return;
            }
            String prefix = "/v1/players/";
            String stateSuffix = "/state";
            if ("PATCH".equals(method) && path.startsWith(prefix) && path.endsWith(stateSuffix)) {
                String playerKey = playerKeyFromPath(path, prefix, stateSuffix);
                JsonObject request = parseRequestObject(exchange);
                if (playerKey == null || request == null || request.entrySet().isEmpty()) {
                    sendError(exchange, 400, "invalid_request");
                    return;
                }
                JsonObject result = onMainThread(() -> updatePlayerState(playerKey, request));
                if (result == null) {
                    sendError(exchange, 404, "player_not_found");
                    return;
                }
                sendJson(exchange, 200, result);
                return;
            }
            String inventorySuffix = "/inventory";
            if ("PUT".equals(method) && path.startsWith(prefix) && path.endsWith(inventorySuffix)) {
                String playerKey = playerKeyFromPath(path, prefix, inventorySuffix);
                JsonObject request = parseRequestObject(exchange);
                if (playerKey == null || request == null) {
                    sendError(exchange, 400, "invalid_request");
                    return;
                }
                JsonObject result = onMainThread(() -> updatePlayerInventory(playerKey, request));
                if (result == null) {
                    sendError(exchange, 404, "player_not_found");
                    return;
                }
                sendJson(exchange, 200, result);
                return;
            }
            String kickSuffix = "/kick";
            if ("POST".equals(method) && path.startsWith(prefix) && path.endsWith(kickSuffix)) {
                String playerKey = playerKeyFromPath(path, prefix, kickSuffix);
                JsonObject request = parseRequestObject(exchange);
                if (playerKey == null || request == null || request.entrySet().size() != 1
                    || !request.has("reason") || !request.get("reason").isJsonPrimitive()
                    || !request.getAsJsonPrimitive("reason").isString()) {
                    sendError(exchange, 400, "invalid_request");
                    return;
                }
                String reason = request.get("reason").getAsString().trim();
                if (!isSafeReason(reason)) {
                    sendError(exchange, 400, "invalid_request");
                    return;
                }
                JsonObject result = onMainThread(() -> kickPlayer(playerKey, reason));
                if (result == null) {
                    sendError(exchange, 404, "player_not_found");
                    return;
                }
                sendJson(exchange, 200, result);
                return;
            }
            String banSuffix = "/ban";
            if ("PUT".equals(method) && path.startsWith(prefix) && path.endsWith(banSuffix)) {
                String playerKey = playerKeyFromPath(path, prefix, banSuffix);
                JsonObject request = parseRequestObject(exchange);
                if (playerKey == null || request == null || !request.has("banned")
                    || !request.get("banned").isJsonPrimitive()
                    || !request.getAsJsonPrimitive("banned").isBoolean()) {
                    sendError(exchange, 400, "invalid_request");
                    return;
                }
                String reason = request.has("reason") && request.get("reason").isJsonPrimitive()
                    && request.getAsJsonPrimitive("reason").isString()
                    ? request.get("reason").getAsString().trim()
                    : "관리자가 차단했습니다.";
                if (!isSafeReason(reason)) {
                    sendError(exchange, 400, "invalid_request");
                    return;
                }
                boolean banned = request.get("banned").getAsBoolean();
                JsonObject result = onMainThread(() -> setPlayerBanned(playerKey, banned, reason));
                if (result == null) {
                    sendError(exchange, 404, "player_not_found");
                    return;
                }
                sendJson(exchange, 200, result);
                return;
            }
            String operatorSuffix = "/operator";
            if ("PUT".equals(method) && path.startsWith(prefix) && path.endsWith(operatorSuffix)) {
                String encodedPlayer = path.substring(prefix.length(), path.length() - operatorSuffix.length());
                if (encodedPlayer.isEmpty() || encodedPlayer.contains("/")) {
                    sendError(exchange, 400, "invalid_player");
                    return;
                }
                String playerKey = URLDecoder.decode(encodedPlayer, StandardCharsets.UTF_8);
                JsonObject request = parseRequestObject(exchange);
                if (request == null || !request.has("operator") || !request.get("operator").isJsonPrimitive()
                    || !request.getAsJsonPrimitive("operator").isBoolean()) {
                    sendError(exchange, 400, "invalid_request");
                    return;
                }
                boolean operator = request.get("operator").getAsBoolean();
                JsonObject result = onMainThread(() -> setOperator(playerKey, operator));
                if (result == null) {
                    sendError(exchange, 404, "player_not_found");
                    return;
                }
                sendJson(exchange, 200, result);
                return;
            }
            String disconnectSuffix = "/disconnect";
            if ("POST".equals(method) && path.startsWith(prefix) && path.endsWith(disconnectSuffix)) {
                String encodedPlayer = path.substring(prefix.length(), path.length() - disconnectSuffix.length());
                if (encodedPlayer.isEmpty() || encodedPlayer.contains("/")) {
                    sendError(exchange, 400, "invalid_player");
                    return;
                }
                String playerKey = URLDecoder.decode(encodedPlayer, StandardCharsets.UTF_8);
                JsonObject result = onMainThread(() -> disconnectPlayer(playerKey));
                if (result == null) {
                    sendError(exchange, 404, "player_not_found");
                    return;
                }
                sendJson(exchange, 200, result);
                return;
            }
            sendError(exchange, 404, "not_found");
        } catch (RequestTooLargeException exception) {
            sendError(exchange, 413, "request_too_large");
        } catch (TimeoutException exception) {
            sendError(exchange, 503, "server_busy");
        } catch (IllegalArgumentException | IllegalStateException exception) {
            sendError(exchange, 400, "invalid_request");
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            sendError(exchange, 503, "server_busy");
        } catch (ExecutionException exception) {
            getLogger().warning("Admin bridge request failed: " + exception.getCause());
            sendError(exchange, 500, "internal_error");
        } catch (RuntimeException exception) {
            getLogger().warning("Admin bridge request failed: " + exception.getMessage());
            sendError(exchange, 500, "internal_error");
        } finally {
            exchange.close();
        }
    }

    private boolean isAuthorized(HttpExchange exchange) {
        String header = exchange.getRequestHeaders().getFirst("Authorization");
        if (header == null || !header.startsWith("Bearer ")) return false;
        byte[] supplied = header.substring("Bearer ".length()).getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(secret, supplied);
    }

    private JsonObject parseRequestObject(HttpExchange exchange) throws IOException, RequestTooLargeException {
        byte[] bytes;
        try (InputStream input = exchange.getRequestBody()) {
            bytes = input.readNBytes(MAX_REQUEST_BYTES + 1);
        }
        if (bytes.length > MAX_REQUEST_BYTES) throw new RequestTooLargeException();
        try {
            JsonElement value = new JsonParser().parse(new String(bytes, StandardCharsets.UTF_8));
            return value.isJsonObject() ? value.getAsJsonObject() : null;
        } catch (JsonParseException | IllegalStateException exception) {
            return null;
        }
    }

    private String playerKeyFromPath(String path, String prefix, String suffix) {
        String encodedPlayer = path.substring(prefix.length(), path.length() - suffix.length());
        if (encodedPlayer.isEmpty() || encodedPlayer.contains("/")) return null;
        String playerKey = URLDecoder.decode(encodedPlayer, StandardCharsets.UTF_8);
        return PLAYER_KEY.matcher(playerKey).matches() ? playerKey : null;
    }

    private static boolean isSafeReason(String reason) {
        return !reason.isEmpty() && reason.length() <= 160
            && reason.indexOf('\r') < 0 && reason.indexOf('\n') < 0 && reason.indexOf('\0') < 0;
    }

    private <T> T onMainThread(Callable<T> callable)
        throws InterruptedException, ExecutionException, TimeoutException {
        Future<T> future = getServer().getScheduler().callSyncMethod(this, callable);
        try {
            return future.get(MAIN_THREAD_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        } catch (TimeoutException exception) {
            future.cancel(false);
            throw exception;
        }
    }

    private int terrainBudgetTick = -1;
    private long terrainBudgetUsed;

    private JsonObject snapshotTerrain(String accountId, int cursor) {
        long started = System.nanoTime();
        JsonObject result = new JsonObject();
        result.addProperty("active", false);
        Player player = resolvePlayer(accountId);
        if (player == null || player.getWorld().getEnvironment() != World.Environment.NORMAL) return result;
        World world = player.getWorld();
        Location position = player.getLocation();
        int cx = position.getBlockX() >> 4, cz = position.getBlockZ() >> 4;
        if (!world.isChunkLoaded(cx, cz)) return result;
        result.addProperty("active", position.getY() + 4 >= world.getHighestBlockYAt(position.getBlockX(), position.getBlockZ()));
        result.addProperty("world", world.getUID().toString());
        result.addProperty("x", position.getX()); result.addProperty("z", position.getZ());
        int tick = getServer().getCurrentTick();
        if (terrainBudgetTick != tick) { terrainBudgetTick = tick; terrainBudgetUsed = 0; }
        result.addProperty("cursor", cursor);
        if (terrainBudgetUsed >= 3_000_000L) return result;
        var chunks = java.util.Arrays.stream(world.getLoadedChunks())
            .filter(chunk -> Math.abs(chunk.getX() - cx) <= 32 && Math.abs(chunk.getZ() - cz) <= 32)
            .sorted(Comparator.comparingInt(org.bukkit.Chunk::getX).thenComparingInt(org.bukkit.Chunk::getZ)).toList();
        JsonArray tiles = new JsonArray();
        int visited = 0;
        long deadline = started + 3_000_000L - terrainBudgetUsed;
        while (visited < Math.min(32, chunks.size())) {
            var chunk = chunks.get((cursor + visited) % chunks.size());
            visited++;
            JsonObject tile = new JsonObject();
            tile.addProperty("x", chunk.getX()); tile.addProperty("z", chunk.getZ());
            JsonArray cells = new JsonArray();
            for (int z = 2; z < 16; z += 4) for (int x = 2; x < 16; x += 4) {
                int bx = chunk.getX() * 16 + x, bz = chunk.getZ() * 16 + z;
                int y = world.getHighestBlockYAt(bx, bz, org.bukkit.HeightMap.WORLD_SURFACE);
                cells.add(y + 1);
                cells.add(world.getBlockAt(bx, y, bz).getBlockData().getMapColor().asRGB());
            }
            tile.add("cells", cells); tiles.add(tile);
            if (System.nanoTime() >= deadline) break;
        }
        result.addProperty("cursor", chunks.isEmpty() ? 0 : (cursor + visited) % chunks.size());
        result.add("tiles", tiles);
        terrainBudgetUsed += System.nanoTime() - started;
        return result;
    }

    private JsonObject snapshotPlayers() {
        JsonObject root = new JsonObject();
        JsonArray players = new JsonArray();
        getServer().getOnlinePlayers().stream()
            .filter(player -> !isQuietSpectator(player))
            .sorted(Comparator.comparing(Player::getName, String.CASE_INSENSITIVE_ORDER))
            .map(this::snapshotPlayer)
            .forEach(players::add);
        root.add("players", players);
        return root;
    }

    private void refreshLocatorSnapshots() {
        // Capture each location once on the main thread, then share it across viewers.
        Map<Player, Location> locations = new LinkedHashMap<>();
        for (Player player : getServer().getOnlinePlayers()) locations.put(player, player.getLocation());
        Map<String, JsonObject> snapshots = new HashMap<>();
        for (Player viewer : locations.keySet()) {
            PlayerIdentity identity = activeIdentities.get(viewer.getUniqueId());
            if (identity != null) snapshots.put(identity.accountId, snapshotLocator(viewer, locations));
        }
        locatorSnapshots = Map.copyOf(snapshots);
    }

    private JsonObject snapshotLocator(Player viewer, Map<Player, Location> locations) {
        JsonObject root = new JsonObject();
        JsonArray targets = new JsonArray();
        root.addProperty("active", true);
        Location viewerLocation = locations.get(viewer);
        JsonObject clientState = new JsonObject();
        clientState.addProperty("x", viewerLocation.getX());
        clientState.addProperty("y", viewerLocation.getY() + viewer.getEyeHeight());
        clientState.addProperty("z", viewerLocation.getZ());
        clientState.addProperty("mainHand", viewer.getInventory().getItemInMainHand().getType().getKey().toString());
        clientState.addProperty("offHand", viewer.getInventory().getItemInOffHand().getType().getKey().toString());
        root.add("clientState", clientState);
        List<LocatorTarget> nearby = new ArrayList<>();
        for (Map.Entry<Player, Location> entry : locations.entrySet()) {
            Player other = entry.getKey();
            Location otherLocation = entry.getValue();
            if (other == viewer || !otherLocation.getWorld().equals(viewerLocation.getWorld()) || !viewer.canSee(other)) continue;
            double distanceSquared = otherLocation.distanceSquared(viewerLocation);
            if (distanceSquared <= LOCATOR_RANGE_SQUARED) {
                nearby.add(new LocatorTarget(other, otherLocation, distanceSquared));
            }
        }
        nearby.sort(Comparator.comparingDouble(LocatorTarget::distanceSquared));
        for (LocatorTarget target : nearby) {
            JsonObject value = new JsonObject();
            PlayerIdentity identity = activeIdentities.get(target.player.getUniqueId());
            value.addProperty("accountId", identity == null ? null : identity.accountId);
            value.addProperty("skinUrl", identity == null ? null : identity.skinPath);
            value.addProperty("uuid", target.player.getUniqueId().toString());
            value.addProperty("username", target.player.getName());
            value.addProperty("displayName", target.player.getDisplayName());
            value.addProperty("angle", relativeYaw(viewerLocation, target.location));
            value.addProperty("distance", Math.sqrt(target.distanceSquared));
            targets.add(value);
        }
        root.add("targets", targets);
        return root;
    }

    private JsonObject snapshotPlayer(Player player) {
        JsonObject result = new JsonObject();
        Location location = player.getLocation();
        result.addProperty("uuid", player.getUniqueId().toString());
        PlayerIdentity identity = activeIdentities.get(player.getUniqueId());
        result.addProperty("accountId", identity == null ? null : identity.accountId);
        result.addProperty("username", player.getName());
        result.addProperty("displayName", player.getDisplayName());
        result.addProperty("online", true);
        result.addProperty("dataAvailable", true);
        result.addProperty("firstSeenAt", player.getFirstPlayed());
        result.addProperty("lastSeenAt", System.currentTimeMillis());
        result.addProperty("playTimeTicks", player.getStatistic(Statistic.PLAY_ONE_MINUTE));
        result.addProperty("banned", getServer().getBanList(BanList.Type.NAME).isBanned(player.getName()));
        result.addProperty("operator", player.isOp());
        result.addProperty("world", player.getWorld().getName());
        result.addProperty("x", location.getX());
        result.addProperty("y", location.getY());
        result.addProperty("z", location.getZ());
        result.addProperty("yaw", location.getYaw());
        result.addProperty("pitch", location.getPitch());
        result.addProperty("health", player.getHealth());
        result.addProperty("foodLevel", player.getFoodLevel());
        result.addProperty("gameMode", player.getGameMode().name().toLowerCase(Locale.ROOT));
        result.add("inventory", snapshotPlayerInventory(player.getInventory()));
        result.add("enderChest", snapshotInventory(player.getEnderChest(), "ender"));
        return result;
    }

    private JsonArray snapshotPlayerInventory(PlayerInventory inventory) {
        JsonArray result = snapshotItems(inventory.getStorageContents(), "storage");
        appendItems(result, inventory.getArmorContents(), "armor");
        appendItems(result, inventory.getExtraContents(), "extra");
        return result;
    }

    private JsonArray snapshotInventory(Inventory inventory, String section) {
        return snapshotItems(inventory.getContents(), section);
    }

    private JsonArray snapshotItems(ItemStack[] contents, String section) {
        JsonArray result = new JsonArray();
        appendItems(result, contents, section);
        return result;
    }

    private void appendItems(JsonArray result, ItemStack[] contents, String section) {
        for (int slot = 0; slot < contents.length; slot += 1) {
            ItemStack item = contents[slot];
            if (item == null || item.getType() == Material.AIR || item.getAmount() <= 0) continue;
            JsonObject value = new JsonObject();
            value.addProperty("slot", slot);
            value.addProperty("section", section);
            value.addProperty("type", item.getType().name().toLowerCase(Locale.ROOT));
            value.addProperty("amount", item.getAmount());
            value.addProperty("durability", item.getDurability());
            ItemMeta meta = item.hasItemMeta() ? item.getItemMeta() : null;
            if (meta != null && meta.hasDisplayName()) value.addProperty("displayName", meta.getDisplayName());
            if (meta != null && meta.hasLore()) {
                JsonArray lore = new JsonArray();
                meta.getLore().forEach(lore::add);
                value.add("lore", lore);
            }
            if (!item.getEnchantments().isEmpty()) {
                JsonObject enchantments = new JsonObject();
                for (Map.Entry<Enchantment, Integer> enchantment : item.getEnchantments().entrySet()) {
                    enchantments.addProperty(enchantment.getKey().getKey().getKey(), enchantment.getValue());
                }
                value.add("enchantments", enchantments);
            }
            result.add(value);
        }
    }

    private JsonObject updatePlayerState(String playerKey, JsonObject request) {
        for (Map.Entry<String, JsonElement> entry : request.entrySet()) {
            if (!Set.of("health", "foodLevel", "gameMode", "location").contains(entry.getKey())) {
                throw new IllegalArgumentException("Unknown player state field.");
            }
        }
        Player player = resolvePlayer(playerKey);
        if (player == null) return null;
        if (request.has("health")) {
            double health = finiteJsonNumber(request, "health", 0.0D, 20.0D);
            player.setHealth(Math.min(health, player.getMaxHealth()));
        }
        if (request.has("foodLevel")) {
            int foodLevel = integerJsonNumber(request, "foodLevel", 0, 20);
            player.setFoodLevel(foodLevel);
        }
        if (request.has("gameMode")) {
            if (!request.get("gameMode").isJsonPrimitive() || !request.getAsJsonPrimitive("gameMode").isString()) {
                throw new IllegalArgumentException("Invalid game mode.");
            }
            player.setGameMode(GameMode.valueOf(request.get("gameMode").getAsString().toUpperCase(Locale.ROOT)));
        }
        if (request.has("location")) {
            if (!request.get("location").isJsonObject()) throw new IllegalArgumentException("Invalid location.");
            JsonObject location = request.getAsJsonObject("location");
            if (location.entrySet().size() != 6 || !location.has("world")
                || !location.get("world").isJsonPrimitive() || !location.getAsJsonPrimitive("world").isString()) {
                throw new IllegalArgumentException("Invalid location.");
            }
            World world = getServer().getWorld(location.get("world").getAsString());
            if (world == null) throw new IllegalArgumentException("Unknown world.");
            double x = finiteJsonNumber(location, "x", -30_000_000.0D, 30_000_000.0D);
            double y = finiteJsonNumber(location, "y", -64.0D, 512.0D);
            double z = finiteJsonNumber(location, "z", -30_000_000.0D, 30_000_000.0D);
            float yaw = (float) finiteJsonNumber(location, "yaw", -360.0D, 360.0D);
            float pitch = (float) finiteJsonNumber(location, "pitch", -90.0D, 90.0D);
            if (!player.teleport(new Location(world, x, y, z, yaw, pitch))) {
                throw new IllegalStateException("Player teleport was rejected.");
            }
        }
        player.saveData();
        return snapshotPlayer(player);
    }

    private JsonObject updatePlayerInventory(String playerKey, JsonObject request) {
        if (request.entrySet().size() != 3 || !request.has("section") || !request.has("slot") || !request.has("item")
            || !request.get("section").isJsonPrimitive() || !request.getAsJsonPrimitive("section").isString()) {
            throw new IllegalArgumentException("Invalid inventory request.");
        }
        String section = request.get("section").getAsString();
        int maximumSlot = "storage".equals(section) ? 35 : "armor".equals(section) ? 3
            : "extra".equals(section) ? 0 : "ender".equals(section) ? 26 : -1;
        int slot = integerJsonNumber(request, "slot", 0, maximumSlot);
        ItemStack item = null;
        if (!request.get("item").isJsonNull()) {
            if (!request.get("item").isJsonObject()) throw new IllegalArgumentException("Invalid inventory item.");
            JsonObject value = request.getAsJsonObject("item");
            if (value.entrySet().size() != 3 || !value.has("type") || !value.has("amount") || !value.has("durability")
                || !value.get("type").isJsonPrimitive() || !value.getAsJsonPrimitive("type").isString()) {
                throw new IllegalArgumentException("Invalid inventory item.");
            }
            String type = value.get("type").getAsString().toUpperCase(Locale.ROOT).replaceFirst("^MINECRAFT:", "");
            Material material = Material.matchMaterial(type);
            if (material == null || material == Material.AIR) throw new IllegalArgumentException("Unknown inventory item.");
            int amount = integerJsonNumber(value, "amount", 1, Math.min(64, material.getMaxStackSize()));
            int durability = integerJsonNumber(value, "durability", 0, Short.MAX_VALUE);
            item = new ItemStack(material, amount, (short) durability);
        }
        Player player = resolvePlayer(playerKey);
        if (player == null) return null;
        PlayerInventory inventory = player.getInventory();
        if ("storage".equals(section)) {
            inventory.setItem(slot, item);
        } else if ("armor".equals(section)) {
            ItemStack[] armor = inventory.getArmorContents();
            armor[slot] = item;
            inventory.setArmorContents(armor);
        } else if ("extra".equals(section)) {
            ItemStack[] extra = inventory.getExtraContents();
            extra[slot] = item;
            inventory.setExtraContents(extra);
        } else {
            player.getEnderChest().setItem(slot, item);
        }
        player.updateInventory();
        player.saveData();
        return snapshotPlayer(player);
    }

    private JsonObject kickPlayer(String playerKey, String reason) {
        Player player = resolvePlayer(playerKey);
        if (player == null) return null;
        JsonObject result = playerIdentity(player);
        result.addProperty("kicked", true);
        player.kickPlayer(reason);
        return result;
    }

    private JsonObject setPlayerBanned(String playerKey, boolean banned, String reason) {
        Player player = resolvePlayer(playerKey);
        if (player == null) return null;
        BanList bans = getServer().getBanList(BanList.Type.NAME);
        if (banned) bans.addBan(player.getName(), reason, (java.util.Date) null, "spawnpoint admin");
        else bans.pardon(player.getName());
        JsonObject result = playerIdentity(player);
        result.addProperty("banned", banned);
        if (banned) player.kickPlayer(reason);
        return result;
    }

    private static double finiteJsonNumber(JsonObject object, String key, double minimum, double maximum) {
        if (!object.has(key) || !object.get(key).isJsonPrimitive() || !object.getAsJsonPrimitive(key).isNumber()) {
            throw new IllegalArgumentException("Invalid number.");
        }
        double value = object.get(key).getAsDouble();
        if (!Double.isFinite(value) || value < minimum || value > maximum) {
            throw new IllegalArgumentException("Number is out of range.");
        }
        return value;
    }

    private static int integerJsonNumber(JsonObject object, String key, int minimum, int maximum) {
        double value = finiteJsonNumber(object, key, minimum, maximum);
        if (value != Math.rint(value)) throw new IllegalArgumentException("Expected an integer.");
        return (int) value;
    }

    private JsonObject setOperator(String playerKey, boolean operator) {
        Player player = resolvePlayer(playerKey);
        if (player == null) return null;
        player.setOp(operator);
        JsonObject result = playerIdentity(player);
        result.addProperty("operator", player.isOp());
        return result;
    }

    private JsonObject showTitle(String audience, List<String> targets, String title, String subtitle, String color) {
        Set<Player> recipients = new HashSet<>();
        if ("all".equals(audience)) {
            recipients.addAll(getServer().getOnlinePlayers());
        } else {
            for (String target : targets) {
                Player player = resolvePlayer(target);
                if (player != null && player.isOnline()) recipients.add(player);
            }
        }
        String colorPrefix = ChatColor.valueOf(color.toUpperCase(Locale.ROOT)).toString();
        for (Player player : recipients) {
            player.sendTitle(
                title.isEmpty() ? "" : colorPrefix + title,
                subtitle.isEmpty() ? "" : colorPrefix + subtitle,
                10,
                70,
                20
            );
        }
        JsonObject result = new JsonObject();
        result.addProperty("sent", recipients.size());
        return result;
    }

    private JsonObject disconnectPlayer(String playerKey) {
        Player player = resolvePlayer(playerKey);
        if (player == null) return null;
        JsonObject result = playerIdentity(player);
        result.addProperty("disconnected", true);
        player.kickPlayer("계정 비밀번호가 초기화됐어요. 다시 로그인하세요.");
        return result;
    }

    private JsonObject sendPlayerChat(String accountId, String message) {
        Player player = resolvePlayer(accountId);
        if (player == null || !player.isOnline()) return null;
        boolean command = message.startsWith("/");
        if (command) {
            if (player.performCommand(message.substring(1))) recordWhisperHistory(player, message);
        } else {
            player.chat(message);
        }
        JsonObject result = playerIdentity(player);
        result.addProperty("sent", true);
        result.addProperty("command", command);
        return result;
    }

    private Player resolvePlayer(String playerKey) {
        Player player;
        try {
            player = getServer().getPlayer(UUID.fromString(playerKey));
        } catch (IllegalArgumentException ignored) {
            player = getServer().getPlayerExact(playerKey);
        }
        if (player == null) {
            for (Map.Entry<UUID, PlayerIdentity> entry : activeIdentities.entrySet()) {
                if (MessageDigest.isEqual(
                    entry.getValue().accountId.getBytes(StandardCharsets.UTF_8),
                    playerKey.getBytes(StandardCharsets.UTF_8)
                )) {
                    player = getServer().getPlayer(entry.getKey());
                    break;
                }
            }
        }
        return player;
    }

    private JsonObject playerIdentity(Player player) {
        JsonObject result = new JsonObject();
        result.addProperty("uuid", player.getUniqueId().toString());
        PlayerIdentity identity = activeIdentities.get(player.getUniqueId());
        result.addProperty("accountId", identity == null ? null : identity.accountId);
        result.addProperty("username", player.getName());
        return result;
    }

    private void sendError(HttpExchange exchange, int status, String code) throws IOException {
        JsonObject body = new JsonObject();
        body.addProperty("error", code);
        sendJson(exchange, status, body);
    }

    private void sendJson(HttpExchange exchange, int status, JsonObject value) throws IOException {
        byte[] body = value.toString().getBytes(StandardCharsets.UTF_8);
        if (body.length > MAX_RESPONSE_BYTES) {
            status = 507;
            body = "{\"error\":\"response_too_large\"}".getBytes(StandardCharsets.UTF_8);
        }
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        exchange.sendResponseHeaders(status, body.length);
        exchange.getResponseBody().write(body);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onEmptyServerJoin(PlayerJoinEvent event) {
        if (isQuietSpectator(event.getPlayer()) || getServer().getOnlinePlayers().stream().filter(player -> !isQuietSpectator(player)).count() != 1) return;
        getServer().getWorlds().stream().filter(world -> world.getEnvironment() == World.Environment.NORMAL).forEach(world -> world.setTime(0L));
        getLogger().info("Set all loaded worlds to 6 AM after the empty server received a player.");
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onPlayerBedInteract(PlayerInteractEvent event) {
        if (isQuietSpectator(event.getPlayer())) return;
        if (event.getAction() != Action.RIGHT_CLICK_BLOCK || event.getHand() != EquipmentSlot.HAND) return;
        Block bedBlock = event.getClickedBlock();
        if (bedBlock == null || !(bedBlock.getBlockData() instanceof Bed)) return;
        if (bedBlock.getWorld().getEnvironment() != World.Environment.NORMAL) return;

        Bed bed = (Bed) bedBlock.getBlockData();
        Block bedHead = bed.getPart() == Bed.Part.HEAD ? bedBlock : bedBlock.getRelative(bed.getFacing());
        if (!(bedHead.getBlockData() instanceof Bed)) return;

        Player player = event.getPlayer();
        player.setBedSpawnLocation(bedHead.getLocation(), false);
        player.sendMessage(ChatColor.YELLOW + "리스폰 지점을 설정했어요.");
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerBedEnter(PlayerBedEnterEvent event) {
        Player sleeper = event.getPlayer();
        getServer().getScheduler().runTaskLater(this, () -> {
            if (!sleeper.isOnline() || !sleeper.isSleeping()) return;
            World world = sleeper.getWorld();
            long fullTime = world.getFullTime();
            world.setFullTime(fullTime + 24_000L - Math.floorMod(fullTime, 24_000L));
            world.setStorm(false);
            world.setThundering(false);
            getServer().broadcastMessage(ChatColor.YELLOW + playerLabel(sleeper) + "님이 잠들어 아침이 됐어요.");
        }, 1L);
    }

    private volatile List<String> publicPlayerNames = List.of();

    private void refreshPublicPlayerNames() {
        publicPlayerNames = getServer().getOnlinePlayers().stream()
            .filter(player -> !isQuietSpectator(player))
            .map(SpawnpointBridgePlugin::playerLabel).toList();
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onQuietSpectatorPing(org.bukkit.event.server.ServerListPingEvent event) {
        java.util.Iterator<Player> players = event.iterator();
        while (players.hasNext()) if (isQuietSpectator(players.next())) players.remove();
    }

    private boolean isQuietSpectator(Player player) {
        PlayerIdentity identity = activeIdentities.get(player.getUniqueId());
        if (identity == null) identity = pendingIdentities.get(player.getName().toLowerCase(Locale.ROOT));
        return identity != null && identity.spectator;
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onQuietSpectatorLogin(PlayerLoginEvent event) {
        PlayerIdentity identity = pendingIdentities.get(event.getPlayer().getName().toLowerCase(Locale.ROOT));
        if (identity == null || !identity.spectator) return;
        UUID spectatorUuid = UUID.nameUUIDFromBytes(("OfflinePlayer:" + event.getPlayer().getName()).getBytes(StandardCharsets.UTF_8));
        if (!spectatorUuid.equals(event.getPlayer().getUniqueId())) {
            event.disallow(PlayerLoginEvent.Result.KICK_OTHER, "관전 프로필로 다시 접속하세요.");
            pendingIdentities.remove(event.getPlayer().getName().toLowerCase(Locale.ROOT));
            return;
        }
        UUID operatorUuid = UUID.nameUUIDFromBytes(("OfflinePlayer:" + identity.operatorUsername).getBytes(StandardCharsets.UTF_8));
        if (!getServer().getOfflinePlayer(operatorUuid).isOp()) {
            event.disallow(PlayerLoginEvent.Result.KICK_OTHER, "관전 접속은 OP 계정만 사용할 수 있어요.");
            pendingIdentities.remove(event.getPlayer().getName().toLowerCase(Locale.ROOT));
            return;
        }
        event.getPlayer().setGameMode(GameMode.SPECTATOR);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onQuietSpectatorMode(PlayerGameModeChangeEvent event) {
        if (isQuietSpectator(event.getPlayer()) && event.getNewGameMode() != GameMode.SPECTATOR) event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onQuietSpectatorInteract(PlayerInteractEvent event) {
        if (isQuietSpectator(event.getPlayer())) event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onQuietSpectatorInteractEntity(PlayerInteractEntityEvent event) {
        if (isQuietSpectator(event.getPlayer())) event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onQuietSpectatorDamage(EntityDamageEvent event) {
        if (event.getEntity() instanceof Player player && isQuietSpectator(player)) event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onPlayerJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        installDisplayNamePacketHandler(player);
        applyPendingIdentity(player);
        event.setJoinMessage(null);
        for (Player other : getServer().getOnlinePlayers()) {
            if (other == player) continue;
            if (isQuietSpectator(player)) other.hidePlayer(this, player);
            if (isQuietSpectator(other)) player.hidePlayer(this, other);
        }
        if (isQuietSpectator(player)) {
            player.setGameMode(GameMode.SPECTATOR);
            player.setSleepingIgnored(true);
            player.setCollidable(false);
            return;
        }
        refreshPublicPlayerNames();
        announcePlayerJoin(player, IDENTITY_RESOLVE_ATTEMPTS);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onPlayerChat(AsyncPlayerChatEvent event) {
        if (isQuietSpectator(event.getPlayer())) { event.setCancelled(true); return; }
        event.setFormat("<" + playerLabel(event.getPlayer()) + "> %2$s");
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerChatHistory(AsyncPlayerChatEvent event) {
        recordPlayerHistory("chat", event.getPlayer(), event.getMessage());
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onModernPlayerChat(io.papermc.paper.event.player.AsyncChatEvent event) {
        if (isQuietSpectator(event.getPlayer())) { event.setCancelled(true); return; }
        var head = net.kyori.adventure.text.Component.text("\ue000")
            .font(net.kyori.adventure.key.Key.key("minecraft", "spawnpoint/head_" + event.getPlayer().getUniqueId()));
        String label = playerLabel(event.getPlayer());
        var name = net.kyori.adventure.text.Component.text(label)
            .font(net.kyori.adventure.key.Key.key("minecraft", "galmuri11_bold"));
        event.renderer(io.papermc.paper.chat.ChatRenderer.viewerUnaware((source, displayName, message) ->
            net.kyori.adventure.text.Component.empty().append(head)
                .append(net.kyori.adventure.text.Component.space()).append(name)
                .append(net.kyori.adventure.text.Component.space()).append(message)));
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onPlayerDeath(PlayerDeathEvent event) {
        if (isQuietSpectator(event.getEntity())) { event.deathMessage(null); return; }
        Location location = event.getEntity().getLocation();
        String coordinates = location.getBlockX() + ", " + location.getBlockY() + ", " + location.getBlockZ();
        if (!Boolean.TRUE.equals(event.getEntity().getWorld().getGameRuleValue(org.bukkit.GameRule.SHOW_DEATH_MESSAGES))) {
            event.deathMessage(null);
            event.getEntity().sendMessage("사망 좌표: " + coordinates);
            return;
        }
        var message = event.deathMessage();
        if (message == null) message = net.kyori.adventure.text.Component.text(playerLabel(event.getEntity()) + "님이 사망했습니다.");
        event.deathMessage(replaceTechnicalNames(message).append(net.kyori.adventure.text.Component.text(
            " [좌표: " + coordinates + "]", net.kyori.adventure.text.format.NamedTextColor.GRAY)));
    }

    private net.kyori.adventure.text.Component replaceTechnicalNames(net.kyori.adventure.text.Component message) {
        for (Player player : getServer().getOnlinePlayers()) {
            message = message.replaceText(builder -> builder.matchLiteral(player.getName()).replacement(playerLabel(player)));
        }
        return message;
    }

    private BaseComponent[] localizedDeathMessage(Player player) {
        try {
            Object handle = player.getClass().getMethod("getHandle").invoke(player);
            Object tracker = handle.getClass().getMethod("getCombatTracker").invoke(handle);
            Object component = tracker.getClass().getMethod("getDeathMessage").invoke(tracker);
            Class<?> componentType = Class.forName("net.minecraft.server.v1_12_R1.IChatBaseComponent");
            Class<?> serializerType = Class.forName("net.minecraft.server.v1_12_R1.IChatBaseComponent$ChatSerializer");
            String json = (String) serializerType.getMethod("a", componentType).invoke(null, component);
            BaseComponent[] translated = ComponentSerializer.parse(json);
            for (BaseComponent part : translated) replaceTechnicalPlayerNames(part);
            return translated;
        } catch (ReflectiveOperationException | RuntimeException | LinkageError exception) {
            if (!deathTranslationWarningLogged) {
                deathTranslationWarningLogged = true;
                getLogger().warning("Could not preserve the localized death message: " + exception.getMessage());
            }
            return null;
        }
    }

    private void replaceTechnicalPlayerNames(BaseComponent component) {
        if (component instanceof TextComponent text) {
            text.setText(replaceTechnicalPlayerNames(text.getText()));
        } else if (component instanceof TranslatableComponent translated) {
            if (translated.getWith() != null) {
                for (BaseComponent argument : translated.getWith()) replaceTechnicalPlayerNames(argument);
            }
        }
        if (component.getExtra() != null) {
            for (BaseComponent extra : component.getExtra()) replaceTechnicalPlayerNames(extra);
        }
        HoverEvent hover = component.getHoverEvent();
        if (hover != null && hover.getValue() != null) {
            for (BaseComponent value : hover.getValue()) replaceTechnicalPlayerNames(value);
        }
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onPlayerAdvancement(PlayerAdvancementDoneEvent event) {
        if (isQuietSpectator(event.getPlayer())) { event.message(null); return; }
        if (event.message() != null) event.message(replaceTechnicalNames(event.message()));
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onPlayerQuit(PlayerQuitEvent event) {
        String displayName = resolvedPlayerName(event.getPlayer());
        event.setQuitMessage(isQuietSpectator(event.getPlayer()) || displayName == null
            ? null
            : ChatColor.YELLOW + displayName + "님이 게임에서 나갔습니다.");
        removeTeleportRequestsFor(event.getPlayer());
        recordPlayerHistory("quit", event.getPlayer(), null);
        publicPlayerNames = getServer().getOnlinePlayers().stream()
            .filter(player -> player != event.getPlayer() && !isQuietSpectator(player))
            .map(SpawnpointBridgePlugin::playerLabel).toList();
        activeIdentities.remove(event.getPlayer().getUniqueId());
    }

    private void announcePlayerJoin(Player player, int attemptsRemaining) {
        if (!player.isOnline()) return;
        applyPendingIdentity(player);
        if (isQuietSpectator(player)) return;
        String displayName = resolvedPlayerName(player);
        if (displayName == null) {
            if (attemptsRemaining > 0) {
                getServer().getScheduler().runTaskLater(
                    this,
                    () -> announcePlayerJoin(player, attemptsRemaining - 1),
                    1L
                );
            } else {
                getLogger().warning("Suppressed a join message because no display name resolved for " + player.getName() + ".");
            }
            return;
        }
        recordPlayerHistory("join", player, null);
        getServer().broadcastMessage(ChatColor.YELLOW + displayName + "님이 게임에 참여했습니다.");
    }

    private PlayerIdentity applyPendingIdentity(Player player) {
        PlayerIdentity identity = activeIdentities.get(player.getUniqueId());
        if (identity == null) {
            identity = pendingIdentities.remove(player.getName().toLowerCase(Locale.ROOT));
            if (identity != null) activeIdentities.put(player.getUniqueId(), identity);
        }
        if (identity == null) return null;
        player.setDisplayName(identity.displayName);
        try {
            player.setPlayerListName(identity.displayName);
        } catch (IllegalArgumentException exception) {
            player.setPlayerListName("플레이어");
            getLogger().warning("Could not apply the display name to the player list for " + player.getName() + ".");
        }
        return identity;
    }

    private static String resolvedPlayerName(Player player) {
        String displayName = player.getDisplayName();
        if (displayName == null || displayName.isBlank() || isTechnicalGameUsername(displayName)) return null;
        return displayName;
    }

    private String replaceTechnicalPlayerNames(String message) {
        String visible = message;
        for (Player player : getServer().getOnlinePlayers()) {
            if (!player.getName().equals(player.getDisplayName())) {
                visible = visible.replace(player.getName(), playerLabel(player));
            }
        }
        return TECHNICAL_GAME_USERNAME.matcher(visible).replaceAll("플레이어");
    }

    private static boolean isTechnicalGameUsername(String value) {
        return TECHNICAL_GAME_USERNAME.matcher(value).matches();
    }

    private void installDisplayNamePacketHandler(Player player) {
        try {
            installDisplayNamePacketHandler(playerNetworkChannel(player));
        } catch (RuntimeException | LinkageError exception) {
            warnDisplayNameBridgeFailure(exception);
        }
    }

    private void installDisplayNamePacketHandler(Object channel) {
        try {
            if (channel == null) throw new IllegalStateException("The player network channel is not ready.");
            Class<?> channelType = Class.forName("io.netty.channel.Channel");
            Class<?> pipelineType = Class.forName("io.netty.channel.ChannelPipeline");
            Class<?> handlerType = Class.forName("io.netty.channel.ChannelHandler");
            Class<?> outboundHandlerType = Class.forName("io.netty.channel.ChannelOutboundHandler");
            Object pipeline = channelType.getMethod("pipeline").invoke(channel);
            if (pipelineType.getMethod("get", String.class).invoke(pipeline, "spawnpoint_display_names") != null) return;
            Object handler = Proxy.newProxyInstance(
                getClass().getClassLoader(),
                new Class<?>[] { outboundHandlerType },
                (proxy, method, arguments) -> forwardPacketHandlerCall(proxy, method, arguments)
            );
            pipelineType
                .getMethod("addBefore", String.class, String.class, handlerType)
                .invoke(pipeline, "packet_handler", "spawnpoint_display_names", handler);
        } catch (ReflectiveOperationException | RuntimeException | LinkageError exception) {
            warnDisplayNameBridgeFailure(exception);
        }
    }

    private void warnDisplayNameBridgeFailure(Throwable exception) {
        if (packetReflectionWarningLogged) return;
        packetReflectionWarningLogged = true;
        getLogger().warning("Could not install the in-game display-name bridge: " + exception.getMessage());
    }

    private Object forwardPacketHandlerCall(Object proxy, Method method, Object[] arguments) throws Throwable {
        if (method.getDeclaringClass() == Object.class) {
            return switch (method.getName()) {
                case "toString" -> "SpawnpointDisplayNamePacketHandler";
                case "hashCode" -> System.identityHashCode(proxy);
                case "equals" -> proxy == arguments[0];
                default -> null;
            };
        }
        String methodName = method.getName();
        Object context = arguments[0];
        if ("write".equals(methodName)) arguments[1] = rewritePlayerInfoPacket(arguments[1]);
        if ("handlerAdded".equals(methodName) || "handlerRemoved".equals(methodName)) return null;
        Class<?> contextType = Class.forName("io.netty.channel.ChannelHandlerContext");
        if ("exceptionCaught".equals(methodName)) {
            return contextType.getMethod("fireExceptionCaught", Throwable.class).invoke(context, arguments[1]);
        }
        Class<?>[] forwardedTypes = new Class<?>[method.getParameterCount() - 1];
        System.arraycopy(method.getParameterTypes(), 1, forwardedTypes, 0, forwardedTypes.length);
        Object[] forwardedArguments = new Object[arguments.length - 1];
        System.arraycopy(arguments, 1, forwardedArguments, 0, forwardedArguments.length);
        return contextType.getMethod(methodName, forwardedTypes).invoke(context, forwardedArguments);
    }

    private Object rewritePlayerInfoPacket(Object packet) {
        if (!(packet instanceof net.minecraft.network.protocol.game.ClientboundPlayerInfoUpdatePacket info)) return packet;
        var entries = new ArrayList<net.minecraft.network.protocol.game.ClientboundPlayerInfoUpdatePacket.Entry>();
        for (var entry : info.entries()) {
            GameProfile profile = entry.profile();
            PlayerIdentity identity = activeIdentities.get(entry.profileId());
            if (identity == null && profile != null) identity = pendingIdentities.get(profile.name().toLowerCase(Locale.ROOT));
            if (identity != null && identity.spectator) continue;
            if (identity == null || profile == null) { entries.add(entry); continue; }
            var displayProfile = new GameProfile(profile.id(), identity.displayName, profile.properties());
            entries.add(new net.minecraft.network.protocol.game.ClientboundPlayerInfoUpdatePacket.Entry(
                entry.profileId(), displayProfile, entry.listed(), entry.latency(), entry.gameMode(),
                entry.displayName(), entry.showHat(), entry.listOrder(), entry.chatSession()));
        }
        return new net.minecraft.network.protocol.game.ClientboundPlayerInfoUpdatePacket(info.actions(), entries);
    }

    private void removeDisplayNamePacketHandler(Player player) {
        try {
            Object channel = playerNetworkChannel(player);
            Class<?> channelType = Class.forName("io.netty.channel.Channel");
            Class<?> pipelineType = Class.forName("io.netty.channel.ChannelPipeline");
            Object pipeline = channelType.getMethod("pipeline").invoke(channel);
            if (pipelineType.getMethod("get", String.class).invoke(pipeline, "spawnpoint_display_names") != null) {
                pipelineType.getMethod("remove", String.class).invoke(pipeline, "spawnpoint_display_names");
            }
        } catch (ReflectiveOperationException | RuntimeException | LinkageError ignored) {
            // The connection can already be closed while the plugin is shutting down.
        }
    }

    private static Object playerNetworkChannel(Player player) {
        return ((org.bukkit.craftbukkit.entity.CraftPlayer) player).getHandle().connection.connection.channel;
    }

    private boolean disableDefaultAdvancementAnnouncement(World world) {
        UUID worldId = world.getUID();
        if (advancementRuleRestores.containsKey(worldId)) return true;
        String current = world.getGameRuleValue("announceAdvancements");
        if (!"true".equalsIgnoreCase(current)) return false;
        if (!world.setGameRuleValue("announceAdvancements", "false")) return false;
        advancementRuleRestores.put(worldId, current);
        getServer().getScheduler().runTaskLater(this, () -> restoreAdvancementAnnouncementRule(world), 1L);
        return true;
    }

    private void restoreAdvancementAnnouncementRule(World world) {
        String original = advancementRuleRestores.remove(world.getUID());
        if (original != null) world.setGameRuleValue("announceAdvancements", original);
    }

    private void restoreAdvancementAnnouncementRules() {
        for (World world : getServer().getWorlds()) restoreAdvancementAnnouncementRule(world);
        advancementRuleRestores.clear();
    }

    private AdvancementAnnouncement advancementAnnouncement(Advancement advancement) {
        try {
            Object handle = advancement.getClass().getMethod("getHandle").invoke(advancement);
            Object display = handle.getClass().getMethod("c").invoke(handle);
            if (display == null || !((Boolean) display.getClass().getMethod("i").invoke(display))) return null;
            Object frame = display.getClass().getMethod("e").invoke(display);
            String frameName = (String) frame.getClass().getMethod("a").invoke(frame);
            Object title = handle.getClass().getMethod("j").invoke(handle);
            String craftPackage = getServer().getClass().getPackage().getName();
            String version = craftPackage.substring(craftPackage.lastIndexOf('.') + 1);
            Class<?> componentType = Class.forName("net.minecraft.server." + version + ".IChatBaseComponent");
            Class<?> serializer = Class.forName("net.minecraft.server." + version + ".IChatBaseComponent$ChatSerializer");
            String titleJson = (String) serializer.getMethod("a", componentType).invoke(null, title);
            BaseComponent[] titleParts = ComponentSerializer.parse(titleJson);
            BaseComponent titleComponent = titleParts.length == 1 ? titleParts[0] : new TextComponent(titleParts);
            return new AdvancementAnnouncement(frameName, titleComponent);
        } catch (ReflectiveOperationException | RuntimeException | LinkageError exception) {
            if (!advancementReflectionWarningLogged) {
                advancementReflectionWarningLogged = true;
                getLogger().warning("Could not replace advancement player IDs with display names: " + exception.getMessage());
            }
            return null;
        }
    }

    private static double relativeYaw(Location origin, Location destination) {
        double targetYaw = Math.toDegrees(Math.atan2(-(destination.getX() - origin.getX()), destination.getZ() - origin.getZ()));
        return signedYaw(targetYaw - origin.getYaw());
    }

    private static double normalizeYaw(double yaw) {
        double normalized = yaw % 360.0D;
        if (normalized < 0.0D) normalized += 360.0D;
        return normalized;
    }

    private static double signedYaw(double yaw) {
        double normalized = normalizeYaw(yaw);
        return normalized > 180.0D ? normalized - 360.0D : normalized;
    }

    private byte[] loadSecret() throws IOException {
        String configured = System.getenv("SESSION_SECRET");
        if (configured != null && configured.trim().length() >= 32) {
            return configured.trim().getBytes(StandardCharsets.UTF_8);
        }
        String dataDir = env("DATA_DIR", "data");
        String stored = Files.readString(Path.of(dataDir, "session.secret"), StandardCharsets.UTF_8).trim();
        if (stored.length() < 32) throw new IOException("session.secret is missing or too short");
        return stored.getBytes(StandardCharsets.UTF_8);
    }

    private static String env(String key, String fallback) {
        String value = System.getenv(key);
        return value == null || value.isBlank() ? fallback : value;
    }

    private static int integerEnv(String key, int fallback, int minimum, int maximum) {
        try {
            int value = Integer.parseInt(env(key, Integer.toString(fallback)));
            return Math.max(minimum, Math.min(maximum, value));
        } catch (NumberFormatException exception) {
            return fallback;
        }
    }

    private Ticket verifyPath(String websocketPath) {
        String token = queryValue(websocketPath, "ticket");
        if (token == null) return null;
        String[] parts = token.split("\\.", -1);
        if (parts.length != 2) return null;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            byte[] expected = mac.doFinal(parts[0].getBytes(StandardCharsets.US_ASCII));
            byte[] supplied = Base64.getUrlDecoder().decode(parts[1]);
            if (!MessageDigest.isEqual(expected, supplied)) return null;
            String payload = new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8);
            JsonObject json = new JsonParser().parse(payload).getAsJsonObject();
            if (!"game".equals(string(json, "aud"))) return null;
            long expiresAt = json.get("exp").getAsLong();
            if (expiresAt <= System.currentTimeMillis() / 1000L) return null;
            String username = string(json, "username");
            String subject = string(json, "sub");
            String skinPath = string(json, "skinPath");
            String skinModel = string(json, "skinModel");
            String displayName = string(json, "displayName");
            if (username == null || !username.matches("[A-Za-z0-9_]{3,16}") || subject == null) return null;
            UUID.fromString(subject);
            if (skinPath == null || !(skinPath.startsWith("/api/skins/") || skinPath.startsWith("/assets/skins/"))) return null;
            if (skinPath.contains("..") || skinPath.contains("\\") || skinPath.contains("#")) return null;
            if (!("steve".equals(skinModel) || "alex".equals(skinModel))) return null;
            if (!isSafeDisplayName(displayName)) displayName = username;
            boolean spectator = json.has("spectator") && json.get("spectator").getAsBoolean();
            String operatorUsername = string(json, "operatorUsername");
            if (spectator && (operatorUsername == null || !operatorUsername.matches("[A-Za-z0-9_]{3,16}"))) return null;
            return new Ticket(username, subject, displayName, skinPath, skinModel, spectator, operatorUsername);
        } catch (GeneralSecurityException | IllegalArgumentException | IllegalStateException exception) {
            return null;
        }
    }

    private static boolean isSafeDisplayName(String value) {
        if (value == null || value.trim().isEmpty() || value.length() > 16) return false;
        return value.codePoints().noneMatch(codePoint -> Character.isISOControl(codePoint) || codePoint == '\u00a7');
    }

    private static boolean isSafeTitleText(String value, int maxLength) {
        return value != null && value.length() <= maxLength
            && value.codePoints().noneMatch(codePoint -> Character.isISOControl(codePoint) || codePoint == '\u00a7');
    }

    private static String string(JsonObject json, String key) {
        return json.has(key) && json.get(key).isJsonPrimitive() ? json.get(key).getAsString() : null;
    }

    private static String queryValue(String path, String key) {
        if (path == null) return null;
        int queryStart = path.indexOf('?');
        if (queryStart < 0 || queryStart == path.length() - 1) return null;
        for (String part : path.substring(queryStart + 1).split("&")) {
            int separator = part.indexOf('=');
            String rawKey = separator < 0 ? part : part.substring(0, separator);
            if (key.equals(URLDecoder.decode(rawKey, StandardCharsets.UTF_8))) {
                String value = separator < 0 ? "" : part.substring(separator + 1);
                return URLDecoder.decode(value, StandardCharsets.UTF_8);
            }
        }
        return null;
    }

    private record Ticket(String username, String accountId, String displayName, String skinPath, String skinModel, boolean spectator, String operatorUsername) {}

    private record PlayerIdentity(String accountId, String displayName, String skinPath, boolean spectator, String operatorUsername) {}

    private record LocatorTarget(Player player, Location location, double distanceSquared) {}

    private record PlayerLookup(Player player, boolean duplicateDisplayName) {}

    record CommandTargetName(String displayName, String technicalName) {}

    record CommandRewrite(String message, boolean ambiguousDisplayName) {}

    record WhisperCommand(String target, String message) {}

    private record TargetRewrite(String message, boolean ambiguousDisplayName) {}

    private record CommandSpan(int start, int end) {}

    private record TeleportRequest(UUID requesterId, UUID targetId, long expiresAt) {}

    record ProcessedChunk(UUID worldId, int chunkX, int chunkZ) {}

    record DiamondMarkerState(
        Set<ProcessedChunk> legacyProcessedChunks,
        Set<ProcessedChunk> balancedProcessedChunks,
        Set<ProcessedChunk> frequentProcessedChunks,
        boolean requiresMigration
    ) {}

    record DiamondBonusBlock(int x, int y, int z) {}

    private record AdvancementAnnouncement(String frame, BaseComponent title) {}

    private static final class BridgeThreadFactory implements ThreadFactory {
        private int number;

        @Override
        public synchronized Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "spawnpoint-admin-bridge-" + (++number));
            thread.setDaemon(true);
            return thread;
        }
    }

    private static final class HistoryThreadFactory implements ThreadFactory {
        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "spawnpoint-history-writer");
            thread.setDaemon(true);
            return thread;
        }
    }

    private static final class RequestTooLargeException extends Exception {}
}
