// dungeon.js — Dungeon run management, encounter generation, loot
const Dungeon = (() => {
  let current = null; // current dungeon run state

  function startRun(dungeonId, difficulty) {
    const dungeon = Data.cache.dungeonsById[dungeonId];
    if (!dungeon) return null;

    const scaleMult = 1 + (difficulty - 1) * 0.25;
    const recLevel = dungeon.base_level + (difficulty - 1) * 3;

    // Build encounter list based on difficulty
    const waves = dungeon.encounter_waves.filter(w =>
      !w.difficulty_slider_min || difficulty >= w.difficulty_slider_min
    );

    // Scale enemies for each wave
    const encounters = waves.map(wave => {
      const enemies = [];
      for (const entry of wave.fixed_enemies) {
        for (let i = 0; i < entry.count; i++) {
          const monster = JSON.parse(JSON.stringify(Data.cache.monstersById[entry.id]));
          if (!monster) continue;

          // Scale stats
          monster.scaledStats = {};
          for (const [stat, val] of Object.entries(monster.primary_stats)) {
            monster.scaledStats[stat] = Math.floor(val * scaleMult);
          }
          monster.scaledResistances = { ...monster.base_resistances };

          // Elite upgrade
          if (entry.elite) {
            const eliteMult = Data.cache.encounterSystem.elite_monsters.stat_multiplier;
            for (const stat of Object.keys(monster.scaledStats)) {
              monster.scaledStats[stat] = Math.floor(monster.scaledStats[stat] * eliteMult);
            }
            monster.displayName = (entry.elite_prefix || 'Elite') + ' ' + monster.name;
            monster.base_xp = Math.floor((monster.base_xp || 15) * Data.cache.encounterSystem.elite_monsters.xp_multiplier);
            monster.base_gold.min = Math.floor(monster.base_gold.min * Data.cache.encounterSystem.elite_monsters.gold_multiplier);
            monster.base_gold.max = Math.floor(monster.base_gold.max * Data.cache.encounterSystem.elite_monsters.gold_multiplier);
          } else {
            monster.displayName = monster.name;
            // XP scales exponentially with difficulty: 1x, 1.5x, 2.25x, ... at diff 10 = ~38x
            monster.base_xp = Math.floor((monster.base_xp || 15) * Math.pow(1.5, difficulty - 1));
          }

          // Gold scales exponentially with difficulty
          const goldMult = Math.pow(1.4, difficulty - 1);
          monster.base_gold.min = Math.floor(monster.base_gold.min * goldMult);
          monster.base_gold.max = Math.floor(monster.base_gold.max * goldMult);

          monster.instanceId = monster.id + '_' + i + '_' + Math.random().toString(36).slice(2, 6);
          enemies.push(monster);
        }
      }
      return {
        name: wave.name,
        description: wave.description,
        template: wave.template,
        enemies,
      };
    });

    // Add boss encounter
    const bossData = dungeon.boss;
    let boss;
    if (bossData.boss_override) {
      boss = JSON.parse(JSON.stringify(bossData.boss_override));
    } else {
      boss = JSON.parse(JSON.stringify(Data.cache.bossesById[bossData.boss_id]));
    }

    if (boss) {
      boss.scaledStats = {};
      for (const [stat, val] of Object.entries(boss.primary_stats)) {
        boss.scaledStats[stat] = Math.floor(val * scaleMult);
      }
      boss.scaledResistances = { ...boss.base_resistances };
      boss.displayName = boss.name;
      boss.isBoss = true;
      boss.instanceId = boss.id + '_boss';

      // Use phase 1 abilities initially
      if (boss.phases && boss.phases.length > 0) {
        boss.scaledAbilities = boss.phases[0].abilities || [];
        boss.ai_behavior = boss.phases[0].ai_behavior || 'caster';
      }

      encounters.push({
        name: boss.title || boss.name,
        description: bossData.pre_battle_text || '',
        template: 'boss',
        enemies: [boss],
        isBoss: true,
        introDialogue: bossData.intro_dialogue,
        victoryText: bossData.victory_text,
        defeatText: bossData.defeat_text,
      });
    }

    // Roll a random dungeon modifier
    const mods = Data.cache.dungeonModifiers?.modifiers || [];
    const modifier = mods[Math.floor(Math.random() * mods.length)] || null;

    current = {
      dungeonId,
      dungeon,
      difficulty,
      scaleMult,
      recLevel,
      encounters,
      currentWave: 0,
      totalGold: 0,
      totalXp: 0,
      loot: [],
      completed: false,
      victory: false,
      modifier,
      nextWaveStatMult: 1.0, // modified by fork events
      nextWaveLootMult: 1.0,
    };

    return current;
  }

  function getCurrentEncounter() {
    if (!current) return null;
    return current.encounters[current.currentWave];
  }

  function advanceWave() {
    if (!current) return null;
    current.currentWave++;
    if (current.currentWave >= current.encounters.length) {
      current.completed = true;
      current.victory = true;
      return null;
    }
    return getCurrentEncounter();
  }

  // Process rewards after winning an encounter
  function processEncounterRewards(encounter) {
    const tier = current.dungeon.tier || 1;
    const diff = current.difficulty || 1;
    const diffMult = 1 + (diff - 1) * 0.5; // +50% per difficulty level

    // Total run XP/Gold = 100 × tier × diffMult
    // Split: regular waves get 1 share each, boss gets 3 shares
    const totalWaves = current.encounters.length || 1;
    const bossShares = 3;
    const regularShares = totalWaves - 1; // number of non-boss waves
    const totalShares = regularShares + bossShares;
    const baseRunXp = Math.floor(100 * tier * diffMult);
    const baseRunGold = Math.floor(100 * tier * diffMult);

    let xp, gold;
    if (encounter.isBoss) {
      xp = Math.floor(baseRunXp * bossShares / totalShares);
      gold = Math.floor(baseRunGold * bossShares / totalShares);
    } else {
      xp = Math.floor(baseRunXp / totalShares);
      gold = Math.floor(baseRunGold / totalShares);
    }
    // Small gold variance ±10%
    gold = Math.floor(gold * (0.9 + Math.random() * 0.2));

    const items = [];
    for (const enemy of encounter.enemies) {
      // Loot roll — rarity capped by dungeon tier, chance scales with difficulty
      const baseLootChance = encounter.isBoss ? 0.8 : 0.15;
      const lootChance = Math.min(0.9, baseLootChance + diff * 0.03);
      if (Math.random() < lootChance) {
        const item = Items.generateRandom(current.recLevel, null, tier);
        if (item) items.push(item);
      }
      // Extra drop at high difficulty
      if (diff >= 5 && Math.random() < (diff - 4) * 0.05) {
        const item = Items.generateRandom(current.recLevel, null, tier);
        if (item) items.push(item);
      }
    }

    // Boss guaranteed drops — more at higher difficulty
    if (encounter.isBoss) {
      const dungeonTier = current.dungeon.tier || 1;
      const bossDrops = 1 + Math.floor(current.difficulty / 3);
      for (let i = 0; i < bossDrops; i++) {
        const bonusItem = Items.generateRandom(current.recLevel + 10, null, dungeonTier);
        if (bonusItem) items.push(bonusItem);
      }
    }

    current.totalGold += gold;
    current.totalXp += xp;
    current.loot.push(...items);

    return { gold, xp, items };
  }

  // Should we rest after this wave?
  function shouldRest(waveIndex) {
    const freq = Data.cache.encounterSystem?.rest_points?.frequency;
    // "every 2 encounters"
    return (waveIndex + 1) % 2 === 0 && waveIndex < (current?.encounters.length || 0) - 1;
  }

  function applyRest(gameState) {
    const restData = Data.cache.encounterSystem?.rest_points || { heal_percent: 0.2, mp_restore_percent: 0.15 };
    for (const member of gameState.party) {
      Party.recalcDerived(member);
      const hpRestore = Math.floor(member.derived.hp * restData.heal_percent);
      const mpRestore = Math.floor(member.derived.mp * restData.mp_restore_percent);
      // Apply to persistent HP/MP
      if (member._currentHp != null) {
        member._currentHp = Math.min(member.derived.hp, member._currentHp + hpRestore);
      }
      if (member._currentMp != null) {
        member._currentMp = Math.min(member.derived.mp, member._currentMp + mpRestore);
      }
      // Revive dead members at 10% HP
      if (member._dead) {
        member._dead = false;
        member._currentHp = Math.floor(member.derived.hp * 0.1);
        member._currentMp = Math.floor(member.derived.mp * 0.1);
      }
    }
    return restData;
  }

  function getCurrent() { return current; }

  function endRun(victory) {
    if (current) {
      current.completed = true;
      current.victory = victory;
    }
    return current;
  }

  // Roll for a random event between waves
  function rollEvent() {
    const events = Data.cache.dungeonEvents?.events;
    if (!events || events.length === 0) return null;
    const chance = Data.cache.dungeonEvents?.event_chance || 0.35;
    if (Math.random() > chance) return null;
    return events[Math.floor(Math.random() * events.length)];
  }

  // Roll post-battle choice
  function getPostBattleChoices() {
    return [
      { id: 'gold', text: 'Take the gold', icon: '&#128176;', result: { type: 'gold_bonus', mult: 1.5, message: 'Extra gold collected!' } },
      { id: 'heal', text: 'Rest briefly', icon: '&#128167;', result: { type: 'heal_party', percent: 0.15, message: 'Party recovers some HP and MP.' } },
      { id: 'gamble_item', text: 'Search for treasure', icon: '&#128230;', result: { type: 'gamble_item', success_chance: 0.4, message_good: 'Found a magic item!', message_bad: 'Nothing but dust...' } },
      { id: 'gamble_heal', text: 'Find a healing spring', icon: '&#10024;', result: { type: 'gamble_heal', success_chance: 0.35, heal_percent: 0.40, message_good: 'A powerful healing spring! Party fully restored!', message_bad: 'The water is stagnant. No effect.' } },
    ];
  }

  function rollPostDungeonEvent() {
    const events = Data.cache.postDungeonEvents?.events;
    if (!events || events.length === 0) return null;
    const chance = Data.cache.postDungeonEvents?.event_chance || 0.6;
    if (Math.random() > chance) return null;
    return events[Math.floor(Math.random() * events.length)];
  }

  return { startRun, getCurrentEncounter, advanceWave, processEncounterRewards, shouldRest, applyRest, getCurrent, endRun, rollEvent, rollPostDungeonEvent, getPostBattleChoices };
})();
