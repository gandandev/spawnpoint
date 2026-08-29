package dev.spawnpoint;

import java.text.Normalizer;
import java.util.List;

public final class CommandRewriteTest {
    private static final String ADMIN = "sp_aaaaaaaaaaaaa";
    private static final String FRIEND = "sp_bbbbbbbbbbbbb";
    private static final String MOSS_RUNNER = "sp_ccccccccccccc";
    private static final String MOSS = "sp_ddddddddddddd";
    private static final List<SpawnpointBridgePlugin.CommandTargetName> TARGETS = List.of(
        new SpawnpointBridgePlugin.CommandTargetName("관리자", ADMIN),
        new SpawnpointBridgePlugin.CommandTargetName("친구", FRIEND),
        new SpawnpointBridgePlugin.CommandTargetName("이끼 러너", MOSS_RUNNER),
        new SpawnpointBridgePlugin.CommandTargetName("이끼", MOSS)
    );

    public static void main(String[] args) {
        assertRewrite("/tell " + FRIEND + " 안녕 친구", "/tell 친구 안녕 친구");
        assertRewrite("/minecraft:msg " + FRIEND + " 반가워", "/minecraft:msg 친구 반가워");
        assertRewrite("/ban " + FRIEND, "/ban 친구");
        assertRewrite("/tell " + MOSS_RUNNER + " 안녕", "/tell 이끼 러너 안녕");
        assertRewrite("/tell " + MOSS + " 러너 안녕", "/tell \"이끼\" 러너 안녕");
        assertRewrite("/tp " + ADMIN + " " + FRIEND, "/tp 관리자 친구");
        assertRewrite("/gamemode creative " + ADMIN, "/gamemode creative 관리자");
        assertRewrite(
            "/playsound minecraft:block.note.harp master " + ADMIN + " ~ ~ ~ 1",
            "/playsound minecraft:block.note.harp master 관리자 ~ ~ ~ 1"
        );
        assertRewrite(
            "/scoreboard players operation " + ADMIN + " 점수 += " + FRIEND + " 점수",
            "/scoreboard players operation 관리자 점수 += 친구 점수"
        );
        assertRewrite("/tell @a 안녕", "/tell @a 안녕");
        assertRewrite("/tell " + FRIEND + " 안녕", "/tell " + FRIEND + " 안녕");
        assertRewrite("/say 친구", "/say 친구");

        String decomposedFriend = Normalizer.normalize("친구", Normalizer.Form.NFD);
        assertRewrite("/tell " + FRIEND + " 안녕", "/tell " + decomposedFriend + " 안녕");

        List<SpawnpointBridgePlugin.CommandTargetName> duplicates = List.of(
            new SpawnpointBridgePlugin.CommandTargetName("중복", ADMIN),
            new SpawnpointBridgePlugin.CommandTargetName("중복", FRIEND)
        );
        SpawnpointBridgePlugin.CommandRewrite ambiguous = SpawnpointBridgePlugin.rewriteDisplayNameCommand(
            "/tell 중복 안녕",
            duplicates
        );
        if (!ambiguous.ambiguousDisplayName() || !"/tell 중복 안녕".equals(ambiguous.message())) {
            throw new AssertionError("duplicate display names must stop the command");
        }
        System.out.println("plugin command rewrite tests passed");
    }

    private static void assertRewrite(String expected, String input) {
        SpawnpointBridgePlugin.CommandRewrite rewrite = SpawnpointBridgePlugin.rewriteDisplayNameCommand(input, TARGETS);
        if (rewrite.ambiguousDisplayName() || !expected.equals(rewrite.message())) {
            throw new AssertionError("expected <" + expected + "> but got <" + rewrite.message() + ">");
        }
    }
}
