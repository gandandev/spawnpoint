package dev.spawnpoint.preview;

import com.velocitypowered.api.event.Subscribe;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.UUID;
import java.net.HttpURLConnection;
import java.net.URI;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import net.lax1dude.eaglercraft.backend.server.api.velocity.event.EaglercraftAuthCheckRequiredEvent;
import net.lax1dude.eaglercraft.backend.server.api.velocity.event.EaglercraftLoginEvent;
import net.lax1dude.eaglercraft.backend.server.api.velocity.event.EaglercraftRegisterSkinEvent;
import net.lax1dude.eaglercraft.backend.server.api.event.IEaglercraftAuthCheckRequiredEvent.EnumAuthResponse;
import net.lax1dude.eaglercraft.backend.server.api.skins.EnumSkinModel;
import net.lax1dude.eaglercraft.backend.server.api.IEaglerXServerAPI;
import net.lax1dude.eaglercraft.v1_8.socket.protocol.pkt.server.SPacketInvalidatePlayerCacheV4EAG;

/** HTTP gateway owns account authentication; no browser profile can choose an inventory. */
public final class PreviewIdentity {
    private static boolean managed() { return "true".equals(System.getenv("SPAWNPOINT_PORTAL_MANAGED")); }
    private static String secret() { return System.getenv("SPAWNPOINT_PREVIEW_SECRET"); }
    private static String token(String path) {
        if (path == null || path.indexOf('?') < 0) return null;
        for (String part : path.substring(path.indexOf('?') + 1).split("&")) if (part.startsWith("ticket=")) return part.substring(7);
        return null;
    }
    private JsonObject ticket(String path) {
        try {
            if (secret() == null || secret().length() < 32) return null;
            String token = token(path);
            if (token == null) return null;
            String[] parts = token.split("\\.", -1);
            if (parts.length != 2) return null;
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            if (!MessageDigest.isEqual(mac.doFinal(parts[0].getBytes(StandardCharsets.US_ASCII)), Base64.getUrlDecoder().decode(parts[1]))) return null;
            JsonObject json = JsonParser.parseString(new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8)).getAsJsonObject();
            if (!json.get("aud").getAsString().equals("game") || json.get("exp").getAsLong() <= System.currentTimeMillis() / 1000) return null;
            UUID.fromString(json.get("sub").getAsString());
            if (!json.get("username").getAsString().matches("[A-Za-z0-9_]{3,16}")) return null;
            if (managed()) {
                String skin = json.get("skinPath").getAsString();
                String model = json.get("skinModel").getAsString();
                if (!(skin.startsWith("/api/skins/") || skin.startsWith("/assets/skins/")) || skin.contains("..") || skin.contains("\\") || skin.contains("#")) return null;
                if (!(model.equals("steve") || model.equals("alex"))) return null;
            }
            return json;
        } catch (Exception ignored) { return null; }
    }
    @Subscribe
    public void ready(com.velocitypowered.api.event.proxy.ProxyInitializeEvent event) {
        System.out.println("SPAWNPOINT_PREVIEW_IDENTITY_READY");
    }
    @Subscribe
    public void check(EaglercraftAuthCheckRequiredEvent event) {
        if (ticket(event.getPendingConnection().getWebSocketPath()) == null) {
            event.kickUser("포탈에서 로그인한 뒤 접속하세요."); return;
        }
        event.setNicknameSelectionEnabled(false);
        event.setEnableCookieAuth(false);
        event.setAuthRequired(EnumAuthResponse.SKIP);
    }
    @Subscribe
    public void login(EaglercraftLoginEvent event) {
        String path = event.getLoginConnection().getWebSocketPath();
        JsonObject identity = ticket(path);
        if (identity == null || (managed() && !registerIdentity(token(path)))) {
            event.setCancelled(true);
            event.setKickMessage("접속 정보를 확인하지 못했어요. 포탈에서 다시 접속하세요."); return;
        }
        String name = identity.get("username").getAsString();
        event.setProfileUsername(name);
        event.setProfileUUID(UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8)));
    }
    private boolean registerIdentity(String token) {
        HttpURLConnection connection = null;
        try {
            int port = Integer.parseInt(System.getenv().getOrDefault("SPAWNPOINT_BRIDGE_PORT", "25566"));
            connection = (HttpURLConnection) URI.create("http://127.0.0.1:" + port + "/v1/identity").toURL().openConnection();
            connection.setConnectTimeout(2000); connection.setReadTimeout(3000);
            connection.setRequestMethod("POST"); connection.setDoOutput(true);
            connection.setRequestProperty("Authorization", "Bearer " + secret());
            connection.setRequestProperty("Content-Type", "application/json");
            JsonObject body = new JsonObject(); body.addProperty("ticket", token);
            try (var stream = connection.getOutputStream()) { stream.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            return connection.getResponseCode() == 200;
        } catch (Exception error) { return false; }
        finally { if (connection != null) connection.disconnect(); }
    }
    @Subscribe
    public void skin(EaglercraftRegisterSkinEvent event) {
        if (!managed()) return;
        JsonObject identity = ticket(event.getLoginConnection().getWebSocketPath());
        if (identity == null) return;
        HttpURLConnection connection = null;
        try {
            String origin = System.getenv().getOrDefault("PORTAL_INTERNAL_ORIGIN", "http://127.0.0.1:3000");
            connection = (HttpURLConnection) URI.create(origin + identity.get("skinPath").getAsString()).toURL().openConnection();
            connection.setConnectTimeout(2000); connection.setReadTimeout(3000); connection.setUseCaches(false);
            BufferedImage image;
            try (var input = connection.getInputStream()) { image = ImageIO.read(input); }
            if (image == null || image.getWidth() != 64 || image.getHeight() != 64) throw new IllegalArgumentException("Invalid skin dimensions");
            int[] pixels = image.getRGB(0, 0, 64, 64, null, 0, 64);
            byte[] encoded = new byte[pixels.length * 3];
            for (int i = 0, b = 0; i < pixels.length; i++, b += 3) {
                encoded[b] = (byte) pixels[i]; encoded[b + 1] = (byte) (pixels[i] >>> 8);
                encoded[b + 2] = (byte) (((pixels[i] >>> 17) & 0x7f) | ((pixels[i] >>> 24) & 0x80));
            }
            var model = identity.get("skinModel").getAsString().equals("alex") ? EnumSkinModel.ALEX : EnumSkinModel.STEVE;
            var skin = event.getServerAPI().getSkinService().getSkinLoader(false).loadSkinImageData_eagler(encoded, model);
            if (!skin.isSuccess()) throw new IllegalArgumentException("Skin conversion failed");
            event.forceSkinEagler(skin);
        } catch (Exception error) { System.err.println("Spawnpoint skin load failed: " + error.getClass().getSimpleName()); }
        finally { if (connection != null) connection.disconnect(); }
    }
    @Subscribe
    public void connected(com.velocitypowered.api.event.player.ServerPostConnectEvent event) {
        if (!managed()) return;
        var joining = event.getPlayer().getUniqueId();
        var api = IEaglerXServerAPI.instance(com.velocitypowered.api.proxy.Player.class);
        for (var observer : api.getAllEaglerPlayers()) {
            if (observer.getUniqueId().equals(joining) || observer.getEaglerProtocol().ver < 4) continue;
            observer.sendEaglerMessage(new SPacketInvalidatePlayerCacheV4EAG(true, false, joining.getMostSignificantBits(), joining.getLeastSignificantBits()));
        }
    }
}
