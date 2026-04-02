// combat.js — Autobattle combat engine
const Combat = (() => {
  let state = null;
  let log = [];
  let onTick = null; // callback per action
  let speed = 1;
  let running = false;

  function init(partyMembers, enemies, opts = {}) {
    log = [];
    state = {
      turn: 0,
      combatants: [],
      finished: false,
      victory: false,
      opts,
      combatStats: {}, // per-combatant tracking: { id: { damage, healing, damageTaken, kills, abilityUsage: {} } }
    };

    // Build party combatants
    for (const m of partyMembers) {
      Party.recalcDerived(m);
      // Use persistent HP/MP if available (carries between waves)
      const startHp = m._currentHp != null ? Math.min(m._currentHp, m.derived.hp) : m.derived.hp;
      const startMp = m._currentMp != null ? Math.min(m._currentMp, m.derived.mp) : m.derived.mp;
      const isDead = m._dead || false;
      state.combatants.push({
        id: m.id,
        name: m.name,
        classId: m.classId,
        isParty: true,
        ref: m,
        hp: isDead ? 0 : startHp,
        maxHp: m.derived.hp,
        mp: startMp,
        maxMp: m.derived.mp,
        derived: { ...m.derived },
        resistances: { ...m.resistances },
        abilities: m.abilities.map(aid => {
          const ab = Party.getAbility(m, aid);
          return ab ? { ...ab, currentCooldown: 0 } : null;
        }).filter(Boolean),
        buffs: [],
        dead: false,
        level: m.level,
      });
    }

    // Build enemy combatants
    for (const e of enemies) {
      const derived = calcMonsterDerived(e);
      state.combatants.push({
        id: e.instanceId || e.id + '_' + Math.random().toString(36).slice(2, 6),
        name: e.displayName || e.name,
        monsterId: e.id,
        isParty: false,
        hp: derived.hp,
        maxHp: derived.hp,
        mp: derived.mp,
        maxMp: derived.mp,
        derived,
        resistances: { ...e.scaledResistances || e.base_resistances },
        abilities: (e.scaledAbilities || e.abilities || []).map(a => ({ ...a, currentCooldown: 0 })),
        buffs: [],
        dead: false,
        type: e.type,
        aiType: e.ai_behavior || 'random',
        immunities: e.immunities || [],
        isBoss: !!e.isBoss,
        phases: e.phases || null,
        currentPhase: 0,
      });
    }

    return state;
  }

  function calcMonsterDerived(monster) {
    const s = monster.scaledStats || monster.primary_stats;
    return {
      hp: Math.floor(s.sta * 5.0 + 30),
      mp: Math.floor(s.int * 2.0 + 10),
      phys_atk: Math.floor(s.str * 2.0),
      mag_atk: Math.floor(s.int * 2.0),
      phys_def: Math.floor(s.str * 0.5 + s.sta * 0.8),
      mag_def: Math.floor(s.int * 1.0 + s.sta * 0.3),
      spd: Math.floor(s.dex * 1.5),
      crit_rate: 0.05 + s.dex * 0.002,
      dodge: s.dex * 0.002,
      heal_power: Math.floor(s.int * 1.5),
      dex_atk: Math.floor(s.dex * 2.0),
      hp_regen: 0, mp_regen: 0, lifesteal: 0, armor_pierce: 0, double_strike: 0, dmg_red: 0, cdr: 0,
    };
  }

  // Step-based combat: each call executes one combatant's action
  // Returns { actor, waitingForPlayer } or null if turn/combat is done
  let turnOrder = [];
  let turnIndex = 0;
  let manualMode = false;
  let pendingManualActor = null;

  function setManualMode(val) { manualMode = val; }
  function getManualMode() { return manualMode; }
  function getPendingActor() { return pendingManualActor; }

  // Start a new turn: build turn order
  function startNewTurn() {
    if (state.finished) return;
    state.turn++;
    addLog(`--- Turn ${state.turn} ---`, 'log-phase');
    turnOrder = state.combatants.filter(c => !c.dead).sort((a, b) => b.derived.spd - a.derived.spd);
    turnIndex = 0;
    pendingManualActor = null;
  }

  // Execute one step (one combatant acts). Returns an object describing what happened.
  function executeStep() {
    if (state.finished) return { done: true };

    // If we need a new turn
    if (turnOrder.length === 0 || turnIndex >= turnOrder.length) {
      // End-of-turn DOTs
      for (const c of state.combatants.filter(c => !c.dead)) {
        tickDots(c);
      }
      if (checkWinLoss()) return { done: true };
      startNewTurn();
    }

    // Find next living actor
    while (turnIndex < turnOrder.length && turnOrder[turnIndex].dead) {
      turnIndex++;
    }
    if (turnIndex >= turnOrder.length) return { done: false, endOfTurn: true };

    const actor = turnOrder[turnIndex];
    state.activeActorId = actor.id;
    trackStat(actor.id, 'turn', 1);

    // Tick buffs for this actor
    tickBuffs(actor);

    // Check if stunned
    const stunned = actor.buffs.find(b => b.stun);
    if (stunned) {
      // Stun message already logged by tickBuffs, skip action
      tickCooldowns(actor);
      turnIndex++;
      if (checkWinLoss()) return { done: true };
      return { done: false, actor, stunned: true };
    }

    // Regen
    if (actor.derived.hp_regen > 0) heal(actor, actor, actor.derived.hp_regen, true);
    if (actor.derived.mp_regen > 0) actor.mp = Math.min(actor.maxMp, actor.mp + actor.derived.mp_regen);

    // Manual mode: if this is a party member, wait for player input
    if (manualMode && actor.isParty) {
      pendingManualActor = actor;
      return { done: false, actor, waitingForPlayer: true };
    }

    // Auto: choose and execute
    const action = chooseAction(actor);
    if (action) executeAction(actor, action);

    tickCooldowns(actor);
    turnIndex++;

    if (checkWinLoss()) return { done: true };

    // Boss phase check
    for (const enemy of state.combatants.filter(c => !c.isParty && !c.dead && c.isBoss && c.phases)) {
      checkBossPhase(enemy);
    }

    return { done: false, actor };
  }

  // Manual mode: player chose an ability for the pending actor
  function executeManualAction(abilityId, targetId) {
    const actor = pendingManualActor;
    if (!actor) return;

    const ab = actor.abilities.find(a => a.id === abilityId);
    if (!ab || ab.currentCooldown > 0 || (ab.mp_cost || 0) > actor.mp) return;

    // Override target selection if provided
    if (ab.mp_cost) actor.mp = Math.max(0, actor.mp - ab.mp_cost);
    if (ab.cooldown) ab.currentCooldown = ab.cooldown;

    const allies = state.combatants.filter(c => c.isParty && !c.dead);
    const enemies = state.combatants.filter(c => !c.isParty && !c.dead);

    if (ab.type === 'attack' || (ab.type === 'debuff' && ab.damage_multiplier)) {
      // Use specific target if provided, else pick automatically
      if (targetId) {
        const target = state.combatants.find(c => c.id === targetId);
        if (target && !target.dead) {
          executeAttackOnTargets(actor, ab, [target], allies);
        }
      } else {
        executeAttack(actor, ab, enemies, allies);
      }
    } else if (ab.type === 'heal') {
      if (targetId) {
        const target = state.combatants.find(c => c.id === targetId);
        if (target) executeHealOnTargets(actor, ab, [target]);
      } else {
        executeHeal(actor, ab, allies);
      }
    } else if (ab.type === 'buff') {
      executeBuff(actor, ab, allies);
    } else if (ab.type === 'debuff') {
      executeDebuff(actor, ab, enemies);
    } else if (ab.type === 'defense') {
      executeDefense(actor, ab);
    }

    tickCooldowns(actor);
    turnIndex++;
    pendingManualActor = null;

    checkWinLoss();
    for (const enemy of state.combatants.filter(c => !c.isParty && !c.dead && c.isBoss && c.phases)) {
      checkBossPhase(enemy);
    }
  }

  function executeHealOnTargets(actor, ab, targets) {
    for (const target of targets) {
      if (!target || target.dead) continue;
      const baseHeal = (ab.heal_base || 0) + (actor.derived.heal_power || 0) * (ab.heal_multiplier || 1);
      const amount = Math.floor(baseHeal * (1 + (actor.derived.heal_bonus || 0)));
      heal(actor, target, amount);
      trackStat(actor.id, 'healing', amount);
      addLog(`${actor.name} heals ${target.name} for ${amount} HP`, 'log-heal');
    }
  }

  function getAttackStat(actor, ab) {
    // Use the ability's damage_stat if specified
    if (ab.damage_stat === 'mag_atk') return actor.derived.mag_atk;
    if (ab.damage_stat === 'phys_atk') return actor.derived.phys_atk;
    // Class-based scaling for physical attacks
    const isPhysical = ab.damage_type === 'physical' || ab.damage_type === 'poison';
    if (isPhysical) {
      // DEX-scaling classes
      if (['rogue', 'ranger'].includes(actor.classId)) return actor.derived.dex_atk || actor.derived.phys_atk;
      return actor.derived.phys_atk;
    }
    return actor.derived.mag_atk;
  }

  function executeAttackOnTargets(actor, ab, targets, allies) {
    const isPhysical = ab.damage_type === 'physical' || ab.damage_type === 'poison';
    const atkStat = getAttackStat(actor, ab);
    const multiplier = ab.damage_multiplier || 1.0;
    const hits = ab.hits || 1;
    for (const target of targets) {
      if (!target || target.dead) continue;
      for (let h = 0; h < hits; h++) {
        if (isPhysical && Math.random() < target.derived.dodge) {
          addLog(`${target.name} dodges ${actor.name}'s ${ab.name}!`, 'log-entry');
          continue;
        }
        let baseDmg = atkStat * multiplier;
        const def = isPhysical ? target.derived.phys_def : target.derived.mag_def;
        const pierce = actor.derived.armor_pierce || 0;
        baseDmg -= def * (1 - pierce);
        const resistKey = ab.damage_type ? ab.damage_type + '_resist' : (isPhysical ? 'physical_resist' : null);
        if (resistKey && target.resistances[resistKey]) baseDmg *= (1 - target.resistances[resistKey]);
        const dtiBuffs = target.buffs.filter(b => b.damage_taken_increase);
        for (const b of dtiBuffs) baseDmg *= (1 + b.damage_taken_increase);
        baseDmg *= (1 - (target.derived.dmg_red || 0));
        let crit = false;
        const critRate = (actor.derived.crit_rate || 0.05) + (ab.crit_bonus || 0);
        if (ab.effect?.guaranteed_crit || Math.random() < critRate) { baseDmg *= 2; crit = true; }
        // Damage cap: no single hit can exceed 40% of target max HP (60% for bosses)
        const dmgCap = target.maxHp * (actor.isBoss ? 0.60 : 0.40);
        if (baseDmg > dmgCap) baseDmg = dmgCap;
        const dmg = Math.max(1, Math.floor(baseDmg));
        dealDamage(target, dmg);
        trackStat(actor.id, 'damage', dmg, ab.name);
        trackStat(target.id, 'damageTaken', dmg);
        addLog(`${actor.name} uses ${ab.name} on ${target.name} for ${dmg} ${ab.damage_type || 'physical'} damage${crit ? ' CRIT!' : ''}`, 'log-damage');
        if (ab.effect?.lifesteal || actor.derived.lifesteal) {
          const ls = (ab.effect?.lifesteal || 0) + (actor.derived.lifesteal || 0);
          const healAmt = Math.floor(dmg * ls);
          heal(actor, actor, healAmt, true);
          trackStat(actor.id, 'healing', healAmt);
        }
        applyDotEffects(actor, ab, target);
        applyStatusEffects(ab, target);
        if (target.hp <= 0) { target.dead = true; trackStat(actor.id, 'kill', 1); addLog(`${target.name} has been slain!`, 'log-death'); }
      }
    }
  }

  function tickCooldowns(actor) {
    for (const ab of actor.abilities) {
      if (ab.currentCooldown > 0) ab.currentCooldown--;
    }
  }

  function checkWinLoss() {
    const partyAlive = state.combatants.filter(c => c.isParty && !c.dead);
    const enemyAlive = state.combatants.filter(c => !c.isParty && !c.dead);
    if (enemyAlive.length === 0) {
      state.finished = true; state.victory = true;
      addLog('Victory!', 'log-phase');
      return true;
    }
    if (partyAlive.length === 0) {
      state.finished = true; state.victory = false;
      addLog('Defeat...', 'log-phase');
      return true;
    }
    return false;
  }

  // Legacy: run one full turn (used by runToEnd)
  function executeTurn() {
    if (state.finished) return;
    startNewTurn();
    while (turnIndex < turnOrder.length && !state.finished) {
      const result = executeStep();
      if (result.done) break;
      if (result.waitingForPlayer) {
        // In auto mode during runToEnd, just auto-pick
        const action = chooseAction(pendingManualActor);
        if (action) executeAction(pendingManualActor, action);
        tickCooldowns(pendingManualActor);
        turnIndex++;
        pendingManualActor = null;
        if (checkWinLoss()) break;
      }
    }
    // End of turn DOTs
    for (const c of state.combatants.filter(c => !c.dead)) tickDots(c);
    checkWinLoss();
    return state;
  }

  function chooseAction(actor) {
    const allies = state.combatants.filter(c => c.isParty === actor.isParty && !c.dead);
    const enemies = state.combatants.filter(c => c.isParty !== actor.isParty && !c.dead);
    if (enemies.length === 0) return null;

    // Get available abilities (off cooldown and enough MP)
    const available = actor.abilities.filter(ab =>
      ab.currentCooldown <= 0 && (ab.mp_cost || 0) <= actor.mp && ab.type !== 'passive'
    );

    // Simple AI: try abilities in order, otherwise basic attack (first ability)
    // Check AI priority for party members too (autobattler)
    for (const ab of available) {
      if (ab === available[0] && ab.cooldown === 0) continue; // skip basic attack, try specials first
      if (shouldUseAbility(actor, ab, allies, enemies)) return { ability: ab, actor };
    }

    // Default: basic attack (first ability)
    const basic = available[0];
    if (basic) return { ability: basic, actor };
    return null; // nothing to do
  }

  function shouldUseAbility(actor, ab, allies, enemies) {
    // Heals: use if ally below 50%
    if (ab.type === 'heal') {
      const injured = allies.filter(a => a.hp / a.maxHp < 0.5);
      return injured.length > 0;
    }
    // Buffs: use if not already active on allies
    if (ab.type === 'buff') return true;
    // Debuffs: always use if available
    if (ab.type === 'debuff') return true;
    // Defense: use if self below 50%
    if (ab.type === 'defense') return actor.hp / actor.maxHp < 0.5;
    // Attacks: always use
    if (ab.type === 'attack') return true;
    // Summon: use if available
    if (ab.type === 'summon') return true;
    return true;
  }

  function executeAction(actor, action) {
    const ab = action.ability;
    const allies = state.combatants.filter(c => c.isParty === actor.isParty && !c.dead);
    const enemies = state.combatants.filter(c => c.isParty !== actor.isParty && !c.dead);

    // Spend MP
    if (ab.mp_cost) actor.mp = Math.max(0, actor.mp - ab.mp_cost);
    // Set cooldown
    if (ab.cooldown) ab.currentCooldown = ab.cooldown;

    if (ab.type === 'attack' || (ab.type === 'debuff' && ab.damage_multiplier)) {
      executeAttack(actor, ab, enemies, allies);
    } else if (ab.type === 'heal') {
      executeHeal(actor, ab, allies);
    } else if (ab.type === 'buff') {
      executeBuff(actor, ab, allies);
    } else if (ab.type === 'debuff') {
      executeDebuff(actor, ab, enemies);
    } else if (ab.type === 'defense') {
      executeDefense(actor, ab);
    }
  }

  function executeAttack(actor, ab, enemies, allies) {
    const targets = ab.target === 'all_enemies' ? enemies : [pickTarget(actor, enemies)];
    executeAttackOnTargets(actor, ab, targets, allies);
  }

  function applyDotEffects(actor, ab, target) {
    if (ab.effect?.poison_dot || ab.effect?.burn_dot || ab.effect?.bleed_dot || ab.effect?.dark_dot_percent) {
      const dotType = ab.effect.poison_dot ? 'poison' : ab.effect.burn_dot ? 'burn' : ab.effect.bleed_dot ? 'bleed' : 'dark';
      if (!target.immunities?.includes(dotType + '_dot')) {
        target.buffs.push({
          name: dotType.charAt(0).toUpperCase() + dotType.slice(1),
          dotPercent: ab.effect.dot_percent || ab.effect.dark_dot_percent || 0.03,
          turnsLeft: ab.effect.dot_duration || 3,
          isDebuff: true, isDot: true,
        });
        addLog(`${target.name} is afflicted with ${dotType}!`, 'log-debuff');
      }
    }
  }

  function applyStatusEffects(ab, target) {
    if (ab.effect?.stun_duration && !target.immunities?.includes('stun')) {
      target.buffs.push({ name: 'Stunned', stun: true, turnsLeft: ab.effect.stun_duration, isDebuff: true });
      addLog(`${target.name} is stunned!`, 'log-debuff');
    }
    if (ab.effect?.reduce_spd) {
      target.buffs.push({ name: 'Slowed', spdReduction: ab.effect.reduce_spd, turnsLeft: ab.effect.duration || 2, isDebuff: true });
      target.derived.spd = Math.floor(target.derived.spd * (1 - ab.effect.reduce_spd));
    }
  }

  function executeHeal(actor, ab, allies) {
    const targets = ab.target === 'all_allies' ? allies : [pickHealTarget(allies)];
    for (const target of targets) {
      if (!target || target.dead) continue;
      const baseHeal = (ab.heal_base || 0) + (actor.derived.heal_power || 0) * (ab.heal_multiplier || 1);
      const amount = Math.floor(baseHeal * (1 + (actor.derived.heal_bonus || 0)));
      heal(actor, target, amount);
      trackStat(actor.id, 'healing', amount);
      addLog(`${actor.name} heals ${target.name} for ${amount} HP`, 'log-heal');
    }
  }

  function executeBuff(actor, ab, allies) {
    const targets = ab.target === 'all_allies' ? allies : [actor];
    for (const target of targets) {
      if (!target || target.dead) continue;
      const buff = {
        name: ab.name,
        turnsLeft: ab.effect?.duration || 3,
        isDebuff: false,
        ...ab.effect
      };
      target.buffs.push(buff);
      // Apply stat multipliers immediately
      if (buff.phys_atk_multiplier) target.derived.phys_atk = Math.floor(target.derived.phys_atk * buff.phys_atk_multiplier);
      if (buff.mag_atk_multiplier) target.derived.mag_atk = Math.floor(target.derived.mag_atk * buff.mag_atk_multiplier);
      addLog(`${actor.name} uses ${ab.name} on ${target.name}`, 'log-buff');
    }
  }

  function executeDebuff(actor, ab, enemies) {
    const targets = ab.target === 'all_enemies' ? enemies : [pickTarget(actor, enemies)];
    for (const target of targets) {
      if (!target || target.dead) continue;
      const debuff = {
        name: ab.name,
        turnsLeft: ab.effect?.duration || 2,
        isDebuff: true,
        ...ab.effect
      };
      target.buffs.push(debuff);
      addLog(`${actor.name} applies ${ab.name} to ${target.name}`, 'log-debuff');
    }
  }

  function executeDefense(actor, ab) {
    const buff = {
      name: ab.name,
      turnsLeft: ab.effect?.duration || 3,
      isDebuff: false,
      ...ab.effect
    };
    actor.buffs.push(buff);
    if (buff.phys_def_multiplier) actor.derived.phys_def = Math.floor(actor.derived.phys_def * buff.phys_def_multiplier);
    if (buff.mag_def_multiplier) actor.derived.mag_def = Math.floor(actor.derived.mag_def * buff.mag_def_multiplier);
    if (buff.dodge_bonus) actor.derived.dodge = Math.min(0.5, actor.derived.dodge + buff.dodge_bonus);
    addLog(`${actor.name} uses ${ab.name}`, 'log-buff');
  }

  function pickTarget(actor, enemies) {
    if (enemies.length === 0) return null;
    // Check for forced target (taunt)
    const taunted = enemies.find(e => e.buffs.some(b => b.force_target));
    if (taunted) return taunted;

    const ai = actor.aiType || 'random';
    if (ai === 'targets_lowest_hp') return enemies.reduce((a, b) => a.hp < b.hp ? a : b);
    if (ai === 'targets_healer') {
      const healer = enemies.find(e => e.classId === 'cleric');
      if (healer) return healer;
    }
    if (ai === 'targets_highest_atk') return enemies.reduce((a, b) => (b.derived.phys_atk + b.derived.mag_atk) > (a.derived.phys_atk + a.derived.mag_atk) ? b : a);
    return enemies[Math.floor(Math.random() * enemies.length)];
  }

  function pickHealTarget(allies) {
    const injured = allies.filter(a => !a.dead && a.hp < a.maxHp).sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
    return injured[0] || allies.find(a => !a.dead);
  }

  function dealDamage(target, amount) {
    target.hp = Math.max(0, target.hp - amount);
  }

  function heal(actor, target, amount, silent) {
    if (target.dead) return;
    const healReduce = target.buffs.filter(b => b.reduce_heal_received).reduce((sum, b) => sum + b.reduce_heal_received, 0);
    amount = Math.floor(amount * (1 - healReduce));
    target.hp = Math.min(target.maxHp, target.hp + amount);
  }

  function tickBuffs(actor) {
    // Check stun
    const stunned = actor.buffs.find(b => b.stun);
    if (stunned) {
      addLog(`${actor.name} is stunned and cannot act!`, 'log-debuff');
    }
    // Decrement buff durations
    actor.buffs = actor.buffs.filter(b => {
      if (b.turnsLeft !== undefined) {
        b.turnsLeft--;
        if (b.turnsLeft <= 0) {
          addLog(`${b.name} fades from ${actor.name}`, 'log-entry');
          return false;
        }
      }
      return true;
    });
  }

  function tickDots(combatant) {
    for (const b of combatant.buffs.filter(b => b.isDot)) {
      const dmg = Math.max(1, Math.floor(combatant.maxHp * b.dotPercent));
      dealDamage(combatant, dmg);
      addLog(`${combatant.name} takes ${dmg} ${b.name} damage`, 'log-damage');
      if (combatant.hp <= 0) {
        combatant.dead = true;
        addLog(`${combatant.name} has been slain by ${b.name}!`, 'log-death');
      }
    }
  }

  function checkBossPhase(boss) {
    if (!boss.phases || boss.currentPhase >= boss.phases.length - 1) return;
    const nextPhase = boss.phases[boss.currentPhase + 1];
    if (boss.hp / boss.maxHp <= nextPhase.hp_threshold) {
      boss.currentPhase++;
      const phase = boss.phases[boss.currentPhase];
      addLog(`--- ${boss.name}: ${phase.name} ---`, 'log-phase');
      if (phase.transition_text) addLog(phase.transition_text, 'log-phase');
      // Apply new abilities
      if (phase.abilities) {
        boss.abilities = phase.abilities.map(a => ({ ...a, currentCooldown: 0 }));
      }
      // Apply stat multipliers
      if (phase.stat_multipliers) {
        for (const [stat, mult] of Object.entries(phase.stat_multipliers)) {
          if (stat === 'str') { boss.derived.phys_atk = Math.floor(boss.derived.phys_atk * mult); boss.derived.phys_def = Math.floor(boss.derived.phys_def * mult); }
          if (stat === 'int') { boss.derived.mag_atk = Math.floor(boss.derived.mag_atk * mult); boss.derived.mag_def = Math.floor(boss.derived.mag_def * mult); }
          if (stat === 'dex') { boss.derived.spd = Math.floor(boss.derived.spd * mult); }
        }
      }
      // On transition effects
      if (phase.on_transition?.heal_percent) {
        boss.hp = Math.min(boss.maxHp, boss.hp + Math.floor(boss.maxHp * phase.on_transition.heal_percent));
      }
    }
  }

  // Combat stat tracking
  function trackStat(combatantId, stat, value, abilityName) {
    if (!state.combatStats[combatantId]) {
      state.combatStats[combatantId] = { totalDamage: 0, totalHealing: 0, totalDamageTaken: 0, kills: 0, abilitiesUsed: {}, turnsActed: 0 };
    }
    const s = state.combatStats[combatantId];
    if (stat === 'damage') { s.totalDamage += value; if (abilityName) s.abilitiesUsed[abilityName] = (s.abilitiesUsed[abilityName] || 0) + value; }
    if (stat === 'healing') s.totalHealing += value;
    if (stat === 'damageTaken') s.totalDamageTaken += value;
    if (stat === 'kill') s.kills++;
    if (stat === 'turn') s.turnsActed++;
  }

  function getCombatStats() { return state?.combatStats || {}; }

  function addLog(text, cls) {
    log.push({ text, cls: cls || 'log-entry' });
    if (onTick) onTick({ type: 'log', text, cls });
  }

  function getLog() { return log; }
  function getState() { return state; }
  function setOnTick(fn) { onTick = fn; }
  function setSpeed(s) { speed = s; }
  function getSpeed() { return speed; }

  // Run full combat to completion (for skip)
  function runToEnd() {
    while (!state.finished && state.turn < 200) {
      executeTurn();
    }
    if (!state.finished) {
      state.finished = true;
      state.victory = false;
    }
    return state;
  }

  // Sync party members' HP/MP back to their persistent state after combat
  function syncPartyState() {
    if (!state) return;
    for (const c of state.combatants.filter(c => c.isParty)) {
      if (c.ref) {
        c.ref._currentHp = c.hp;
        c.ref._currentMp = c.mp;
        c.ref._dead = c.dead;
      }
    }
  }

  // Reset persistent HP/MP (when starting a new dungeon run)
  function resetPartyPersistence(partyMembers) {
    for (const m of partyMembers) {
      delete m._currentHp;
      delete m._currentMp;
      delete m._dead;
    }
  }

  return { init, executeTurn, executeStep, executeManualAction, startNewTurn, runToEnd, getLog, getState, getCombatStats, setOnTick, setSpeed, getSpeed, setManualMode, getManualMode, getPendingActor, calcMonsterDerived, syncPartyState, resetPartyPersistence };
})();
