// crafting.js — Salvage items into materials, upgrade items by rank or rarity
const Crafting = (() => {

  // Salvage an item into materials
  function salvage(item) {
    const craftData = Data.cache.crafting;
    const slot = item.slot || Items.guessSlot(item);
    const materialTypes = craftData.salvage_yields.by_slot[slot] || ['metal_scrap'];
    const quantity = item.rank || 1;
    const rarity = item.rarity || 'common';

    const results = [];
    for (const matType of materialTypes) {
      results.push({ id: matType, rarity, quantity });
    }
    // Bonus gem_dust from bonus effects
    if (item.bonusEffects && item.bonusEffects.length > 0) {
      results.push({ id: 'gem_dust', rarity, quantity: item.bonusEffects.length });
    }
    return results;
  }

  // Add materials to player inventory
  function addMaterials(gameState, materials) {
    if (!gameState.materials) gameState.materials = {};
    for (const mat of materials) {
      const key = mat.id + '_' + mat.rarity;
      gameState.materials[key] = (gameState.materials[key] || 0) + mat.quantity;
    }
  }

  // Get material count
  function getMaterialCount(gameState, matId, rarity) {
    if (!gameState.materials) return 0;
    return gameState.materials[matId + '_' + rarity] || 0;
  }

  // Spend materials
  function spendMaterials(gameState, matId, rarity, amount) {
    const key = matId + '_' + rarity;
    if (!gameState.materials || (gameState.materials[key] || 0) < amount) return false;
    gameState.materials[key] -= amount;
    if (gameState.materials[key] <= 0) delete gameState.materials[key];
    return true;
  }

  // Get all materials grouped for display
  function getAllMaterials(gameState) {
    if (!gameState.materials) return [];
    const craftData = Data.cache.crafting;
    const matDefs = {};
    for (const m of craftData.material_types) matDefs[m.id] = m;

    const result = [];
    for (const [key, qty] of Object.entries(gameState.materials)) {
      if (qty <= 0) continue;
      const [id, rarity] = key.split('_').length > 2
        ? [key.substring(0, key.lastIndexOf('_')), key.substring(key.lastIndexOf('_') + 1)]
        : key.split('_');
      // Handle material IDs with underscores
      const lastUnderscore = key.lastIndexOf('_');
      const matId = key.substring(0, lastUnderscore);
      const matRarity = key.substring(lastUnderscore + 1);
      const def = matDefs[matId];
      result.push({
        key,
        id: matId,
        rarity: matRarity,
        name: def ? def.name : matId,
        icon: def ? def.icon : '?',
        quantity: qty,
      });
    }
    return result.sort((a, b) => Items.RARITIES.indexOf(a.rarity) - Items.RARITIES.indexOf(b.rarity));
  }

  // Can we upgrade rank?
  function canUpgradeRank(gameState, item) {
    if (item.rank >= 5) return { can: false, reason: 'Max rank (5)' };
    const craftData = Data.cache.crafting;
    const costKey = item.rank + '_to_' + (item.rank + 1);
    const cost = craftData.upgrade_rank.costs[costKey];
    if (!cost) return { can: false, reason: 'No upgrade path' };

    const slot = item.slot || Items.guessSlot(item);
    const materialTypes = craftData.salvage_yields.by_slot[slot] || ['metal_scrap'];
    const matId = materialTypes[0];
    const matCount = getMaterialCount(gameState, matId, item.rarity);
    const hasGold = gameState.gold >= cost.gold;
    const hasMats = matCount >= cost.materials;

    return {
      can: hasGold && hasMats,
      gold: cost.gold,
      materials: cost.materials,
      matId,
      matRarity: item.rarity,
      hasGold,
      hasMats,
      matCount,
    };
  }

  // Upgrade rank
  function upgradeRank(gameState, item) {
    const check = canUpgradeRank(gameState, item);
    if (!check.can) return false;

    gameState.gold -= check.gold;
    spendMaterials(gameState, check.matId, check.matRarity, check.materials);

    // Upgrade the item in-place
    item.rank++;
    const sys = Data.cache.itemSystem;
    const rankData = sys.ranks[String(item.rank)];
    const rarityData = sys.rarities[item.rarity];
    const template = Data.cache.equipById[item.templateId];

    // Recalculate stats
    if (template && template.base_stats) {
      for (const [stat, val] of Object.entries(template.base_stats)) {
        item.stats[stat] = Math.floor(val * rarityData.multiplier * rankData.multiplier);
      }
    }

    // Update name suffix
    const suffix = rankData.suffix;
    const baseName = template ? template.name : item.name.split(' ').slice(-1)[0];
    const prefixes = sys.rarity_prefixes[item.rarity];
    const prefix = item.name.split(' ')[0];
    item.name = (prefixes.includes(prefix) ? prefix + ' ' : '') + baseName + (suffix ? ' ' + suffix : '');

    // Update price
    item.price = Math.floor((template?.base_price || 10) * rarityData.sell_multiplier * rankData.multiplier);
    item.sellPrice = Math.floor(item.price * 0.4);

    return true;
  }

  // Can we upgrade rarity?
  function canUpgradeRarity(gameState, item) {
    if (item.rank < 5) return { can: false, reason: 'Must be rank 5 first' };
    const rarIdx = Items.RARITIES.indexOf(item.rarity);
    if (rarIdx >= Items.RARITIES.length - 1) return { can: false, reason: 'Max rarity' };

    const nextRarity = Items.RARITIES[rarIdx + 1];
    const craftData = Data.cache.crafting;
    const costKey = item.rarity + '_to_' + nextRarity;
    const cost = craftData.upgrade_rarity.costs[costKey];
    if (!cost) return { can: false, reason: 'No upgrade path' };

    const slot = item.slot || Items.guessSlot(item);
    const materialTypes = craftData.salvage_yields.by_slot[slot] || ['metal_scrap'];
    const matId = materialTypes[0];
    // Rarity upgrade requires materials of the NEXT rarity
    const matCount = getMaterialCount(gameState, matId, nextRarity);
    const hasGold = gameState.gold >= cost.gold;
    const hasMats = matCount >= cost.materials;

    return {
      can: hasGold && hasMats,
      gold: cost.gold,
      materials: cost.materials,
      matId,
      matRarity: nextRarity,
      nextRarity,
      hasGold,
      hasMats,
      matCount,
    };
  }

  // Upgrade rarity (resets rank to 1)
  function upgradeRarity(gameState, item) {
    const check = canUpgradeRarity(gameState, item);
    if (!check.can) return false;

    gameState.gold -= check.gold;
    spendMaterials(gameState, check.matId, check.matRarity, check.materials);

    // Upgrade rarity, reset rank to 1
    item.rarity = check.nextRarity;
    item.rank = 1;

    const sys = Data.cache.itemSystem;
    const rankData = sys.ranks['1'];
    const rarityData = sys.rarities[item.rarity];
    const template = Data.cache.equipById[item.templateId];

    // Recalculate stats
    if (template && template.base_stats) {
      for (const [stat, val] of Object.entries(template.base_stats)) {
        item.stats[stat] = Math.floor(val * rarityData.multiplier * rankData.multiplier);
      }
    }

    // Roll new bonus effects for higher rarity
    const maxEffects = rarityData.max_bonus_effects;
    item.bonusEffects = [];
    if (maxEffects > 0) {
      const effectTier = sys.bonus_effect_tier_by_rank['1'];
      const pools = [...sys.bonus_effect_pool.offensive, ...sys.bonus_effect_pool.defensive, ...sys.bonus_effect_pool.utility];
      const affinityIds = template?.bonus_effect_affinity || [];
      const affinityPool = pools.filter(e => affinityIds.includes(e.id));
      const chosen = new Set();
      for (let i = 0; i < maxEffects; i++) {
        let pool = (i === 0 && affinityPool.length > 0) ? affinityPool : pools;
        pool = pool.filter(e => !chosen.has(e.id));
        if (pool.length === 0) break;
        const effect = pool[Math.floor(Math.random() * pool.length)];
        chosen.add(effect.id);
        item.bonusEffects.push({
          id: effect.id,
          name: effect.name,
          value: effect.values[Math.min(effectTier, effect.values.length - 1)]
        });
      }
    }

    // Update name
    const prefixes = sys.rarity_prefixes[item.rarity];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const baseName = template ? template.name : item.name;
    item.name = (prefix ? prefix + ' ' : '') + baseName;

    item.price = Math.floor((template?.base_price || 10) * rarityData.sell_multiplier * rankData.multiplier);
    item.sellPrice = Math.floor(item.price * 0.4);

    return true;
  }

  return { salvage, addMaterials, getMaterialCount, spendMaterials, getAllMaterials, canUpgradeRank, upgradeRank, canUpgradeRarity, upgradeRarity };
})();
