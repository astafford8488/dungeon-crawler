// items.js — Item generation, scaling, and inventory management
const Items = (() => {
  let nextId = 1;

  // Rarity order
  const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythical', 'divine'];

  // Generate a concrete item instance from a template + rarity + rank
  function generate(templateId, rarity, rank) {
    const template = Data.cache.equipById[templateId];
    if (!template) return null;
    const sys = Data.cache.itemSystem;
    const rarityData = sys.rarities[rarity];
    const rankData = sys.ranks[String(rank)];
    if (!rarityData || !rankData) return null;

    const rMult = rarityData.multiplier;
    const rkMult = rankData.multiplier;

    // Scale primary stats
    const stats = {};
    if (template.base_stats) {
      for (const [stat, val] of Object.entries(template.base_stats)) {
        stats[stat] = Math.floor(val * rMult * rkMult);
      }
    }

    // Copy resistances (flat, not scaled)
    const resistances = {};
    if (template.base_resistances) {
      Object.assign(resistances, template.base_resistances);
    }

    // Roll bonus effects
    const bonusEffects = [];
    const maxEffects = rarityData.max_bonus_effects;
    if (maxEffects > 0) {
      const effectTier = sys.bonus_effect_tier_by_rank[String(rank)];
      const pools = [...sys.bonus_effect_pool.offensive, ...sys.bonus_effect_pool.defensive, ...sys.bonus_effect_pool.utility];
      // Prefer affinity effects
      const affinityIds = template.bonus_effect_affinity || [];
      const affinityPool = pools.filter(e => affinityIds.includes(e.id));
      const otherPool = pools.filter(e => !affinityIds.includes(e.id));

      const chosen = new Set();
      for (let i = 0; i < maxEffects; i++) {
        let pool = (i === 0 && affinityPool.length > 0) ? affinityPool : [...affinityPool, ...otherPool];
        pool = pool.filter(e => !chosen.has(e.id));
        if (pool.length === 0) break;
        const effect = pool[Math.floor(Math.random() * pool.length)];
        chosen.add(effect.id);
        bonusEffects.push({
          id: effect.id,
          name: effect.name,
          value: effect.values[Math.min(effectTier, effect.values.length - 1)]
        });
      }
    }

    // Generate name
    const prefixes = sys.rarity_prefixes[rarity];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = rankData.suffix;
    let name = template.name;
    if (prefix) name = prefix + ' ' + name;
    if (suffix) name = name + ' ' + suffix;

    // Calculate price: doubles per rarity tier, scales by rank, +20% per enchantment
    const rarityPriceMultiplier = Math.pow(2, rarityData.tier - 1); // 1, 2, 4, 8, 16, 32, 64
    const enchantBonus = 1 + (bonusEffects.length * 0.2);
    const price = Math.floor((template.base_price || 10) * rarityPriceMultiplier * rkMult * enchantBonus);

    // Roll for set bonus (1% chance)
    let setBonus = null;
    const setData = Data.cache.setBonuses;
    if (setData && Math.random() < (setData.drop_chance || 0.01)) {
      const sets = setData.sets;
      setBonus = sets[Math.floor(Math.random() * sets.length)];
      name = `[${setBonus.name}] ${name}`;
    }

    return {
      uid: nextId++,
      templateId: template.id,
      name,
      type: template.type,
      slot: guessSlot(template),
      category: guessCategory(template),
      classes: template.classes,
      description: template.description,
      rarity,
      rank,
      stats,
      resistances,
      bonusEffects,
      setId: setBonus?.id || null,
      setName: setBonus?.name || null,
      price,
      sellPrice: Math.floor(price * 0.4),
      tags: template.tags || []
    };
  }

  function guessSlot(template) {
    if (template.slot) return template.slot;
    if (template.type === 'shield' || template.tags?.includes('shield')) return 'shield';
    if (['sword', 'axe', 'mace', 'hammer', 'dagger', 'short_sword', 'bow', 'crossbow', 'staff', 'wand', 'scepter'].includes(template.type)) return 'weapon';
    if (['heavy', 'medium', 'light', 'cloth'].includes(template.type)) return 'armor';
    if (['ring', 'amulet', 'trinket'].includes(template.type)) return 'accessory';
    if (['tome', 'offhand_weapon', 'quiver', 'focus'].includes(template.type)) return template.type;
    return 'weapon';
  }

  function guessCategory(template) {
    const slot = template.slot || guessSlot(template);
    if (slot === 'weapon') return 'weapon';
    if (slot === 'armor') return 'armor';
    if (slot === 'shield') return 'shield';
    if (slot === 'accessory') return 'accessory';
    if (['tome', 'offhand_weapon', 'quiver', 'focus'].includes(slot)) return 'class_specific';
    return 'weapon';
  }

  // Generate a random item appropriate for a given level
  // Dungeon tier -> max rarity unlocked
  // Each new rarity appears at 80:20 ratio with the previous highest
  // Rarity caps: dungeon tier = items that DROP in that dungeon
  // Tier 1 (Crypt) = common only. After clearing tier 1, uncommon unlocks for tier 2, etc.
  const DUNGEON_RARITY_CAPS = {
    1: 'common',     // Crypt: common only
    2: 'uncommon',   // Thornwood: + uncommon (unlocked after clearing Crypt)
    3: 'rare',       // Iron Horde: + rare
    4: 'epic',       // Infernal: + epic
    5: 'legendary',  // Elemental: + legendary
    6: 'mythical',   // Abyss: + mythical
    7: 'divine',     // Post-game / high difficulty: + divine
  };

  // Rarity weights: 80:20 cascade. Each tier is ~25% of the previous tier's weight
  function getRarityWeights(maxRarityTier) {
    const weights = { common: 80 };
    const tiers = ['uncommon', 'rare', 'epic', 'legendary', 'mythical', 'divine'];
    let prevWeight = 80;
    for (let i = 0; i < tiers.length; i++) {
      if (RARITIES.indexOf(tiers[i]) > maxRarityTier) break;
      prevWeight = Math.max(1, Math.floor(prevWeight * 0.25));
      weights[tiers[i]] = prevWeight;
    }
    return weights;
  }

  function generateRandom(level, allowedCategories, dungeonTier) {
    const pool = Data.cache.allEquipment.filter(t => {
      if (allowedCategories && !allowedCategories.includes(guessCategory(t))) return false;
      return true;
    });
    if (pool.length === 0) return null;

    const template = pool[Math.floor(Math.random() * pool.length)];
    const { rarity, rank } = rollRarityAndRank(level, dungeonTier);
    return generate(template.id, rarity, rank);
  }

  // Roll rarity based on dungeon tier and weights
  function rollRarityAndRank(level, dungeonTier) {
    const maxRarity = DUNGEON_RARITY_CAPS[dungeonTier || 1] || 'uncommon';
    const maxIdx = RARITIES.indexOf(maxRarity);
    const weights = getRarityWeights(maxIdx);

    // Build weighted pool
    const available = RARITIES.filter((r, i) => i <= maxIdx);
    const weightArr = available.map(r => weights[r] || 1);
    const totalWeight = weightArr.reduce((a, b) => a + b, 0);
    let roll = Math.random() * totalWeight;
    let rarity = available[0];
    for (let i = 0; i < available.length; i++) {
      roll -= weightArr[i];
      if (roll <= 0) { rarity = available[i]; break; }
    }

    // Roll rank 1-5, weighted toward lower
    const rankWeights = [40, 25, 18, 12, 5];
    let rankRoll = Math.random() * 100;
    let rank = 1;
    for (let i = 0; i < rankWeights.length; i++) {
      rankRoll -= rankWeights[i];
      if (rankRoll <= 0) { rank = i + 1; break; }
    }
    return { rarity, rank };
  }

  // Generate shop stock for blacksmith — 5 items per party member class
  // maxDungeonTier = highest dungeon tier cleared (determines max rarity in shop)
  function generateShopStock(playerLevel, partyClasses, maxDungeonTier) {
    const items = [];
    const classes = partyClasses || ['warrior', 'mage', 'cleric', 'rogue'];
    const tier = maxDungeonTier || 1;
    const ITEMS_PER_CATEGORY = 2; // per class per category

    for (const classId of classes) {
      // Split templates into categories for balanced generation
      const weapons = Data.cache.allEquipment.filter(t => t.classes?.includes(classId) && ['weapon', 'tome', 'offhand_weapon', 'quiver', 'focus'].includes(guessSlot(t)));
      const armors = Data.cache.allEquipment.filter(t => t.classes?.includes(classId) && ['armor', 'shield'].includes(guessSlot(t)));
      const accessories = Data.cache.allEquipment.filter(t => t.classes?.includes(classId) && guessSlot(t) === 'accessory');

      for (const [pool, count] of [[weapons, ITEMS_PER_CATEGORY], [armors, ITEMS_PER_CATEGORY], [accessories, ITEMS_PER_CATEGORY]]) {
        if (pool.length === 0) continue;
        for (let i = 0; i < count; i++) {
          const template = pool[Math.floor(Math.random() * pool.length)];
          if (!template) continue;
          const { rarity, rank } = rollRarityAndRank(playerLevel, tier);
          const item = generate(template.id, rarity, rank);
          if (item) items.push(item);
        }
      }
    }
    return items;
  }

  // Get stat summary string
  function statSummary(item) {
    const parts = [];
    for (const [stat, val] of Object.entries(item.stats)) {
      if (val === 0) continue;
      const sign = val > 0 ? '+' : '';
      parts.push(`${sign}${val} ${stat.toUpperCase()}`);
    }
    return parts.join(', ');
  }

  function effectSummary(item) {
    return item.bonusEffects.map(e => {
      const val = typeof e.value === 'number' && e.value < 1 ? `${Math.round(e.value * 100)}%` : e.value;
      return `${e.name}: ${val}`;
    }).join(', ');
  }

  function setNextId(id) { nextId = id; }
  function getNextId() { return nextId; }

  return { generate, generateRandom, generateShopStock, rollRarityAndRank, statSummary, effectSummary, RARITIES, DUNGEON_RARITY_CAPS, setNextId, getNextId, guessSlot, guessCategory };
})();
