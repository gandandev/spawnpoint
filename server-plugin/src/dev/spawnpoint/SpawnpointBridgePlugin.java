package dev.spawnpoint;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import net.lax1dude.eaglercraft.backend.server.api.event.IEaglercraftAuthCheckRequiredEvent.EnumAuthResponse;
import net.lax1dude.eaglercraft.backend.server.api.bukkit.event.EaglercraftAuthCheckRequiredEvent;
import net.lax1dude.eaglercraft.backend.server.api.bukkit.event.EaglercraftLoginEvent;
import net.lax1dude.eaglercraft.backend.server.api.bukkit.event.EaglercraftRegisterSkinEvent;
import net.lax1dude.eaglercraft.backend.server.api.skins.EnumSkinModel;
import net.lax1dude.eaglercraft.backend.server.api.skins.IEaglerPlayerSkin;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.java.JavaPlugin;

public final class SpawnpointBridgePlugin extends JavaPlugin implements Listener {
    private byte[] secret;
    private String portalOrigin;
    private boolean awaitingFirstPlayer;

    @Override
    public void onEnable() {
        try {
            this.secret = loadSecret();
        } catch (IOException exception) {
            getLogger().severe("Could not load the shared session secret: " + exception.getMessage());
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        this.portalOrigin = env("PORTAL_INTERNAL_ORIGIN", "http://127.0.0.1:3000").replaceAll("/+$", "");
        this.awaitingFirstPlayer = true;
        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("Site-ticket authentication is active.");
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onFirstPlayerJoin(PlayerJoinEvent event) {
        if (!awaitingFirstPlayer) return;
        awaitingFirstPlayer = false;
        getServer().getWorlds().forEach(world -> world.setTime(1_000L));
        getLogger().info("Set all loaded worlds to morning for the first player.");
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

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onAuthCheck(EaglercraftAuthCheckRequiredEvent event) {
        Ticket ticket = verifyPath(event.getPendingConnection().getWebSocketPath());
        if (ticket == null) {
            event.kickUser("Open spawnpoint, log in, then launch the game again.");
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
            event.setKickMessage("Your spawnpoint launch ticket is invalid or expired.");
            event.setCancelled(true);
            return;
        }
        // Bukkit owns the offline UUID and rejects setProfileUUID during this event.
        event.setProfileUsername(ticket.username);
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
            if (username == null || !username.matches("[A-Za-z0-9_]{3,16}") || subject == null) return null;
            UUID.fromString(subject);
            if (skinPath == null || !(skinPath.startsWith("/api/skins/") || skinPath.startsWith("/assets/skins/"))) return null;
            if (skinPath.contains("..") || skinPath.contains("\\") || skinPath.contains("#")) return null;
            if (!("steve".equals(skinModel) || "alex".equals(skinModel))) return null;
            return new Ticket(username, skinPath, skinModel);
        } catch (GeneralSecurityException | IllegalArgumentException | IllegalStateException exception) {
            return null;
        }
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

    private record Ticket(String username, String skinPath, String skinModel) {}
}
