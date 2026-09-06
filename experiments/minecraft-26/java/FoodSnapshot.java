package dev.spawnpoint;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import io.papermc.paper.datacomponent.DataComponentTypes;
import io.papermc.paper.datacomponent.item.FoodProperties;
import io.papermc.paper.datacomponent.item.Consumable;
import io.papermc.paper.datacomponent.item.consumable.ConsumeEffect;
import org.bukkit.GameRules;
import org.bukkit.Difficulty;
import org.bukkit.attribute.Attribute;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

/** Food and healing inputs read on the Paper main thread. */
final class FoodSnapshot {
    private FoodSnapshot() {}

    static JsonObject of(Player viewer) {
        JsonObject food = new JsonObject();
        food.addProperty("level", viewer.getFoodLevel());
        food.addProperty("saturation", viewer.getSaturation());
        food.addProperty("exhaustion", viewer.getExhaustion());
        food.addProperty("health", viewer.getHealth());
        food.addProperty("maxHealth", viewer.getAttribute(Attribute.MAX_HEALTH).getValue());
        food.addProperty("naturalRegeneration", Boolean.TRUE.equals(viewer.getWorld().getGameRuleValue(GameRules.NATURAL_HEALTH_REGENERATION)));
        food.addProperty("healthPredictionSafe", viewer.getWorld().getDifficulty() != Difficulty.PEACEFUL
            && !viewer.hasPotionEffect(PotionEffectType.POISON) && !viewer.hasPotionEffect(PotionEffectType.WITHER)
            && !viewer.hasPotionEffect(PotionEffectType.REGENERATION) && !viewer.hasPotionEffect(PotionEffectType.HUNGER));
        food.add("mainHand", snapshotFood(viewer.getInventory().getItemInMainHand()));
        food.add("offHand", snapshotFood(viewer.getInventory().getItemInOffHand()));
        return food;
    }

    private static JsonElement snapshotFood(ItemStack stack) {
        FoodProperties properties = stack.getData(DataComponentTypes.FOOD);
        if (properties == null || !stack.hasData(DataComponentTypes.CONSUMABLE)) return com.google.gson.JsonNull.INSTANCE;
        JsonObject result = new JsonObject();
        result.addProperty("nutrition", properties.nutrition());
        result.addProperty("saturation", properties.saturation());
        result.addProperty("canAlwaysEat", properties.canAlwaysEat());
        Consumable consumable = stack.getData(DataComponentTypes.CONSUMABLE);
        double regeneration = 0;
        boolean predictable = true;
        for (ConsumeEffect effect : consumable.consumeEffects()) {
            if (!(effect instanceof ConsumeEffect.ApplyStatusEffects applied)) continue;
            for (PotionEffect status : applied.effects()) {
                PotionEffectType type = status.getType();
                if (type.equals(PotionEffectType.REGENERATION)) {
                    if (applied.probability() < 1 || status.isInfinite()) predictable = false;
                    else regeneration = Math.max(regeneration, Math.floor((double) status.getDuration()
                        / (status.getAmplifier() >= 6 ? 1 : Math.max(50 >> status.getAmplifier(), 1))));
                } else if (type.equals(PotionEffectType.POISON) || type.equals(PotionEffectType.WITHER)
                    || type.equals(PotionEffectType.HUNGER) || type.equals(PotionEffectType.INSTANT_DAMAGE)
                    || type.equals(PotionEffectType.INSTANT_HEALTH) || type.equals(PotionEffectType.SATURATION)) {
                    if (applied.probability() > 0) predictable = false;
                }
            }
        }
        result.addProperty("regeneration", regeneration);
        result.addProperty("predictable", predictable);
        return result;
    }

}
