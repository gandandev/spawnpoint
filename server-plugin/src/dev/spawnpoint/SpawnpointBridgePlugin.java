package dev.spawnpoint;

import com.mojang.authlib.GameProfile;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
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
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import net.lax1dude.eaglercraft.backend.server.api.event.IEaglercraftAuthCheckRequiredEvent.EnumAuthResponse;
import net.lax1dude.eaglercraft.backend.server.api.bukkit.event.EaglercraftAuthCheckRequiredEvent;
import net.lax1dude.eaglercraft.backend.server.api.bukkit.event.EaglercraftLoginEvent;
import net.lax1dude.eaglercraft.backend.server.api.bukkit.event.EaglercraftRegisterSkinEvent;
import net.lax1dude.eaglercraft.backend.server.api.bukkit.event.PlayerLoginPostEvent;
import net.lax1dude.eaglercraft.backend.server.api.skins.EnumSkinModel;
import net.lax1dude.eaglercraft.backend.server.api.skins.IEaglerPlayerSkin;
import net.md_5.bungee.api.chat.BaseComponent;
import net.md_5.bungee.api.chat.ClickEvent;
import net.md_5.bungee.api.chat.HoverEvent;
import net.md_5.bungee.api.chat.TextComponent;
import net.md_5.bungee.api.chat.TranslatableComponent;
import net.md_5.bungee.chat.ComponentSerializer;
import org.bukkit.ChatColor;
import org.bukkit.Location;
import org.bukkit.Material;
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
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerAdvancementDoneEvent;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.event.player.PlayerBedEnterEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.material.Bed;
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
    private static final Pattern TECHNICAL_GAME_USERNAME = Pattern.compile("(?i)sp_[a-f0-9]{13}");

    private byte[] secret;
    private String portalOrigin;
    private HttpServer bridgeServer;
    private ExecutorService bridgeExecutor;
    private BukkitTask locatorSnapshotTask;
    private BukkitTask commandIdentityRefreshTask;
    private boolean tpaEnabled;
    private final Map<String, PlayerIdentity> pendingIdentities = new ConcurrentHashMap<>();
    private final Map<UUID, PlayerIdentity> activeIdentities = new ConcurrentHashMap<>();
    private volatile Map<String, JsonObject> locatorSnapshots = Map.of();
    private volatile List<CommandTargetName> commandTargets = List.of();
    private final Map<UUID, TeleportRequest> teleportRequests = new HashMap<>();
    private final Map<UUID, BukkitTask> teleportExpiryTasks = new HashMap<>();
    private final Map<UUID, Long> teleportRequestCooldowns = new HashMap<>();
    private final Map<UUID, String> advancementRuleRestores = new HashMap<>();
    private boolean advancementReflectionWarningLogged;
    private boolean deathTranslationWarningLogged;
    private boolean packetReflectionWarningLogged;
    private boolean commandIdentityWarningLogged;

    @Override
    public void onEnable() {
        try {
            this.secret = loadSecret();
        } catch (IOException exception) {
            getLogger().severe("Could not load the shared session secret: " + exception.getMessage());
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        getConfig().addDefault("tpa-enabled", true);
        getConfig().options().copyDefaults(true);
        try {
            savePluginConfig();
        } catch (IOException exception) {
            getLogger().severe("Could not save the default TPA setting: " + exception.getMessage());
        }
        this.tpaEnabled = getConfig().getBoolean("tpa-enabled", true);
        registerCommand("tpa");
        registerCommand("tpaccept");
        registerCommand("tpdeny");
        this.portalOrigin = env("PORTAL_INTERNAL_ORIGIN", "http://127.0.0.1:3000").replaceAll("/+$", "");
        getServer().getPluginManager().registerEvents(this, this);
        enableKeepInventory();
        startBridgeServer();
        if (!isEnabled()) return;
        this.locatorSnapshotTask = getServer().getScheduler().runTaskTimer(this, this::refreshLocatorSnapshots, 1L, 2L);
        this.commandIdentityRefreshTask = getServer().getScheduler().runTaskTimerAsynchronously(
            this,
            this::refreshCommandTargets,
            1L,
            COMMAND_IDENTITY_REFRESH_TICKS
        );
        getLogger().info("Site-ticket authentication and the loopback server bridge are active.");
    }

    private void enableKeepInventory() {
        int enabledWorlds = 0;
        for (World world : getServer().getWorlds()) {
            if (world.setGameRuleValue("keepInventory", "true")) {
                enabledWorlds++;
            } else {
                getLogger().warning("Could not enable keepInventory in world " + world.getName() + ".");
            }
        }
        getLogger().info("Enabled keepInventory in " + enabledWorlds + " loaded worlds.");
    }

    @Override
    public void onDisable() {
        if (locatorSnapshotTask != null) locatorSnapshotTask.cancel();
        if (commandIdentityRefreshTask != null) commandIdentityRefreshTask.cancel();
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
            default -> false;
        };
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
            getLogger().severe("Could not start the loopback server bridge; site-ticket authentication remains active: " + exception.getMessage());
            if (bridgeServer != null) bridgeServer.stop(0);
            bridgeServer = null;
            if (bridgeExecutor != null) bridgeExecutor.shutdownNow();
            bridgeExecutor = null;
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
            if ("GET".equals(method) && "/v1/health".equals(path)) {
                JsonObject body = onMainThread(() -> {
                    JsonObject health = new JsonObject();
                    health.addProperty("ok", true);
                    health.addProperty("onlinePlayers", getServer().getOnlinePlayers().size());
                    return health;
                });
                sendJson(exchange, 200, body);
                return;
            }
            if ("GET".equals(method) && "/v1/players".equals(path)) {
                sendJson(exchange, 200, onMainThread(this::snapshotPlayers));
                return;
            }
            String locatorPrefix = "/v1/locator/";
            if ("GET".equals(method) && path.startsWith(locatorPrefix)) {
                String encodedAccountId = path.substring(locatorPrefix.length());
                if (encodedAccountId.isEmpty() || encodedAccountId.contains("/")) {
                    sendError(exchange, 400, "invalid_account");
                    return;
                }
                String accountId = URLDecoder.decode(encodedAccountId, StandardCharsets.UTF_8);
                UUID.fromString(accountId);
                JsonObject snapshot = locatorSnapshots.get(accountId);
                sendJson(exchange, 200, snapshot == null ? inactiveLocatorSnapshot() : snapshot);
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

    private JsonObject snapshotPlayers() {
        JsonObject root = new JsonObject();
        JsonArray players = new JsonArray();
        getServer().getOnlinePlayers().stream()
            .sorted(Comparator.comparing(Player::getName, String.CASE_INSENSITIVE_ORDER))
            .map(this::snapshotPlayer)
            .forEach(players::add);
        root.add("players", players);
        return root;
    }

    private void refreshLocatorSnapshots() {
        Map<String, JsonObject> snapshots = new HashMap<>();
        for (Player viewer : getServer().getOnlinePlayers()) {
            PlayerIdentity identity = activeIdentities.get(viewer.getUniqueId());
            if (identity != null) snapshots.put(identity.accountId, snapshotLocator(viewer));
        }
        locatorSnapshots = Map.copyOf(snapshots);
    }

    private static JsonObject inactiveLocatorSnapshot() {
        JsonObject root = new JsonObject();
        root.addProperty("active", false);
        root.add("targets", new JsonArray());
        return root;
    }

    private JsonObject snapshotLocator(Player viewer) {
        JsonObject root = new JsonObject();
        JsonArray targets = new JsonArray();
        root.addProperty("active", true);
        Location viewerLocation = viewer.getLocation();
        List<LocatorTarget> nearby = new ArrayList<>();
        for (Player other : getServer().getOnlinePlayers()) {
            if (other == viewer || !other.getWorld().equals(viewer.getWorld()) || !viewer.canSee(other)) continue;
            Location otherLocation = other.getLocation();
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
        result.add("enderChest", snapshotInventory(player.getEnderChest(), "storage"));
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
                    enchantments.addProperty(enchantment.getKey().getName().toLowerCase(Locale.ROOT), enchantment.getValue());
                }
                value.add("enchantments", enchantments);
            }
            result.add(value);
        }
    }

    private JsonObject setOperator(String playerKey, boolean operator) {
        Player player = resolvePlayer(playerKey);
        if (player == null) return null;
        player.setOp(operator);
        JsonObject result = playerIdentity(player);
        result.addProperty("operator", player.isOp());
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
            player.performCommand(message.substring(1));
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
        if (getServer().getOnlinePlayers().size() != 1) return;
        getServer().getWorlds().forEach(world -> world.setTime(0L));
        getLogger().info("Set all loaded worlds to 6 AM after the empty server received a player.");
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onPlayerBedInteract(PlayerInteractEvent event) {
        if (event.getAction() != Action.RIGHT_CLICK_BLOCK || event.getHand() != EquipmentSlot.HAND) return;
        Block bedBlock = event.getClickedBlock();
        if (bedBlock == null || bedBlock.getType() != Material.BED_BLOCK) return;
        if (bedBlock.getWorld().getEnvironment() != World.Environment.NORMAL) return;

        Bed bed = (Bed) bedBlock.getState().getData();
        Block bedHead = bed.isHeadOfBed() ? bedBlock : bedBlock.getRelative(bed.getFacing());
        if (bedHead.getType() != Material.BED_BLOCK) return;

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

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onPlayerJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        installDisplayNamePacketHandler(player);
        applyPendingIdentity(player);
        event.setJoinMessage(null);
        announcePlayerJoin(player, IDENTITY_RESOLVE_ATTEMPTS);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onPlayerChat(AsyncPlayerChatEvent event) {
        event.setFormat("<" + playerLabel(event.getPlayer()) + "> %2$s");
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onPlayerDeath(PlayerDeathEvent event) {
        Location location = event.getEntity().getLocation();
        String coordinates = location.getBlockX() + ", " + location.getBlockY() + ", " + location.getBlockZ();
        String showDeathMessages = event.getEntity().getWorld().getGameRuleValue("showDeathMessages");
        if (showDeathMessages != null && !Boolean.parseBoolean(showDeathMessages)) {
            event.setDeathMessage(null);
            event.getEntity().sendMessage("사망 좌표: " + coordinates);
            return;
        }
        BaseComponent[] deathMessage = localizedDeathMessage(event.getEntity());
        if (deathMessage == null) {
            event.setDeathMessage(playerLabel(event.getEntity()) + "님이 사망했습니다."
                + ChatColor.GRAY + " [좌표: " + coordinates + "]");
            return;
        }
        event.setDeathMessage(null);
        TextComponent coordinateMessage = new TextComponent(" [좌표: " + coordinates + "]");
        coordinateMessage.setColor(net.md_5.bungee.api.ChatColor.GRAY);
        BaseComponent[] message = new BaseComponent[deathMessage.length + 1];
        System.arraycopy(deathMessage, 0, message, 0, deathMessage.length);
        message[message.length - 1] = coordinateMessage;
        getServer().spigot().broadcast(message);
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
        AdvancementAnnouncement announcement = advancementAnnouncement(event.getAdvancement());
        if (announcement == null || !disableDefaultAdvancementAnnouncement(event.getPlayer().getWorld())) return;
        TranslatableComponent message = new TranslatableComponent(
            "chat.type.advancement." + announcement.frame,
            new TextComponent(playerLabel(event.getPlayer())),
            announcement.title
        );
        getServer().spigot().broadcast(message);
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onPlayerQuit(PlayerQuitEvent event) {
        String displayName = resolvedPlayerName(event.getPlayer());
        event.setQuitMessage(displayName == null
            ? null
            : ChatColor.YELLOW + displayName + "님이 게임에서 나갔습니다.");
        removeTeleportRequestsFor(event.getPlayer());
        activeIdentities.remove(event.getPlayer().getUniqueId());
    }

    private void announcePlayerJoin(Player player, int attemptsRemaining) {
        if (!player.isOnline()) return;
        applyPendingIdentity(player);
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

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onPlayerLoginPost(PlayerLoginPostEvent event) {
        try {
            Object netty = PlayerLoginPostEvent.class.getMethod("netty").invoke(event);
            Class<?> nettyUnsafeType = Class.forName(
                "net.lax1dude.eaglercraft.backend.server.api.bukkit.event.PlayerLoginPostEvent$NettyUnsafe"
            );
            Object channel = nettyUnsafeType.getMethod("getChannel").invoke(netty);
            installDisplayNamePacketHandler(channel);
        } catch (ReflectiveOperationException | RuntimeException | LinkageError exception) {
            warnDisplayNameBridgeFailure(exception);
        }
    }

    private void installDisplayNamePacketHandler(Player player) {
        try {
            installDisplayNamePacketHandler(playerNetworkChannel(player));
        } catch (ReflectiveOperationException | RuntimeException | LinkageError exception) {
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
        if ("write".equals(methodName)) rewritePlayerInfoPacket(arguments[1]);
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

    private void rewritePlayerInfoPacket(Object packet) {
        if (packet == null || !"PacketPlayOutPlayerInfo".equals(packet.getClass().getSimpleName())) return;
        try {
            Field entriesField = packet.getClass().getDeclaredField("b");
            entriesField.setAccessible(true);
            List<?> entries = (List<?>) entriesField.get(packet);
            for (Object playerInfo : entries) {
                GameProfile originalProfile = (GameProfile) playerInfo.getClass().getMethod("a").invoke(playerInfo);
                PlayerIdentity identity = activeIdentities.get(originalProfile.getId());
                if (identity == null) {
                    identity = pendingIdentities.get(originalProfile.getName().toLowerCase(Locale.ROOT));
                }
                if (identity == null || originalProfile.getName().equals(identity.displayName)) continue;
                GameProfile displayProfile = new GameProfile(originalProfile.getId(), identity.displayName);
                displayProfile.getProperties().putAll(originalProfile.getProperties());
                Field profileField = playerInfo.getClass().getDeclaredField("d");
                profileField.setAccessible(true);
                profileField.set(playerInfo, displayProfile);
            }
        } catch (ReflectiveOperationException | RuntimeException exception) {
            if (!packetReflectionWarningLogged) {
                packetReflectionWarningLogged = true;
                getLogger().warning("Could not replace an in-game player ID: " + exception.getMessage());
            }
        }
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

    private static Object playerNetworkChannel(Player player) throws ReflectiveOperationException {
        Object handle = player.getClass().getMethod("getHandle").invoke(player);
        Object connection = handle.getClass().getField("playerConnection").get(handle);
        Object networkManager = connection.getClass().getField("networkManager").get(connection);
        return networkManager.getClass().getField("channel").get(networkManager);
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

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onAuthCheck(EaglercraftAuthCheckRequiredEvent event) {
        Ticket ticket = verifyPath(event.getPendingConnection().getWebSocketPath());
        if (ticket == null) {
            event.kickUser("spawnpoint에 로그인한 뒤 게임에 다시 접속하세요.");
            return;
        }
        event.setNicknameSelectionEnabled(false);
        event.setEnableCookieAuth(false);
        event.setAuthRequired(EnumAuthResponse.SKIP);
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onLogin(EaglercraftLoginEvent event) {
        Ticket ticket = verifyPath(event.getLoginConnection().getWebSocketPath());
        if (ticket == null) {
            event.setKickMessage("spawnpoint 접속 정보가 잘못됐거나 만료됐어요. 다시 접속하세요.");
            event.setCancelled(true);
            return;
        }
        // Bukkit owns the offline UUID and rejects setProfileUUID during this event.
        event.setProfileUsername(ticket.username);
        pendingIdentities.put(
            ticket.username.toLowerCase(Locale.ROOT),
            new PlayerIdentity(ticket.accountId, ticket.displayName, ticket.skinPath)
        );
        getServer().getScheduler().runTask(this, () -> {
            Player player = getServer().getPlayerExact(ticket.username);
            if (player != null) applyPendingIdentity(player);
        });
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onSkin(EaglercraftRegisterSkinEvent event) {
        Ticket ticket = verifyPath(event.getLoginConnection().getWebSocketPath());
        if (ticket == null) return;
        EnumSkinModel model = "alex".equals(ticket.skinModel) ? EnumSkinModel.ALEX : EnumSkinModel.STEVE;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) URI.create(portalOrigin + ticket.skinPath).toURL().openConnection();
            connection.setConnectTimeout(2_000);
            connection.setReadTimeout(2_000);
            connection.setUseCaches(false);
            try (InputStream input = connection.getInputStream()) {
                IEaglerPlayerSkin skin = event.getServerAPI()
                    .getSkinService()
                    .getSkinLoader(false)
                    .loadSkinImageData(input, model);
                if (skin.isSuccess()) event.forceSkinEagler(skin);
            }
        } catch (IOException | IllegalArgumentException exception) {
            getLogger().warning("Could not load the spawnpoint skin; continuing with the client skin: " + exception.getMessage());
        } finally {
            if (connection != null) connection.disconnect();
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
            return new Ticket(username, subject, displayName, skinPath, skinModel);
        } catch (GeneralSecurityException | IllegalArgumentException | IllegalStateException exception) {
            return null;
        }
    }

    private static boolean isSafeDisplayName(String value) {
        if (value == null || value.trim().isEmpty() || value.length() > 16) return false;
        return value.codePoints().noneMatch(codePoint -> Character.isISOControl(codePoint) || codePoint == '\u00a7');
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

    private record Ticket(String username, String accountId, String displayName, String skinPath, String skinModel) {}

    private record PlayerIdentity(String accountId, String displayName, String skinPath) {}

    private record LocatorTarget(Player player, Location location, double distanceSquared) {}

    private record PlayerLookup(Player player, boolean duplicateDisplayName) {}

    record CommandTargetName(String displayName, String technicalName) {}

    record CommandRewrite(String message, boolean ambiguousDisplayName) {}

    private record TargetRewrite(String message, boolean ambiguousDisplayName) {}

    private record CommandSpan(int start, int end) {}

    private record TeleportRequest(UUID requesterId, UUID targetId, long expiresAt) {}

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

    private static final class RequestTooLargeException extends Exception {}
}
