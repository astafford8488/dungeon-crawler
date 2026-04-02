// party.js — Party member creation, stats, leveling, equipment
const Party = (() => {
  const CLASS_ICONS = { warrior: '&#9876;', mage: '&#9733;', rogue: '&#9760;', cleric: '&#10010;', ranger: '&#127993;', paladin: '&#9768;', necromancer: '&#128128;', beastlord: '&#128058;', elementalist: '&#127752;', auramancer: '&#10024;', witch: '&#127769;', shadowknight: '&#128737;' };

  // Default starting weapons by class
  const STARTING_WEAPONS = {
    warrior: 'iron_sword',
    mage: 'oak_staff',
    rogue: 'steel_dagger',
    cleric: 'flanged_mace',
    ranger: 'hunting_bow',
    paladin: 'iron_sword',
    necromancer: 'oak_staff',
    beastlord: 'hunting_bow',
    elementalist: 'oak_staff',
    auramancer: 'scepter',
    witch: 'wand',
    shadowknight: 'iron_sword',
  };

  // Create a new party member from a class definition
  function createMember(classId) {
    const cls = Data.cache.classes[classId];
    if (!cls) return null;
    const member = {
      id: classId + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      classId,
      name: cls.name,
      level: 1,
      xp: 0,
      xpToNext: xpForLevel(2),
      formation: null, // set when added to party: 'front_left', 'front_right', 'back_left', 'back_right'
      abilitySlots: [], // ordered active abilities (priority queue)
      passiveSlots: [], // passive/aura abilities
      maxActiveSlots: 4,
      maxPassiveSlots: 2,
      primaryStats: { ...cls.primary_stats, wis: cls.primary_stats.wis || 5 },
      equipment: {},
      abilities: [],
      abilityData: {},
      abilityUpgrades: {},
      unspentStatPoints: 0,
      pendingAbilityChoices: [],
      derived: {},
      resistances: {},
    };

    // Add level 1 ability choices from pool (if pool exists)
    const pools = Data.cache.abilityPools?.[classId];
    if (pools?.tier_1) {
      member.pendingAbilityChoices.push({
        tier: 'tier_1',
        level: 1,
        choices: pools.tier_1.choices,
      });
      // Give default starting abilities so they can fight immediately
      // If default_all, give first 2 (e.g. cleric gets both Smite and Heal)
      const numDefaults = pools.tier_1.default_all ? 2 : 1;
      for (let i = 0; i < Math.min(numDefaults, pools.tier_1.choices.length); i++) {
        const ab = pools.tier_1.choices[i];
        if (!member.abilities.includes(ab.id)) {
          member.abilities.push(ab.id);
          member.abilityData[ab.id] = ab;
          if (ab.type === 'passive' || ab.type === 'aura') {
            if (member.passiveSlots.length < (member.maxPassiveSlots || 2)) member.passiveSlots.push(ab.id);
          } else {
            if (member.abilitySlots.length < (member.maxActiveSlots || 4)) member.abilitySlots.push(ab.id);
          }
        }
      }
    } else {
      // Fallback: use class abilities from JSON (for classes without pool entries)
      // Give first level 1 ability as default, then present all as choices
      const level1Abilities = cls.abilities.filter(ab => ab.level_required <= 1);
      if (level1Abilities.length > 0) {
        // Grant first ability so they can fight
        const firstAb = level1Abilities[0];
        member.abilities.push(firstAb.id);
        member.abilityData[firstAb.id] = firstAb;
        if (firstAb.type === 'passive' || firstAb.type === 'aura') {
          if (member.passiveSlots.length < (member.maxPassiveSlots || 2)) member.passiveSlots.push(firstAb.id);
        } else {
          if (member.abilitySlots.length < (member.maxActiveSlots || 4)) member.abilitySlots.push(firstAb.id);
        }
        // Present all level 1 abilities as choices (including upgrades to the default)
        member.pendingAbilityChoices.push({
          tier: 'level_1',
          level: 1,
          choices: level1Abilities,
        });
      }
    }

    // Equip starting weapon (Common Rank 1)
    const weaponId = STARTING_WEAPONS[classId];
    if (weaponId) {
      const weapon = Items.generate(weaponId, 'common', 1);
      if (weapon) {
        member.equipment[weapon.slot || 'weapon'] = weapon;
      }
    }

    return member;
  }

  // XP curve: fast early, exponentially slower
  // ~1 dungeon run per level early, ~2 in teens, ~4 in 20s, ~8 in 30s, ~16 in 40s, ~32 in 50s
  function xpForLevel(level) {
    if (level <= 1) return 30;
    if (level <= 10) return Math.floor(30 + level * 15);
    if (level <= 20) return Math.floor(80 * Math.pow(1.12, level));
    return Math.floor(80 * Math.pow(1.18, level));
  }

  // Points granted per level up
  const STAT_POINTS_PER_LEVEL = 4;

  // Add XP, return { leveled, newLevel, newAbilities }
  function addXp(member, amount) {
    // Initialize tracking fields if missing
    if (member.unspentStatPoints === undefined) member.unspentStatPoints = 0;
    if (member.pendingAbilities === undefined) member.pendingAbilities = [];

    member.xp += amount;
    const result = { leveled: false, newLevel: member.level, newAbilities: [] };
    while (member.xp >= member.xpToNext) {
      member.xp -= member.xpToNext;
      member.level++;
      member.xpToNext = xpForLevel(member.level + 1);
      result.leveled = true;
      result.newLevel = member.level;

      // Grant stat points for manual allocation
      member.unspentStatPoints += STAT_POINTS_PER_LEVEL;

      // Check ability pool milestones
      const pools = Data.cache.abilityPools?.[member.classId];
      if (pools) {
        for (const [tierKey, tier] of Object.entries(pools)) {
          if (tier.level === member.level) {
            if (!member.pendingAbilityChoices) member.pendingAbilityChoices = [];
            member.pendingAbilityChoices.push({
              tier: tierKey,
              level: tier.level,
              choices: tier.choices,
            });
            result.newAbilities.push({ name: `Ability choices at level ${tier.level}` });
          }
        }
      } else {
        // Fallback: offer class JSON abilities as choices at their level_required
        const cls = Data.cache.classes[member.classId];
        if (cls) {
          const levelAbilities = cls.abilities.filter(ab => ab.level_required === member.level && !member.abilities.includes(ab.id));
          if (levelAbilities.length > 0) {
            if (!member.pendingAbilityChoices) member.pendingAbilityChoices = [];
            // Include already-known abilities as upgrade options
            const knownAtLevel = member.abilities.map(aid => member.abilityData?.[aid] || cls.abilities.find(a => a.id === aid)).filter(Boolean);
            const allChoices = [...levelAbilities, ...knownAtLevel.filter(a => a.type !== 'passive' && a.type !== 'aura')];
            member.pendingAbilityChoices.push({
              tier: 'level_' + member.level,
              level: member.level,
              choices: allChoices,
            });
            result.newAbilities.push({ name: `Ability choices at level ${member.level}` });
          }
        }
      }
    }
    return result;
  }

  // Allocate a stat point
  function allocateStatPoint(member, stat) {
    if (!member.unspentStatPoints || member.unspentStatPoints <= 0) return false;
    if (!['str', 'int', 'dex', 'sta', 'wis'].includes(stat)) return false;
    member.primaryStats[stat]++;
    member.unspentStatPoints--;
    recalcDerived(member);
    return true;
  }

  // Learn a pending ability
  function learnAbility(member, abilityId) {
    if (!member.pendingAbilities) return false;
    const idx = member.pendingAbilities.findIndex(a => a.id === abilityId);
    if (idx === -1) return false;
    member.abilities.push(abilityId);
    member.pendingAbilities.splice(idx, 1);
    return true;
  }

  // Check if member needs level-up attention
  function needsLevelUp(member) {
    return (member.unspentStatPoints > 0) || (member.pendingAbilities && member.pendingAbilities.length > 0) || (member.pendingAbilityChoices && member.pendingAbilityChoices.length > 0);
  }

  // Choose an ability from a pending tier choice (or upgrade existing)
  function chooseAbility(member, choiceIndex, abilityId) {
    if (!member.pendingAbilityChoices || !member.pendingAbilityChoices[choiceIndex]) return false;
    const choice = member.pendingAbilityChoices[choiceIndex];
    const ability = choice.choices.find(a => a.id === abilityId);
    if (!ability) return false;
    // If already known, upgrade it
    if (member.abilities.includes(abilityId)) {
      if (!member.abilityUpgrades) member.abilityUpgrades = {};
      member.abilityUpgrades[abilityId] = (member.abilityUpgrades[abilityId] || 0) + 1;
    } else {
      member.abilities.push(abilityId);
    }
    // Store ability data for reference
    if (!member.abilityData) member.abilityData = {};
    member.abilityData[abilityId] = ability;
    member.pendingAbilityChoices.splice(choiceIndex, 1);
    return true;
  }

  // Get ability definition from pool data or class data
  function getAbilityFromPool(member, abilityId) {
    return member.abilityData?.[abilityId] || null;
  }

  // Equip an item, returns the old item (or null)
  function equip(member, item) {
    const slot = item.slot || Items.guessSlot(item);
    if (!canEquip(member, item)) return null;
    const old = member.equipment[slot] || null;
    member.equipment[slot] = item;
    recalcDerived(member);
    return old;
  }

  function unequip(member, slot) {
    const old = member.equipment[slot] || null;
    delete member.equipment[slot];
    recalcDerived(member);
    return old;
  }

  function canEquip(member, item) {
    if (item.classes && !item.classes.includes(member.classId)) return false;
    const cls = Data.cache.classes[member.classId];
    const slot = item.slot || Items.guessSlot(item);
    if (!cls.equipment_slots.includes(slot)) return false;
    return true;
  }

  // Recalculate derived stats from primary + equipment
  function recalcDerived(member) {
    const cls = Data.cache.classes[member.classId];
    const sys = Data.cache.statSystem;

    // Totals: base primary + equipment bonuses
    const total = { str: member.primaryStats.str, int: member.primaryStats.int, dex: member.primaryStats.dex, sta: member.primaryStats.sta, wis: member.primaryStats.wis || 0 };
    const flatDerived = { ...cls.base_derived_bonuses };
    const resists = { ...cls.base_resistances };

    // Add equipment stats
    for (const item of Object.values(member.equipment)) {
      if (!item) continue;
      for (const [stat, val] of Object.entries(item.stats || {})) {
        if (total[stat] !== undefined) total[stat] += val;
      }
      for (const [res, val] of Object.entries(item.resistances || {})) {
        resists[res] = (resists[res] || 0) + val;
      }
      // Bonus effects that grant stats
      for (const eff of (item.bonusEffects || [])) {
        if (eff.id === 'hp_regen') flatDerived.hp_regen = (flatDerived.hp_regen || 0) + eff.value;
        if (eff.id === 'mp_regen') flatDerived.mp_regen = (flatDerived.mp_regen || 0) + eff.value;
        if (eff.id === 'crit_chance') flatDerived.crit_rate = (flatDerived.crit_rate || 0.05) + eff.value;
        if (eff.id === 'dodge_chance') flatDerived.dodge = (flatDerived.dodge || 0) + eff.value;
        if (eff.id === 'heal_bonus') flatDerived.heal_bonus = (flatDerived.heal_bonus || 0) + eff.value;
        if (eff.id === 'cooldown_reduction') flatDerived.cdr = (flatDerived.cdr || 0) + eff.value;
        if (eff.id === 'damage_reduction') flatDerived.dmg_red = (flatDerived.dmg_red || 0) + eff.value;
        if (eff.id === 'lifesteal') flatDerived.lifesteal = (flatDerived.lifesteal || 0) + eff.value;
        if (eff.id === 'double_strike') flatDerived.double_strike = (flatDerived.double_strike || 0) + eff.value;
        if (eff.id === 'armor_pierce') flatDerived.armor_pierce = (flatDerived.armor_pierce || 0) + eff.value;
        if (eff.id === 'spd_bonus') total.dex += eff.value; // speed bonus goes to dex
        if (eff.id.endsWith('_damage')) flatDerived[eff.id] = (flatDerived[eff.id] || 0) + eff.value;
        if (eff.id === 'gold_bonus') flatDerived.gold_bonus = (flatDerived.gold_bonus || 0) + eff.value;
        if (eff.id === 'xp_bonus') flatDerived.xp_bonus = (flatDerived.xp_bonus || 0) + eff.value;
        if (eff.id === 'magic_resist') {
          for (const r of ['fire_resist', 'ice_resist', 'lightning_resist', 'dark_resist']) {
            resists[r] = (resists[r] || 0) + eff.value;
          }
        }
      }
    }

    // Calculate derived stats from formulas
    const derived = {};
    derived.hp = Math.floor((flatDerived.hp || 0) + total.sta * 5.0);
    derived.mp = Math.floor((flatDerived.mp || 0) + total.int * 2.0);
    derived.phys_atk = Math.floor((flatDerived.phys_atk || 0) + total.str * 2.0);
    derived.mag_atk = Math.floor((flatDerived.mag_atk || 0) + total.int * 2.0);
    derived.dex_atk = Math.floor((flatDerived.phys_atk || 0) + total.dex * 2.0); // DEX-based attack for rogues/rangers
    derived.phys_def = Math.floor((flatDerived.phys_def || 0) + total.str * 0.5 + total.sta * 0.8);
    derived.mag_def = Math.floor((flatDerived.mag_def || 0) + total.int * 1.0 + total.sta * 0.3);
    derived.spd = Math.floor((flatDerived.spd || 0) + total.dex * 1.5);
    derived.crit_rate = Math.min(0.75, (flatDerived.crit_rate || 0.05) + total.dex * 0.002);
    derived.dodge = Math.min(0.50, (flatDerived.dodge || 0) + total.dex * 0.002);
    derived.heal_power = Math.floor((flatDerived.heal_power || 0) + total.int * 1.5);

    // Wisdom contributions
    derived.mp = derived.mp + Math.floor(total.wis * 1.0); // +1 MP per WIS

    // Copy flat extras
    derived.hp_regen = flatDerived.hp_regen || 0;
    derived.mp_regen = (flatDerived.mp_regen || 0) + Math.floor(total.wis * 0.5); // +0.5 MP regen per WIS
    derived.heal_bonus = flatDerived.heal_bonus || 0;
    derived.cdr = flatDerived.cdr || 0;
    derived.dmg_red = flatDerived.dmg_red || 0;
    derived.lifesteal = flatDerived.lifesteal || 0;
    derived.double_strike = flatDerived.double_strike || 0;
    derived.armor_pierce = flatDerived.armor_pierce || 0;
    derived.gold_bonus = flatDerived.gold_bonus || 0;
    derived.xp_bonus = flatDerived.xp_bonus || 0;

    // Wisdom adds holy and dark resist
    resists.holy_resist = (resists.holy_resist || 0) + total.wis * 0.002;
    resists.dark_resist = (resists.dark_resist || 0) + total.wis * 0.002;

    // Cap resistances at 0.75
    for (const [r, v] of Object.entries(resists)) {
      resists[r] = Math.min(0.75, v);
    }

    member.derived = derived;
    member.totalPrimary = total;
    member.resistances = resists;

    // Also compute base stats (without equipment) for comparison
    const basePrimary = { ...member.primaryStats };
    const baseFlatDerived = { ...cls.base_derived_bonuses };
    const baseDerived = {};
    baseDerived.hp = Math.floor((baseFlatDerived.hp || 0) + basePrimary.sta * 5.0);
    baseDerived.mp = Math.floor((baseFlatDerived.mp || 0) + basePrimary.int * 2.0);
    baseDerived.phys_atk = Math.floor((baseFlatDerived.phys_atk || 0) + basePrimary.str * 2.0);
    baseDerived.mag_atk = Math.floor((baseFlatDerived.mag_atk || 0) + basePrimary.int * 2.0);
    baseDerived.phys_def = Math.floor((baseFlatDerived.phys_def || 0) + basePrimary.str * 0.5 + basePrimary.sta * 0.8);
    baseDerived.mag_def = Math.floor((baseFlatDerived.mag_def || 0) + basePrimary.int * 1.0 + basePrimary.sta * 0.3);
    baseDerived.spd = Math.floor((baseFlatDerived.spd || 0) + basePrimary.dex * 1.5);
    baseDerived.crit_rate = Math.min(0.75, (baseFlatDerived.crit_rate || 0.05) + basePrimary.dex * 0.002);
    baseDerived.dodge = Math.min(0.50, (baseFlatDerived.dodge || 0) + basePrimary.dex * 0.002);
    baseDerived.heal_power = Math.floor((baseFlatDerived.heal_power || 0) + basePrimary.int * 1.5);
    baseDerived.mp = baseDerived.mp + Math.floor((basePrimary.wis || 0) * 1.0);
    baseDerived.mp_regen = (baseFlatDerived.mp_regen || 0) + Math.floor((basePrimary.wis || 0) * 0.5);
    member.baseDerived = baseDerived;
    member.baseResistances = { ...cls.base_resistances };

    return derived;
  }

  function getClassIcon(classId) {
    return CLASS_ICONS[classId] || '?';
  }

  function getAbility(member, abilityId) {
    // Check stored pool data first, then class data
    if (member.abilityData?.[abilityId]) return member.abilityData[abilityId];
    const cls = Data.cache.classes[member.classId];
    return cls.abilities.find(a => a.id === abilityId);
  }

  function getAllAbilities(member) {
    const cls = Data.cache.classes[member.classId];
    return cls.abilities;
  }

  return { createMember, addXp, allocateStatPoint, learnAbility, chooseAbility, getAbilityFromPool, needsLevelUp, equip, unequip, canEquip, recalcDerived, xpForLevel, getClassIcon, getAbility, getAllAbilities, CLASS_ICONS, STAT_POINTS_PER_LEVEL };
})();
