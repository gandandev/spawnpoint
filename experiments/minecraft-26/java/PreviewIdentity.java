package dev.spawnpoint.preview;

import com.velocitypowered.api.event.Subscribe;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import net.lax1dude.eaglercraft.backend.server.api.velocity.event.EaglercraftAuthCheckRequiredEvent;
import net.lax1dude.eaglercraft.backend.server.api.velocity.event.EaglercraftLoginEvent;
import net.lax1dude.eaglercraft.backend.server.api.event.IEaglercraftAuthCheckRequiredEvent.EnumAuthResponse;

/** The HTTP gateway supplies a signed identity; browser profile names are never trusted. */
public final class PreviewIdentity {
    @Subscribe
    public void ready(com.velocitypowered.api.event.proxy.ProxyInitializeEvent event) {
        System.out.println("SPAWNPOINT_PREVIEW_IDENTITY_READY");
    }
    private String username(String path) {
        try {
            String secret = System.getenv("SPAWNPOINT_PREVIEW_SECRET");
            if (secret == null || secret.length() < 32 || path == null) return null;
            String token = null;
            int query = path.indexOf('?');
            if (query < 0) return null;
            for (String part : path.substring(query + 1).split("&")) {
                if (part.startsWith("ticket=")) token = part.substring(7);
            }
            if (token == null) return null;
            String[] parts = token.split("\\.", -1);
            if (parts.length != 2) return null;
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            if (!MessageDigest.isEqual(mac.doFinal(parts[0].getBytes(StandardCharsets.US_ASCII)), Base64.getUrlDecoder().decode(parts[1]))) return null;
            var json = JsonParser.parseString(new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8)).getAsJsonObject();
            if (!json.get("aud").getAsString().equals("game") || json.get("exp").getAsLong() <= System.currentTimeMillis() / 1000) return null;
            UUID.fromString(json.get("sub").getAsString());
            String name = json.get("username").getAsString();
            return name.matches("[A-Za-z0-9_]{3,16}") ? name : null;
        } catch (Exception ignored) { return null; }
    }
    @Subscribe
    public void check(EaglercraftAuthCheckRequiredEvent event) {
        if (username(event.getPendingConnection().getWebSocketPath()) == null) {
            event.kickUser("테스트 페이지에서 로그인한 뒤 접속하세요.");
            return;
        }
        event.setNicknameSelectionEnabled(false);
        event.setEnableCookieAuth(false);
        event.setAuthRequired(EnumAuthResponse.SKIP);
    }
    @Subscribe
    public void login(EaglercraftLoginEvent event) {
        String name = username(event.getLoginConnection().getWebSocketPath());
        if (name == null) {
            event.setCancelled(true);
            event.setKickMessage("접속 정보가 만료됐어요. 다시 로그인하세요.");
            return;
        }
        event.setProfileUsername(name);
        event.setProfileUUID(UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8)));
    }
}
