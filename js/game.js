// game.js — Main game controller, save/load, game loop
const Game = (() => {
  let state = null;
  let combatInterval = null;
  let combatEnded = false;

  const SAVE_PREFIX = 'dungeon_crawler_save_';
  const MAX_SLOTS = 3;
  let currentSlot = 0;

  function defaultState() {
    return {
      gold: 500,
      party: [],
      inventory: [],
      consumables: [],
      materials: {},
      partyName: 'Unnamed Party',
      stats: { monstersKilled: 0, totalXpEarned: 0, totalGoldEarned: 0, dungeonRuns: 0, deepestDungeon: '', deaths: 0, bossesKilled: 0 },
      clearedDungeons: [],
      dungeonRuns: 0,
      totalPlayTime: 0,
    };
  }

  async function init() {
    // Load all data
    await Data.loadAll();

    // Init UI
    UI.initModals();

    // Check for saves
    const hasSaves = Array.from({ length: MAX_SLOTS }, (_, i) => localStorage.getItem(SAVE_PREFIX + i)).some(Boolean);
    if (hasSaves) {
      document.getElementById('btn-continue').style.display = 'block';
    }

    // Menu buttons
    document.getElementById('btn-new-game').addEventListener('click', showSlotSelect.bind(null, 'new'));
    document.getElementById('btn-continue').addEventListener('click', showSlotSelect.bind(null, 'load'));
    document.getElementById('btn-save').addEventListener('click', saveGame);
    document.getElementById('btn-menu').addEventListener('click', () => {
      if (state) saveGame();
      UI.showScreen('menu');
      const hasSaves = Array.from({ length: MAX_SLOTS }, (_, i) => localStorage.getItem(SAVE_PREFIX + i)).some(Boolean);
      if (hasSaves) document.getElementById('btn-continue').style.display = 'block';
    });

    // Town building buttons
    document.querySelectorAll('.town-building').forEach(btn => {
      btn.addEventListener('click', () => {
        const building = btn.dataset.building;
        if (building === 'guild') { openGuild(); }
        else if (building === 'blacksmith') { openBlacksmith(); }
        else if (building === 'alchemist') { openAlchemist(); }
        else if (building === 'party') { openPartyCamp(); }
        else if (building === 'dungeon') { openDungeonSelect(); }
      });
    });

    // Back buttons
    document.querySelectorAll('.btn-back').forEach(btn => {
      btn.addEventListener('click', () => goToTown());
    });

    // Blacksmith tabs
    document.querySelectorAll('#screen-blacksmith .shop-tab').forEach(tab => {
      tab.addEventListener('click', () => Town.renderBlacksmith(state, tab.dataset.tab));
    });

    // Blacksmith mode tabs (Buy/Sell/Salvage/Forge)
    document.querySelectorAll('.shop-mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.mode;
        document.querySelectorAll('.shop-mode-tab').forEach(t => t.classList.toggle('active', t === tab));
        for (const id of ['bs-buy-panel', 'bs-sell-panel', 'bs-salvage-panel', 'bs-forge-panel']) {
          document.getElementById(id).style.display = 'none';
        }
        document.getElementById('bs-' + mode + '-panel').style.display = 'flex';
        if (mode === 'sell') Town.renderBlacksmithSell(state);
        if (mode === 'salvage') Town.renderSalvagePanel(state);
        if (mode === 'forge') Town.renderForge(state);
      });
    });

    // Blacksmith refresh wares
    document.getElementById('btn-refresh-wares').addEventListener('click', () => {
      if (state.gold < 200) {
        UI.toast('Not enough gold (200g required)', 'toast-error');
        return;
      }
      state.gold -= 200;
      const avgLevel = state.party.length > 0
        ? Math.round(state.party.reduce((s, m) => s + m.level, 0) / state.party.length)
        : 1;
      Town.refreshShops(avgLevel, getPartyClasses(), getMaxDungeonTier());
      Town.renderBlacksmith(state);
      UI.updateTopBar(state);
      UI.toast('Blacksmith restocked!', 'toast-success');
    });

    // Sell All button
    document.getElementById('btn-sell-all').addEventListener('click', () => {
      const totalValue = state.inventory.reduce((sum, i) => sum + (i.sellPrice || 0), 0);
      const count = state.inventory.length;
      if (count === 0) { UI.toast('Nothing to sell', 'toast-error'); return; }
      const doSell = () => {
        state.gold += totalValue;
        state.inventory = [];
        UI.toast(`Sold ${count} items for ${totalValue}g!`, 'toast-gold');
        Town.renderBlacksmithSell(state);
        UI.updateTopBar(state);
        document.getElementById('bs-gold').textContent = state.gold;
      };
      const skip = document.getElementById('bs-skip-confirm')?.checked;
      if (skip) { doSell(); return; }
      document.getElementById('sell-confirm-text').textContent = `Sell all ${count} items for ${totalValue} gold?`;
      document.getElementById('modal-sell-confirm').style.display = 'flex';
      document.getElementById('btn-sell-yes').onclick = () => { document.getElementById('modal-sell-confirm').style.display = 'none'; doSell(); };
      document.getElementById('btn-sell-no').onclick = () => { document.getElementById('modal-sell-confirm').style.display = 'none'; };
    });

    // Salvage All button
    document.getElementById('btn-salvage-all').addEventListener('click', () => {
      const count = state.inventory.length;
      if (count === 0) { UI.toast('Nothing to salvage', 'toast-error'); return; }
      const allMats = [];
      for (const item of state.inventory) allMats.push(...Crafting.salvage(item));
      const doSalvage = () => {
        Crafting.addMaterials(state, allMats);
        state.inventory = [];
        UI.toast(`Salvaged ${count} items!`, 'toast-success');
        Town.renderSalvagePanel(state);
        UI.updateTopBar(state);
      };
      const skip = document.getElementById('bs-skip-salvage-confirm')?.checked;
      if (skip) { doSalvage(); return; }
      document.getElementById('sell-confirm-text').textContent = `Salvage all ${count} items into crafting materials?`;
      document.getElementById('modal-sell-confirm').style.display = 'flex';
      document.getElementById('btn-sell-yes').onclick = () => { document.getElementById('modal-sell-confirm').style.display = 'none'; doSalvage(); };
      document.getElementById('btn-sell-no').onclick = () => { document.getElementById('modal-sell-confirm').style.display = 'none'; };
    });

    // Alchemist tabs
    document.querySelectorAll('#screen-alchemist .shop-tab').forEach(tab => {
      tab.addEventListener('click', () => Town.renderAlchemist(state, tab.dataset.tab));
    });

    // Combat controls
    document.getElementById('btn-battle-mode').addEventListener('click', toggleBattleMode);
    document.getElementById('btn-auto-speed').addEventListener('click', toggleSpeed);
    document.getElementById('btn-skip-combat').addEventListener('click', skipCombat);
    document.getElementById('btn-flee').addEventListener('click', fleeCombat);

    // Result continue
    document.getElementById('btn-result-continue').addEventListener('click', returnToTown);

    // Rest continue — handled dynamically by showRestPoint/showPostBattleChoice/showDungeonEvent
  }

  function getPartyClasses() {
    return state?.party?.length > 0 ? [...new Set(state.party.map(m => m.classId))] : null;
  }

  function getMaxDungeonTier() {
    if (!state) return 1;
    return Math.max(1, (state.clearedDungeons?.length || 0) + 1);
  }

  function showSlotSelect(mode) {
    const content = document.getElementById('item-detail-content');
    let html = `<div class="item-detail"><h3>${mode === 'new' ? 'Select Save Slot' : 'Load Game'}</h3><div class="assign-list">`;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const saved = localStorage.getItem(SAVE_PREFIX + i);
      let label = `Slot ${i + 1}: Empty`;
      if (saved) {
        try {
          const d = JSON.parse(saved);
          const names = d.party?.map(m => m.name).join(', ') || 'No party';
          const avgLv = d.party?.length > 0 ? Math.round(d.party.reduce((s, m) => s + m.level, 0) / d.party.length) : 0;
          label = `Slot ${i + 1}: ${names} (Avg Lv${avgLv}, ${d.gold}g, ${d.clearedDungeons?.length || 0} dungeons)`;
        } catch (e) { label = `Slot ${i + 1}: Corrupted`; }
      }
      const canClick = mode === 'new' || saved;
      html += `<button class="assign-btn" data-slot="${i}" ${canClick ? '' : 'disabled'} style="${canClick ? '' : 'opacity:0.3;cursor:not-allowed;'}">${label}</button>`;
    }
    html += '</div></div>';
    content.innerHTML = html;
    document.getElementById('modal-item').style.display = 'flex';

    content.querySelectorAll('.assign-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('modal-item').style.display = 'none';
        currentSlot = parseInt(btn.dataset.slot);
        if (mode === 'new') newGame();
        else continueGame();
      });
    });
  }

  function newGame() {
    state = defaultState();
    Town.refreshShops(1, null);
    saveGame();
    goToTown();
  }

  function continueGame() {
    const saved = localStorage.getItem(SAVE_PREFIX + currentSlot);
    if (saved) {
      try {
        state = JSON.parse(saved);
        for (const m of state.party) Party.recalcDerived(m);
        if (state._itemNextId) Items.setNextId(state._itemNextId);
        const avgLevel = state.party.length > 0
          ? Math.round(state.party.reduce((s, m) => s + m.level, 0) / state.party.length)
          : 1;
        Town.refreshShops(avgLevel, getPartyClasses(), getMaxDungeonTier());
        goToTown();
      } catch (e) {
        UI.toast('Save data corrupted, starting new game', 'toast-error');
        newGame();
      }
    }
  }

  function saveGame() {
    if (!state) return;
    state._itemNextId = Items.getNextId();
    localStorage.setItem(SAVE_PREFIX + currentSlot, JSON.stringify(state));
    UI.toast(`Saved to slot ${currentSlot + 1}!`, 'toast-success');
  }

  function goToTown() {
    UI.showScreen('town');
    UI.updateTopBar(state);
    UI.renderPartyOverview(state);
  }

  function openGuild() {
    UI.showScreen('guild');
    Town.renderGuild(state);
    UI.updateTopBar(state);
  }

  function openBlacksmith() {
    const avgLevel = state.party.length > 0
      ? Math.round(state.party.reduce((s, m) => s + m.level, 0) / state.party.length)
      : 1;
    Town.refreshShops(avgLevel);
    UI.showScreen('blacksmith');
    Town.renderBlacksmith(state);
  }

  function openAlchemist() {
    const avgLevel = state.party.length > 0
      ? Math.round(state.party.reduce((s, m) => s + m.level, 0) / state.party.length)
      : 1;
    Town.refreshShops(avgLevel);
    UI.showScreen('alchemist');
    Town.renderAlchemist(state);
  }

  function openPartyCamp() {
    UI.showScreen('party');
    Town.renderPartyCamp(state);
    // Party name
    const nameInput = document.getElementById('party-name-input');
    nameInput.value = state.partyName || 'Unnamed Party';
    nameInput.onchange = () => { state.partyName = nameInput.value || 'Unnamed Party'; };
    // Stats button
    document.getElementById('btn-party-stats').onclick = () => UI.showPartyDashboard(state);
    // Camp tabs
    document.querySelectorAll('[data-camp-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const t = tab.dataset.campTab;
        document.querySelectorAll('[data-camp-tab]').forEach(tt => tt.classList.toggle('active', tt === tab));
        document.getElementById('camp-gear-panel').style.display = t === 'gear' ? 'flex' : 'none';
        document.getElementById('camp-formation-panel').style.display = t === 'formation' ? 'flex' : 'none';
        document.getElementById('camp-abilities-panel').style.display = t === 'abilities' ? 'flex' : 'none';
        if (t === 'formation') Town.renderFormation(state);
        if (t === 'abilities') Town.renderAbilityManager(state);
      });
    });
  }

  function openDungeonSelect() {
    UI.showScreen('dungeon-select');
    UI.renderDungeonSelect(state);
  }

  // Enter dungeon
  function enterDungeon(dungeonId, difficulty) {
    const run = Dungeon.startRun(dungeonId, difficulty);
    if (!run) return;

    // Reset HP/MP persistence for a fresh dungeon run
    Combat.resetPartyPersistence(state.party);
    UI.showScreen('dungeon');
    UI.renderDungeonHeader(run);
    startEncounter();
  }

  function startEncounter() {
    const run = Dungeon.getCurrent();
    const encounter = Dungeon.getCurrentEncounter();
    if (!encounter) {
      finishDungeon(true);
      return;
    }

    UI.renderDungeonHeader(run);

    // Init combat
    const combatState = Combat.init(state.party, encounter.enemies);
    Combat.startNewTurn();

    UI.renderCombatState(combatState, encounter);
    UI.updateCombatLog(Combat.getLog());
    UI.hideManualControls();
    UI.renderConsumables(state, (consumable) => useConsumable(consumable, combatState));

    // Start step-based loop (one action at a time)
    combatEnded = false;
    if (combatInterval) clearInterval(combatInterval);
    startStepLoop(combatState, encounter);
  }

  function useConsumable(consumable, combatState) {
    // Find and remove one from inventory
    const idx = state.consumables.findIndex(c => c.id === consumable.id && c.rarity === consumable.rarity);
    if (idx === -1) return;
    state.consumables.splice(idx, 1);

    const allies = combatState.combatants.filter(c => c.isParty && !c.dead);

    if (consumable.effect === 'heal') {
      // Heal lowest HP ally
      const target = allies.reduce((a, b) => a.hp / a.maxHp < b.hp / b.maxHp ? a : b);
      target.hp = Math.min(target.maxHp, target.hp + consumable.value);
      UI.toast(`${target.name} healed for ${consumable.value} HP!`, 'toast-success');
    } else if (consumable.effect === 'restore_mp') {
      const target = allies.reduce((a, b) => a.mp / a.maxMp < b.mp / b.maxMp ? a : b);
      target.mp = Math.min(target.maxMp, target.mp + consumable.value);
      UI.toast(`${target.name} restored ${consumable.value} MP!`, 'toast-success');
    } else if (consumable.effect === 'revive') {
      const dead = combatState.combatants.find(c => c.isParty && c.dead);
      if (dead) {
        dead.dead = false;
        dead.hp = Math.floor(dead.maxHp * consumable.value);
        UI.toast(`${dead.name} revived!`, 'toast-success');
      } else {
        UI.toast('No one to revive!', 'toast-error');
        state.consumables.splice(idx, 0, consumable); // put it back
        return;
      }
    } else if (consumable.effect?.startsWith('buff_')) {
      for (const ally of allies) {
        const stat = consumable.effect.replace('buff_', '');
        if (stat === 'atk') ally.derived.phys_atk = Math.floor(ally.derived.phys_atk * (1 + consumable.value));
        if (stat === 'def') ally.derived.phys_def = Math.floor(ally.derived.phys_def * (1 + consumable.value));
        if (stat === 'spd') ally.derived.spd = Math.floor(ally.derived.spd * (1 + consumable.value));
        if (stat === 'hp') { ally.maxHp = Math.floor(ally.maxHp * (1 + consumable.value)); ally.hp = Math.min(ally.maxHp, ally.hp + Math.floor(ally.maxHp * consumable.value)); }
      }
      UI.toast(`${consumable.name} used on party!`, 'toast-success');
    }

    const encounter = Dungeon.getCurrentEncounter();
    UI.renderCombatState(combatState, encounter);
    UI.renderConsumables(state, (c) => useConsumable(c, combatState));
  }

  function startStepLoop(combatState, encounter) {
    if (combatInterval) clearInterval(combatInterval);
    const baseDelay = 1200; // Slower base speed for readability
    combatInterval = setInterval(() => {
      if (combatEnded) return;
      if (combatState.finished) {
        clearInterval(combatInterval);
        combatInterval = null;
        if (!combatEnded) {
          combatEnded = true;
          onCombatEnd(combatState, encounter);
        }
        return;
      }

      const result = Combat.executeStep();

      if (result.waitingForPlayer) {
        // Pause auto-loop, show manual controls
        clearInterval(combatInterval);
        combatInterval = null;
        UI.showManualControls(result.actor, (abilityId, targetId) => {
          Combat.executeManualAction(abilityId, targetId);
          UI.hideManualControls();
          UI.renderCombatState(combatState, encounter);
          UI.updateCombatLog(Combat.getLog());
          if (!combatState.finished) {
            startStepLoop(combatState, encounter);
          } else {
            if (!combatEnded) {
              combatEnded = true;
              onCombatEnd(combatState, encounter);
            }
          }
        });
      }

      UI.renderCombatState(combatState, encounter);
      UI.updateCombatLog(Combat.getLog());
    }, baseDelay / Combat.getSpeed());
  }

  function onCombatEnd(combatState, encounter) {
    // Sync party HP/MP back so it persists to next wave
    Combat.syncPartyState();

    // Track stats
    if (!state.stats) state.stats = { monstersKilled: 0, totalXpEarned: 0, totalGoldEarned: 0, dungeonRuns: 0, deepestDungeon: '', deaths: 0, bossesKilled: 0 };
    if (!state.stats.classDps) state.stats.classDps = {};
    const killed = combatState.combatants.filter(c => !c.isParty && c.dead).length;
    state.stats.monstersKilled += killed;
    const partyDeaths = combatState.combatants.filter(c => c.isParty && c.dead).length;
    state.stats.deaths += partyDeaths;
    if (encounter.isBoss && combatState.victory) state.stats.bossesKilled++;

    // Accumulate per-class DPS analytics
    const combatStats = Combat.getCombatStats();
    const turns = combatState.turn || 1;
    for (const c of combatState.combatants.filter(c => c.isParty)) {
      const cs = combatStats[c.id];
      if (!cs) continue;
      const classId = c.classId;
      if (!state.stats.classDps[classId]) state.stats.classDps[classId] = { totalDamage: 0, totalHealing: 0, totalDamageTaken: 0, kills: 0, combats: 0, totalTurns: 0, abilityDamage: {} };
      const cd = state.stats.classDps[classId];
      cd.totalDamage += cs.totalDamage;
      cd.totalHealing += cs.totalHealing;
      cd.totalDamageTaken += cs.totalDamageTaken;
      cd.kills += cs.kills;
      cd.combats++;
      cd.totalTurns += turns;
      // Per-ability damage
      for (const [abName, abDmg] of Object.entries(cs.abilitiesUsed || {})) {
        cd.abilityDamage[abName] = (cd.abilityDamage[abName] || 0) + abDmg;
      }
    }

    if (combatState.victory) {
      // Process rewards
      const rewards = Dungeon.processEncounterRewards(encounter);
      state.gold += rewards.gold;
      state.stats.totalGoldEarned += rewards.gold;
      state.stats.totalXpEarned += rewards.xp;
      state.inventory.push(...rewards.items);

      // Distribute XP
      const xpPerMember = Math.floor(rewards.xp / state.party.length);
      for (const member of state.party) {
        const result = Party.addXp(member, xpPerMember);
        if (result.leveled) {
          UI.toast(`${member.name} reached level ${result.newLevel}!`, 'toast-levelup');
          for (const ab of result.newAbilities) {
            UI.toast(`${member.name} learned ${ab.name}!`, 'toast-success');
          }
        }
      }

      // Post-battle choice, then event check, then advance
      showPostBattleChoice(() => {
        const run = Dungeon.getCurrent();
        // Event check (35% chance)
        const event = Dungeon.rollEvent();
        if (event) {
          showDungeonEvent(event, () => advanceToNext());
        } else {
          advanceToNext();
        }
      });
    } else {
      // Defeat — permadeath check
      const anyAlive = Combat.getState().combatants.some(c => c.isParty && !c.dead);
      if (!anyAlive) {
        // Total party kill
        finishDungeon(false, true);
      } else {
        finishDungeon(false, false);
      }
    }
  }

  let autoPostBattle = false;

  function showPostBattleChoice(onDone) {
    const choices = Dungeon.getPostBattleChoices();
    const run = Dungeon.getCurrent();
    const content = document.getElementById('rest-text');
    const modal = document.getElementById('modal-rest');
    const continueBtn = document.getElementById('btn-rest-continue');

    // Auto-select: pick "Rest briefly" (index 1) automatically
    if (autoPostBattle) {
      applyPostBattleChoice(choices[1], run);
      onDone();
      return;
    }

    content.innerHTML = `
      <div style="text-align:left;">
        <div style="font-weight:600;margin-bottom:8px;">Wave cleared! Choose your reward:</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${choices.map((c, i) => `<button class="btn-small post-battle-btn" data-idx="${i}" style="padding:8px 12px;text-align:left;font-size:12px;">${c.icon} ${c.text}</button>`).join('')}
        </div>
        <label style="display:flex;align-items:center;gap:6px;margin-top:10px;font-size:11px;color:var(--text-dim);cursor:pointer;">
          <input type="checkbox" id="auto-post-battle" ${autoPostBattle ? 'checked' : ''}> Auto-select "Rest briefly" for future waves
        </label>
      </div>
    `;
    continueBtn.style.display = 'none';
    modal.style.display = 'flex';

    content.querySelector('#auto-post-battle')?.addEventListener('change', (e) => {
      autoPostBattle = e.target.checked;
    });

    content.querySelectorAll('.post-battle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const choice = choices[parseInt(btn.dataset.idx)];
        applyPostBattleChoice(choice, run);
        modal.style.display = 'none';
        continueBtn.style.display = '';
        onDone();
      });
    });
  }

  function applyPostBattleChoice(choice, run) {
    const r = choice.result;
    if (r.type === 'gold_bonus') {
      const bonus = Math.floor(run.totalGold * 0.2);
      state.gold += bonus;
      run.totalGold += bonus;
      UI.toast(r.message + ` (+${bonus}g)`, 'toast-gold');
    } else if (r.type === 'heal_party') {
      for (const m of state.party) {
        if (m._currentHp != null) m._currentHp = Math.min(m.derived?.hp || 999, m._currentHp + Math.floor((m.derived?.hp || 100) * r.percent));
        if (m._currentMp != null) m._currentMp = Math.min(m.derived?.mp || 999, m._currentMp + Math.floor((m.derived?.mp || 50) * r.percent));
      }
      UI.toast(r.message, 'toast-success');
    } else if (r.type === 'gamble_item') {
      if (Math.random() < r.success_chance) {
        const item = Items.generateRandom(run.recLevel, null, run.dungeon.tier || 1);
        if (item) { state.inventory.push(item); run.loot.push(item); }
        UI.toast(r.message_good, 'toast-success');
      } else {
        UI.toast(r.message_bad, 'toast-error');
      }
    } else if (r.type === 'gamble_heal') {
      if (Math.random() < r.success_chance) {
        for (const m of state.party) {
          if (m._currentHp != null) m._currentHp = Math.min(m.derived?.hp || 999, m._currentHp + Math.floor((m.derived?.hp || 100) * r.heal_percent));
          if (m._currentMp != null) m._currentMp = Math.min(m.derived?.mp || 999, m._currentMp + Math.floor((m.derived?.mp || 50) * r.heal_percent));
        }
        UI.toast(r.message_good, 'toast-success');
      } else {
        UI.toast(r.message_bad, 'toast-error');
      }
    }
  }

  function showDungeonEvent(event, onDone) {
    const content = document.getElementById('rest-text');
    const modal = document.getElementById('modal-rest');
    const continueBtn = document.getElementById('btn-rest-continue');

    const partyClasses = state.party.map(m => m.classId);
    content.innerHTML = `
      <div style="text-align:left;">
        <div style="font-size:24px;text-align:center;">${event.icon}</div>
        <div style="font-weight:600;font-size:15px;margin:6px 0;">${event.name}</div>
        <div style="color:var(--text-dim);font-size:12px;margin-bottom:10px;">${event.description}</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${event.choices.map((c, i) => {
            const hasClassBonus = c.class_bonus && partyClasses.includes(c.class_bonus);
            const classRequired = c.class_required && !hasClassBonus;
            const costStr = c.cost ? ` (${c.cost.amount}g)` : '';
            const canAfford = !c.cost || state.gold >= c.cost.amount;
            const bonusStr = hasClassBonus ? ` <span style="color:var(--success);font-size:10px;">[${c.class_bonus} bonus]</span>` : '';
            return `<button class="btn-small event-choice-btn" data-idx="${i}" ${classRequired || !canAfford ? 'disabled' : ''} style="padding:8px 12px;text-align:left;font-size:12px;">
              ${c.text}${costStr}${bonusStr}${classRequired ? ' <span style="color:var(--danger);font-size:10px;">[requires ${c.class_bonus}]</span>' : ''}
            </button>`;
          }).join('')}
        </div>
      </div>
    `;
    continueBtn.style.display = 'none';
    modal.style.display = 'flex';

    content.querySelectorAll('.event-choice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const choice = event.choices[parseInt(btn.dataset.idx)];
        // Pay cost
        if (choice.cost?.type === 'gold') state.gold -= choice.cost.amount;

        let result;
        if (choice.outcome === 'fixed') {
          result = choice.result;
        } else {
          // Random outcome
          const hasBonus = choice.class_bonus && state.party.some(m => m.classId === choice.class_bonus);
          const chance = hasBonus ? (choice.class_bonus_chance || choice.good_chance) : choice.good_chance;
          result = Math.random() < chance ? choice.good : choice.bad;
        }

        // Apply result
        applyEventResult(result);

        // Show result message
        content.innerHTML = `<div style="text-align:center;padding:12px;">
          <div style="font-size:24px;">${event.icon}</div>
          <div style="margin-top:8px;font-size:13px;">${result.message}</div>
        </div>`;
        continueBtn.style.display = '';
        continueBtn.onclick = () => { modal.style.display = 'none'; continueBtn.onclick = null; onDone(); };
      });
    });
  }

  function applyEventResult(result) {
    if (!result) return;
    const run = Dungeon.getCurrent();
    if (result.type === 'loot') {
      for (let i = 0; i < (result.count || 1); i++) {
        const boost = result.rarity_boost || 0;
        const item = Items.generateRandom(run.recLevel + boost * 5, null, Math.min(6, (run.dungeon.tier || 1) + boost));
        if (item) { state.inventory.push(item); run.loot.push(item); }
      }
    } else if (result.type === 'gold') {
      state.gold += result.amount;
      run.totalGold += result.amount;
    } else if (result.type === 'materials') {
      for (let i = 0; i < (result.count || 1); i++) {
        const matTypes = ['metal_scrap', 'leather_scrap', 'gem_dust', 'essence'];
        const mat = matTypes[Math.floor(Math.random() * matTypes.length)];
        Crafting.addMaterials(state, [{ id: mat, rarity: 'common', quantity: 1 }]);
      }
    } else if (result.type === 'damage_party') {
      for (const m of state.party) {
        if (m._currentHp != null) m._currentHp = Math.max(1, m._currentHp - Math.floor((m.derived?.hp || 100) * result.percent));
      }
    } else if (result.type === 'damage_one') {
      const target = state.party[Math.floor(Math.random() * state.party.length)];
      if (target._currentHp != null) target._currentHp = Math.max(1, target._currentHp - Math.floor((target.derived?.hp || 100) * result.percent));
    } else if (result.type === 'heal_party') {
      for (const m of state.party) {
        if (m._currentHp != null) m._currentHp = Math.min(m.derived?.hp || 999, m._currentHp + Math.floor((m.derived?.hp || 100) * result.percent));
      }
    } else if (result.type === 'buff_party') {
      // Store buff on run state
      if (!run.partyBuffs) run.partyBuffs = [];
      run.partyBuffs.push({ stat: result.stat, value: result.value, duration: result.duration });
      UI.toast(`Party buffed: +${Math.round(result.value * 100)}% ${result.stat}`, 'toast-buff');
    } else if (result.type === 'debuff_party') {
      if (!run.partyDebuffs) run.partyDebuffs = [];
      run.partyDebuffs.push({ stat: result.stat, value: result.value, duration: result.duration, turnsLeft: result.duration });
    } else if (result.type === 'harder_next') {
      run.nextWaveStatMult = result.stat_mult || 1.25;
      run.nextWaveLootMult = result.loot_mult || 1.5;
    } else if (result.type === 'easier_next') {
      run.nextWaveStatMult = result.stat_mult || 0.8;
    } else if (result.type === 'potions') {
      for (let i = 0; i < (result.count || 1); i++) {
        state.consumables.push({ id: 'health_potion', name: 'Health Potion', rarity: 'common', effect: 'heal', value: 30, price: 20 });
      }
    } else if (result.type === 'gold_percent_bonus') {
      const bonus = Math.floor((run?.totalGold || 0) * (result.percent || 0.5));
      state.gold += bonus;
      if (run) run.totalGold += bonus;
    } else if (result.type === 'xp_percent_bonus') {
      const bonus = Math.floor((run?.totalXp || 0) * (result.percent || 0.2));
      if (run) run.totalXp += bonus;
      const perMember = Math.floor(bonus / Math.max(1, state.party.length));
      for (const m of state.party) Party.addXp(m, perMember);
    } else if (result.type === 'stat_boost') {
      const target = state.party[Math.floor(Math.random() * state.party.length)];
      if (target) {
        const stats = ['str', 'int', 'dex', 'sta', 'wis'];
        const stat = stats[Math.floor(Math.random() * stats.length)];
        target.primaryStats[stat] += (result.amount || 2);
        Party.recalcDerived(target);
        UI.toast(`${target.name} gains +${result.amount || 2} ${stat.toUpperCase()}!`, 'toast-levelup');
      }
    } else if (result.type === 'full_heal') {
      for (const m of state.party) {
        Party.recalcDerived(m);
        m._currentHp = m.derived.hp;
        m._currentMp = m.derived.mp;
      }
    } else if (result.type === 'loot_and_gold') {
      for (let i = 0; i < (result.loot_count || 1); i++) {
        const item = Items.generateRandom(run?.recLevel || 1, null, run?.dungeon?.tier || 1);
        if (item) { state.inventory.push(item); if (run) run.loot.push(item); }
      }
      state.gold += result.gold || 0;
      if (run) run.totalGold += result.gold || 0;
    } else if (result.type === 'loot_and_materials') {
      for (let i = 0; i < (result.loot_count || 1); i++) {
        const item = Items.generateRandom(run?.recLevel || 1, null, run?.dungeon?.tier || 1);
        if (item) { state.inventory.push(item); if (run) run.loot.push(item); }
      }
      for (let i = 0; i < (result.mat_count || 3); i++) {
        const matTypes = ['metal_scrap', 'leather_scrap', 'gem_dust', 'essence', 'cloth_scrap', 'wood_scrap'];
        Crafting.addMaterials(state, [{ id: matTypes[Math.floor(Math.random() * matTypes.length)], rarity: Items.RARITIES[Math.min(Math.floor(Math.random() * 3), (run?.dungeon?.tier || 1) - 1)], quantity: 1 }]);
      }
      if (result.gold) { state.gold += result.gold; if (run) run.totalGold += result.gold; }
    } else if (result.type === 'safe_and_loot') {
      for (let i = 0; i < (result.loot_count || 1); i++) {
        const item = Items.generateRandom(run?.recLevel || 1, null, run?.dungeon?.tier || 1);
        if (item) { state.inventory.push(item); if (run) run.loot.push(item); }
      }
    } else if (result.type === 'blood_trade') {
      for (const m of state.party) {
        if (m._currentHp != null) m._currentHp = Math.max(1, m._currentHp - Math.floor((m.derived?.hp || 100) * (result.hp_cost || 0.15)));
      }
      // Generate a high-tier item
      const maxTier = Math.min(6, (run?.dungeon?.tier || 1) + 2);
      const item = Items.generateRandom((run?.recLevel || 1) + 15, null, maxTier);
      if (item) { state.inventory.push(item); if (run) run.loot.push(item); }
    } else if (result.type === 'buff_next_run') {
      if (!state.nextRunBuffs) state.nextRunBuffs = [];
      state.nextRunBuffs.push({ stat: result.stat, value: result.value });
    }
    UI.updateTopBar(state);
  }

  function applyPostDungeonBonuses(run) {
    // Apply any pending next-run buffs, XP/gold bonuses accumulated during events
    // (most are applied inline by applyEventResult)
  }

  function showRestPoint(onDone) {
    const restData = Dungeon.applyRest(state);
    document.getElementById('rest-text').textContent =
      `Your party rests and recovers. +${Math.round(restData.heal_percent * 100)}% HP, +${Math.round(restData.mp_restore_percent * 100)}% MP restored.`;
    document.getElementById('modal-rest').style.display = 'flex';
    document.getElementById('btn-rest-continue').style.display = '';
    document.getElementById('btn-rest-continue').onclick = () => {
      document.getElementById('modal-rest').style.display = 'none';
      if (onDone) onDone();
    };
  }

  function advanceToNext() {
    const next = Dungeon.advanceWave();
    if (!next) {
      finishDungeon(true);
    } else {
      startEncounter();
    }
  }

  function finishDungeon(victory, totalPartyKill) {
    const run = Dungeon.endRun(victory);

    if (victory && !state.clearedDungeons.includes(run.dungeonId)) {
      state.clearedDungeons.push(run.dungeonId);
      state.stats.deepestDungeon = run.dungeon.dungeon_name;
      const bonus = run.dungeon.completion_rewards?.first_clear_bonus;
      if (bonus) {
        state.gold += bonus.gold || 0;
        run.totalXp += bonus.xp || 0;
        const bonusXpPer = Math.floor((bonus.xp || 0) / state.party.length);
        for (const member of state.party) {
          const result = Party.addXp(member, bonusXpPer);
          if (result.leveled) UI.toast(`${member.name} reached level ${result.newLevel}!`, 'toast-levelup');
        }
        run.totalGold += bonus.gold || 0;
      }
    }

    state.dungeonRuns++;
    state.stats.dungeonRuns++;

    // Permadeath: if total party kill, mark all as dead
    if (totalPartyKill) {
      state.partyDead = true;
    } else {
      // Remove perma-dead flag, reset HP for survivors
      for (const m of state.party) {
        if (m._dead) {
          // Dead members stay dead until resurrected at alchemist
          m.needsResurrection = true;
        }
        delete m._currentHp;
        delete m._currentMp;
        delete m._dead;
      }
    }

    saveGame();

    // Post-dungeon event (only on victory)
    if (victory) {
      const postEvent = Dungeon.rollPostDungeonEvent();
      if (postEvent) {
        showDungeonEvent(postEvent, () => {
          // Apply any XP/gold bonus from event results
          applyPostDungeonBonuses(run);
          showDungeonResult(run, victory, totalPartyKill);
        });
        return;
      }
    }
    showDungeonResult(run, victory, totalPartyKill);
  }

  function showDungeonResult(run, victory, totalPartyKill) {
    UI.showScreen('dungeon-result');
    UI.renderResult({
      victory,
      totalGold: run.totalGold,
      totalXp: run.totalXp,
      loot: run.loot,
      totalPartyKill,
      modifier: run.modifier,
    }, state);
  }

  function returnToTown() {
    goToTown();
  }

  function toggleBattleMode() {
    const manual = !Combat.getManualMode();
    Combat.setManualMode(manual);
    const btn = document.getElementById('btn-battle-mode');
    btn.textContent = manual ? 'Mode: Manual' : 'Mode: Auto';
    btn.classList.toggle('btn-battle-mode-active', manual);
  }

  function toggleSpeed() {
    const speeds = [1, 2, 4, 8];
    const current = Combat.getSpeed();
    const nextIdx = (speeds.indexOf(current) + 1) % speeds.length;
    Combat.setSpeed(speeds[nextIdx]);
    document.getElementById('btn-auto-speed').textContent = `Speed: ${speeds[nextIdx]}x`;

    // Restart step loop with new speed
    if (combatInterval) {
      clearInterval(combatInterval);
      const combatState = Combat.getState();
      const encounter = Dungeon.getCurrentEncounter();
      if (combatState && !combatState.finished) {
        startStepLoop(combatState, encounter);
      }
    }
  }

  function skipCombat() {
    if (combatInterval) {
      clearInterval(combatInterval);
      combatInterval = null;
    }
    if (combatEnded) return;
    combatEnded = true;
    const combatState = Combat.runToEnd();
    const encounter = Dungeon.getCurrentEncounter();
    UI.renderCombatState(combatState, encounter);
    UI.updateCombatLog(Combat.getLog());
    onCombatEnd(combatState, encounter);
  }

  function fleeCombat() {
    if (combatInterval) { clearInterval(combatInterval); combatInterval = null; }
    if (combatEnded) return;
    combatEnded = true;
    // Fleeing: keep loot earned so far but dungeon counts as not cleared
    // Each party member takes some damage from fleeing
    const combatState = Combat.getState();
    for (const c of combatState.combatants.filter(c => c.isParty && !c.dead)) {
      const fleeDmg = Math.floor(c.maxHp * 0.1);
      c.hp = Math.max(1, c.hp - fleeDmg);
    }
    Combat.syncPartyState();
    UI.toast('The party flees!', 'toast-error');
    finishDungeon(false, false);
  }

  function getState() { return state; }

  return { init, enterDungeon, getState };
})();

// Start the game when DOM is ready
document.addEventListener('DOMContentLoaded', () => Game.init());
