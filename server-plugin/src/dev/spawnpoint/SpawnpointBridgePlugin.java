package dev.spawnpoint;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
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
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.plugin.java.JavaPlugin;

public final class SpawnpointBridgePlugin extends JavaPlugin implements Listener {
    private byte[] secret;
    private String portalOrigin;

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
        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("Site-ticket authentication is active.");
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
        Ticket ticket = verifyPath(event.getLoginConnection().asEaglerPlayer().getWebSocketPath());
        if (ticket == null) {
            event.setKickMessage("Your spawnpoint launch ticket is invalid or expired.");
            event.setCancelled(true);
            return;
        }
        event.setProfileUsername(ticket.username);
        event.setProfileUUID(ticket.profileId);
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onSkin(EaglercraftRegisterSkinEvent event) {
        Ticket ticket = verifyPath(event.getLoginConnection().asEaglerPlayer().getWebSocketPath());
        if (ticket == null) return;
        EnumSkinModel model = "alex".equals(ticket.skinModel) ? EnumSkinModel.ALEX : EnumSkinModel.STEVE;
        event.forceSkinFromURL(portalOrigin + ticket.skinPath, model);
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
            UUID profileId = UUID.fromString(subject);
            if (skinPath == null || !(skinPath.startsWith("/api/skins/") || skinPath.startsWith("/assets/skins/"))) return null;
            if (skinPath.contains("..") || skinPath.contains("\\") || skinPath.contains("#")) return null;
            if (!("steve".equals(skinModel) || "alex".equals(skinModel))) return null;
            return new Ticket(username, profileId, skinPath, skinModel);
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

    private record Ticket(String username, UUID profileId, String skinPath, String skinModel) {}
}
