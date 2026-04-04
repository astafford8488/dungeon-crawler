// ui.js — Screen management, rendering, modals, toasts
const UI = (() => {
  let currentScreen = 'menu';

  function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById('screen-' + screenId);
    if (screen) screen.classList.add('active');
    currentScreen = screenId;

    // Show/hide top bar
    const topBar = document.getElementById('top-bar');
    topBar.style.display = screenId === 'menu' ? 'none' : 'flex';
  }

  function updateTopBar(gameState) {
    document.getElementById('gold-display').textContent = `Gold: ${gameState.gold}`;
    const avgLevel = gameState.party.length > 0
      ? Math.round(gameState.party.reduce((s, m) => s + m.level, 0) / gameState.party.length)
      : 0;
    document.getElementById('party-level-display').textContent = `Party Avg Lv: ${avgLevel}`;
  }

  function renderPartyOverview(gameState) {
    const bar = document.getElementById('party-overview');
    bar.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const member = gameState.party[i];
      if (member) {
        Party.recalcDerived(member);
        const card = document.createElement('div');
        card.className = 'party-member-card';
        const sprite = Assets.getCharacterSprite(member.classId);
        card.innerHTML = `
          <div class="pm-avatar">${sprite ? Assets.spriteImg(sprite, 40) : Party.getClassIcon(member.classId)}</div>
          <div class="pm-info">
            <div class="pm-name">${member.name}</div>
            <div class="pm-class">${Data.cache.classes[member.classId].role.replace(/_/g, ' ')}</div>
            <div class="pm-level">Lv ${member.level}</div>
          </div>
        `;
        card.addEventListener('click', () => showCharacterDetail(member, gameState));
        bar.appendChild(card);
      } else {
        const empty = document.createElement('div');
        empty.className = 'party-slot-empty';
        empty.textContent = 'Empty Slot';
        bar.appendChild(empty);
      }
    }
  }

  // Dungeon select screen
  function renderDungeonSelect(gameState) {
    const list = document.getElementById('dungeon-list');
    list.innerHTML = '';

    for (const dungeon of Data.cache.dungeons) {
      const unlocked = isDungeonUnlocked(dungeon, gameState);
      const cleared = gameState.clearedDungeons.includes(dungeon.dungeon_id);
      const card = document.createElement('div');
      card.className = 'dungeon-card' + (unlocked ? '' : ' locked');
      card.innerHTML = `
        <div class="dc-info">
          <div class="dc-name">${unlocked ? dungeon.dungeon_name : '???'}</div>
          <div class="dc-theme">${unlocked ? dungeon.theme : 'Locked'}</div>
          <div class="dc-level">Base Level: ${dungeon.base_level}</div>
        </div>
        <div class="dc-status ${cleared ? 'cleared' : 'new'}">${cleared ? 'Cleared' : unlocked ? 'New' : 'Locked'}</div>
      `;
      if (unlocked) {
        card.addEventListener('click', () => selectDungeon(dungeon, gameState));
      }
      list.appendChild(card);
    }
  }

  function isDungeonUnlocked(dungeon, gameState) {
    if (dungeon.unlock_condition === 'available_from_start') return true;
    const prev = dungeon.unlock_condition.replace('clear_', '');
    return gameState.clearedDungeons.includes(prev);
  }

  function selectDungeon(dungeon, gameState) {
    const config = document.getElementById('dungeon-config');
    config.style.display = 'block';
    document.getElementById('dungeon-config-name').textContent = dungeon.dungeon_name;
    document.getElementById('dungeon-config-desc').textContent = dungeon.description;

    const slider = document.getElementById('diff-slider');
    const valSpan = document.getElementById('diff-value');

    // Calculate appropriate difficulty based on party level
    const avgLevel = gameState.party.length > 0
      ? Math.round(gameState.party.reduce((s, m) => s + m.level, 0) / gameState.party.length)
      : 1;
    // Recommended level formula: dungeon.base_level + (difficulty - 1) * 3
    // Solve for difficulty: difficulty = (avgLevel - dungeon.base_level) / 3 + 1
    const appropriateDiff = Math.max(1, Math.min(10, Math.round((avgLevel - dungeon.base_level) / 3 + 1)));
    slider.value = appropriateDiff;

    slider.oninput = () => {
      valSpan.textContent = slider.value;
      const recLvl = dungeon.base_level + (parseInt(slider.value) - 1) * 3;
      document.getElementById('dungeon-rec-level').textContent = `Recommended Level: ${recLvl} (Party Avg: ${avgLevel})`;
    };
    slider.oninput();

    document.getElementById('btn-enter-dungeon').onclick = () => {
      if (gameState.party.length === 0) {
        toast('Hire party members first!', 'toast-error');
        return;
      }
      Game.enterDungeon(dungeon.dungeon_id, parseInt(slider.value));
    };

    // Highlight selected
    document.querySelectorAll('.dungeon-card').forEach(c => c.classList.remove('selected'));
    event?.target?.closest('.dungeon-card')?.classList.add('selected');
  }

  // Combat rendering
  function renderCombatState(combatState, encounter) {
    // Narrative
    if (encounter?.description) {
      document.getElementById('combat-narrative').textContent = encounter.description;
    }

    // Enemy side
    const enemySide = document.getElementById('enemy-side');
    enemySide.innerHTML = '';
    for (const c of combatState.combatants.filter(c => !c.isParty)) {
      enemySide.appendChild(createCombatantCard(c));
    }

    // Party side
    const partySide = document.getElementById('party-side');
    partySide.innerHTML = '';
    for (const c of combatState.combatants.filter(c => c.isParty)) {
      partySide.appendChild(createCombatantCard(c));
    }
  }

  function createCombatantCard(c) {
    const card = document.createElement('div');
    card.className = 'combatant' + (c.dead ? ' dead' : '');
    card.id = 'combatant-' + c.id;

    const hpPct = Math.max(0, Math.round(c.hp / c.maxHp * 100));
    const mpPct = Math.max(0, Math.round(c.mp / c.maxMp * 100));

    const spriteSrc = c.isParty
      ? Assets.getCharacterSprite(c.classId)
      : Assets.getMonsterSprite(c.monsterId);
    const icon = spriteSrc ? Assets.spriteImg(spriteSrc, 36) : (c.isParty ? Party.getClassIcon(c.classId) : '&#128126;');

    card.innerHTML = `
      <div class="cb-avatar">${icon}</div>
      <div class="cb-info">
        <div class="cb-name">${c.name}${c.isBoss ? ' &#9733;' : ''}</div>
        <div class="cb-bars">
          <div class="bar-container">
            <div class="bar-fill hp" style="width:${hpPct}%"></div>
            <div class="bar-text">${c.hp}/${c.maxHp}</div>
          </div>
          <div class="bar-container mp-bar">
            <div class="bar-fill mp" style="width:${mpPct}%"></div>
            <div class="bar-text">${c.mp}/${c.maxMp}</div>
          </div>
        </div>
        <div class="cb-buffs">
          ${c.buffs.map(b => {
            const details = [];
            if (b.phys_atk_multiplier) details.push(`ATK+${Math.round((b.phys_atk_multiplier-1)*100)}%`);
            if (b.mag_atk_multiplier) details.push(`MATK+${Math.round((b.mag_atk_multiplier-1)*100)}%`);
            if (b.phys_def_multiplier) details.push(`DEF+${Math.round((b.phys_def_multiplier-1)*100)}%`);
            if (b.reduce_phys_atk) details.push(`ATK-${Math.round(b.reduce_phys_atk*100)}%`);
            if (b.reduce_spd) details.push(`SPD-${Math.round(b.reduce_spd*100)}%`);
            if (b.dodge_bonus) details.push(`Dodge+${Math.round(b.dodge_bonus*100)}%`);
            if (b.damage_taken_increase) details.push(`Vuln+${Math.round(b.damage_taken_increase*100)}%`);
            if (b.damage_reduction) details.push(`DR${Math.round(b.damage_reduction*100)}%`);
            if (b.isDot) details.push(`${Math.round((b.dotPercent||0.03)*100)}%/t`);
            if (b.stun) details.push('STUN');
            if (b.force_target) details.push('TAUNT');
            if (b.miss_chance) details.push(`Miss${Math.round(b.miss_chance*100)}%`);
            const detailStr = details.length > 0 ? details.join(' ') : '';
            const turnsStr = b.turnsLeft != null ? `${b.turnsLeft}t` : '';
            return `<div class="buff-icon-detail ${b.isDebuff ? 'debuff' : 'buff'}" title="${b.name}: ${detailStr} ${turnsStr}">${b.isDebuff ? '−' : '+'} <span class="buff-label">${b.name.slice(0,6)}${turnsStr ? ' '+turnsStr : ''}</span></div>`;
          }).join('')}
        </div>
      </div>
    `;
    return card;
  }

  function updateCombatLog(logs) {
    const logInner = document.getElementById('combat-log-inner');
    logInner.innerHTML = '';
    for (const entry of logs.slice(-50)) {
      const div = document.createElement('div');
      div.className = 'log-entry ' + (entry.cls || '');
      div.textContent = entry.text;
      logInner.appendChild(div);
    }
    logInner.scrollTop = logInner.scrollHeight;
  }

  function renderDungeonHeader(dungeonRun) {
    const mod = dungeonRun.modifier;
    const modStr = mod ? ` <span style="color:${mod.color || '#fff'};font-size:12px;" title="${mod.description}">${mod.icon} ${mod.name}</span>` : '';
    document.getElementById('dungeon-name-bar').innerHTML = dungeonRun.dungeon.dungeon_name + ' (Diff ' + dungeonRun.difficulty + ')' + modStr;
    document.getElementById('wave-current').textContent = dungeonRun.currentWave + 1;
    document.getElementById('wave-total').textContent = dungeonRun.encounters.length;
  }

  // Dungeon result screen
  function renderResult(result, gameState) {
    const title = document.getElementById('result-title');
    if (result.totalPartyKill) {
      title.textContent = 'Total Party Kill';
      title.className = 'defeat';
    } else {
      title.textContent = result.victory ? 'Victory!' : 'Defeat';
      title.className = result.victory ? 'victory' : 'defeat';
    }
    // Show modifier if any
    const modStr = result.modifier ? `<div style="font-size:13px;color:${result.modifier.color || '#fff'};margin-top:4px;">${result.modifier.icon} ${result.modifier.name}: ${result.modifier.description}</div>` : '';

    document.getElementById('result-rewards').innerHTML = `
      ${modStr}
      ${result.totalPartyKill ? '<div style="color:var(--danger);font-size:14px;margin:8px 0;">Your entire party has been wiped out. Dead members must be resurrected at the Alchemist.</div>' : ''}
      <div class="reward reward-gold"><div class="reward-value">${result.totalGold}</div><div class="reward-label">Gold</div></div>
      <div class="reward reward-xp"><div class="reward-value">${result.totalXp}</div><div class="reward-label">XP</div></div>
    `;

    // Loot
    const lootDiv = document.getElementById('result-loot');
    lootDiv.innerHTML = '';
    if (result.loot.length > 0) {
      const label = document.createElement('div');
      label.className = 'section-label';
      label.textContent = 'Loot Found';
      lootDiv.appendChild(label);
      for (const item of result.loot) {
        const lootEl = document.createElement('div');
        lootEl.className = 'loot-item';
        lootEl.innerHTML = `<span class="rarity-${item.rarity}">${item.name}</span>`;
        lootDiv.appendChild(lootEl);
      }
    }

    // XP gains per member
    const xpDiv = document.getElementById('result-xp');
    xpDiv.innerHTML = '<div class="section-label">Experience</div>';
    for (const member of gameState.party) {
      const pct = Math.round(member.xp / member.xpToNext * 100);
      const row = document.createElement('div');
      row.className = 'xp-gain-row';
      row.innerHTML = `
        <div class="xg-name">${member.name}</div>
        <div class="xg-bar"><div class="bar-container"><div class="bar-fill xp" style="width:${pct}%"></div><div class="bar-text">${member.xp}/${member.xpToNext}</div></div></div>
        <div class="xg-level">Lv ${member.level}</div>
      `;
      xpDiv.appendChild(row);
    }
  }

  // Character detail modal
  function showCharacterDetail(member, gameState) {
    Party.recalcDerived(member);
    const cls = Data.cache.classes[member.classId];
    const content = document.getElementById('char-detail-content');

    const allAbilities = Party.getAllAbilities(member);

    content.innerHTML = `
      <div class="char-detail">
        <div class="cd-header">
          <div class="cd-avatar">${Assets.getCharacterSprite(member.classId) ? Assets.spriteImg(Assets.getCharacterSprite(member.classId), 64) : Party.getClassIcon(member.classId)}</div>
          <div class="cd-title">
            <div class="cd-name">${member.name}</div>
            <div class="cd-class">${cls.role.replace(/_/g, ' ')}</div>
            <div class="cd-level">Level ${member.level} — XP: ${member.xp}/${member.xpToNext}</div>
          </div>
        </div>

        <div class="section-label">Primary Stats</div>
        <div class="stat-grid">
          <div class="stat-row"><span class="stat-name">STR</span><span class="stat-val">${member.totalPrimary?.str || member.primaryStats.str}</span></div>
          <div class="stat-row"><span class="stat-name">INT</span><span class="stat-val">${member.totalPrimary?.int || member.primaryStats.int}</span></div>
          <div class="stat-row"><span class="stat-name">DEX</span><span class="stat-val">${member.totalPrimary?.dex || member.primaryStats.dex}</span></div>
          <div class="stat-row"><span class="stat-name">STA</span><span class="stat-val">${member.totalPrimary?.sta || member.primaryStats.sta}</span></div>
        </div>

        <div class="section-label">Derived Stats</div>
        <div class="stat-grid">
          <div class="stat-row"><span class="stat-name">HP</span><span class="stat-val">${member.derived.hp}</span></div>
          <div class="stat-row"><span class="stat-name">MP</span><span class="stat-val">${member.derived.mp}</span></div>
          <div class="stat-row"><span class="stat-name">Phys ATK</span><span class="stat-val">${member.derived.phys_atk}</span></div>
          <div class="stat-row"><span class="stat-name">Mag ATK</span><span class="stat-val">${member.derived.mag_atk}</span></div>
          <div class="stat-row"><span class="stat-name">Phys DEF</span><span class="stat-val">${member.derived.phys_def}</span></div>
          <div class="stat-row"><span class="stat-name">Mag DEF</span><span class="stat-val">${member.derived.mag_def}</span></div>
          <div class="stat-row"><span class="stat-name">Speed</span><span class="stat-val">${member.derived.spd}</span></div>
          <div class="stat-row"><span class="stat-name">Crit</span><span class="stat-val">${Math.round(member.derived.crit_rate * 100)}%</span></div>
          <div class="stat-row"><span class="stat-name">Dodge</span><span class="stat-val">${Math.round(member.derived.dodge * 100)}%</span></div>
        </div>

        <div class="section-label">Equipment</div>
        <div class="equip-grid">
          ${cls.equipment_slots.map(slot => {
            const equipped = member.equipment[slot];
            return `<div class="equip-slot" data-slot="${slot}">
              <span class="es-label">${slot.replace('_', ' ')}</span>
              ${equipped
                ? `<span class="es-name rarity-${equipped.rarity}">${equipped.name}</span>`
                : `<span class="es-empty">Empty</span>`
              }
            </div>`;
          }).join('')}
        </div>

        <div class="section-label">Abilities</div>
        <div class="ability-list">
          ${allAbilities.map(ab => {
            const unlocked = member.level >= ab.level_required;
            return `<div class="ability-row ${unlocked ? '' : 'locked'}">
              <span class="ab-name">${ab.name}</span>
              <span class="ab-desc">${ab.description}</span>
              <span class="ab-cost">${ab.mp_cost ? ab.mp_cost + ' MP' : 'Free'}</span>
              <span class="ab-level">${unlocked ? '' : 'Lv ' + ab.level_required}</span>
            </div>`;
          }).join('')}
        </div>

        ${gameState.inventory.length > 0 ? `
        <div class="section-label">Inventory (click to equip)</div>
        <div class="equip-grid">
          ${gameState.inventory.filter(item => Party.canEquip(member, item)).map(item => `
            <div class="equip-slot" data-equip-uid="${item.uid}">
              <span class="es-name rarity-${item.rarity}">${item.name}</span>
              <span class="es-label">${Items.statSummary(item)}</span>
            </div>
          `).join('')}
        </div>` : ''}
      </div>
    `;

    // Equip from inventory handlers
    content.querySelectorAll('[data-equip-uid]').forEach(el => {
      el.addEventListener('click', () => {
        const uid = parseInt(el.dataset.equipUid);
        const item = gameState.inventory.find(i => i.uid === uid);
        if (!item) return;
        const old = Party.equip(member, item);
        gameState.inventory = gameState.inventory.filter(i => i.uid !== uid);
        if (old) gameState.inventory.push(old);
        toast(`Equipped ${item.name}!`, 'toast-success');
        showCharacterDetail(member, gameState);
        UI.updateTopBar(gameState);
      });
    });

    // Unequip handlers
    content.querySelectorAll('[data-slot]').forEach(el => {
      el.addEventListener('click', () => {
        const slot = el.dataset.slot;
        const equipped = member.equipment[slot];
        if (!equipped) return;
        const old = Party.unequip(member, slot);
        if (old) gameState.inventory.push(old);
        toast(`Unequipped ${old.name}`, 'toast-success');
        showCharacterDetail(member, gameState);
      });
    });

    document.getElementById('modal-character').style.display = 'flex';
  }

  // Toast notifications
  function toast(message, cls) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast ' + (cls || '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('toast-out'); setTimeout(() => toast.remove(), 300); }, 2500);
  }

  // Modal close handlers
  function initModals() {
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.modal').style.display = 'none';
      });
    });
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        // Don't close game-flow modals on backdrop click (rest, sell-confirm, auth, leaderboard)
        const noBackdropClose = ['modal-rest', 'modal-sell-confirm', 'modal-auth', 'modal-leaderboard'];
        if (e.target === modal && !noBackdropClose.includes(modal.id)) {
          modal.style.display = 'none';
        }
      });
    });
  }

  // Consumable panel in combat
  function renderConsumables(gameState, onUse) {
    const list = document.getElementById('consumable-list');
    if (!list) return;
    list.innerHTML = '';

    // Group consumables by id+rarity
    const groups = {};
    for (const c of (gameState.consumables || [])) {
      const key = c.id + '_' + c.rarity;
      if (!groups[key]) groups[key] = { ...c, count: 0 };
      groups[key].count++;
    }

    for (const [key, item] of Object.entries(groups)) {
      const btn = document.createElement('button');
      btn.className = 'consumable-btn';
      btn.innerHTML = `<span class="cb-name rarity-${item.rarity}">${item.name}</span><span class="cb-qty">x${item.count}</span>`;
      btn.addEventListener('click', () => {
        if (onUse) onUse(item);
      });
      list.appendChild(btn);
    }

    if (Object.keys(groups).length === 0) {
      list.innerHTML = '<div style="font-size:9px;color:var(--text-dim);text-align:center;">No items</div>';
    }
  }

  // Level-up screen
  function showLevelUp(member, gameState, onClose) {
    if (!member.unspentStatPoints) member.unspentStatPoints = 0;
    if (!member.pendingAbilityChoices) member.pendingAbilityChoices = [];

    Party.recalcDerived(member);
    const cls = Data.cache.classes[member.classId];
    const content = document.getElementById('levelup-content');

    function render() {
      Party.recalcDerived(member);
      const pts = member.unspentStatPoints || 0;
      const abilityChoices = member.pendingAbilityChoices || [];
      const sprite = Assets.getCharacterSprite(member.classId);
      const upgrades = member.abilityUpgrades || {};

      const statInfo = {
        str: `P.ATK: ${member.derived.phys_atk}, P.DEF: ${member.derived.phys_def}`,
        int: `M.ATK: ${member.derived.mag_atk}, Heal: ${member.derived.heal_power}`,
        dex: `SPD: ${member.derived.spd}, Crit: ${Math.round(member.derived.crit_rate * 100)}%`,
        sta: `HP: ${member.derived.hp}, M.DEF: ${member.derived.mag_def}`,
        wis: `MP Regen: ${member.derived.mp_regen}, Holy/Dark Resist`,
      };

      const allDone = pts <= 0 && abilityChoices.length === 0;

      content.innerHTML = `
        <div class="levelup-layout">
          <div class="levelup-header">
            <div class="lu-avatar">${sprite ? Assets.spriteImg(sprite, 64) : Party.getClassIcon(member.classId)}</div>
            <div>
              <div class="lu-name">${member.name}</div>
              <div class="lu-level">Level ${member.level} ${cls.role.replace(/_/g, ' ')}</div>
              <div class="lu-points">${pts > 0 ? pts + ' stat points to allocate' : 'All points allocated'}</div>
            </div>
          </div>

          ${pts > 0 ? `
          <div class="section-label">Allocate Stat Points</div>
          <div class="stat-allocate-grid">
            ${['str', 'int', 'dex', 'sta', 'wis'].map(stat => `
              <div class="stat-allocate-row">
                <span class="sa-name">${stat}</span>
                <span class="sa-value">${member.primaryStats[stat]}</span>
                <span class="sa-derived">${statInfo[stat]}</span>
                <button class="btn-allocate" data-stat="${stat}">+</button>
              </div>
            `).join('')}
          </div>
          ` : ''}

          ${abilityChoices.map((choice, idx) => `
            <div class="section-label">Choose Ability (Level ${choice.level} Tier)</div>
            <div class="pending-abilities">
              ${choice.choices.map(ab => {
                const known = member.abilities.includes(ab.id);
                const upgradeLevel = upgrades[ab.id] || 0;
                // Show upgrade effects
                let upgradeEffectStr = '';
                if (known) {
                  const effects = [];
                  if (ab.damage_multiplier) effects.push(`Damage: ${ab.damage_multiplier}x → ${(ab.damage_multiplier * 1.2).toFixed(1)}x (+20%)`);
                  if (ab.heal_multiplier) effects.push(`Healing: +20%`);
                  if (ab.cooldown > 0) effects.push(`Cooldown: ${ab.cooldown} → ${Math.max(0, ab.cooldown - 1)} (-1 turn)`);
                  if (ab.mp_cost > 0) effects.push(`MP Cost: ${ab.mp_cost} → ${Math.floor(ab.mp_cost * 0.85)} (-15%)`);
                  upgradeEffectStr = effects.length > 0 ? `<div style="font-size:10px;color:var(--success);margin-top:2px;">${effects.join(' | ')}</div>` : '';
                }
                return `<div class="pending-ability">
                  <div class="pa-info">
                    <div class="pa-name">${ab.name} ${known ? `<span style="color:var(--accent-light);font-size:10px;">(Upgrade Lv${upgradeLevel + 1})</span>` : ''}</div>
                    <div class="pa-desc">${ab.description}</div>
                    <div class="pa-cost">${ab.mp_cost ? ab.mp_cost + ' MP' : 'Free'}${ab.cooldown ? ' | CD: ' + ab.cooldown : ''}</div>
                    ${upgradeEffectStr}
                  </div>
                  <button class="btn-learn" data-choice-idx="${idx}" data-ability="${ab.id}">${known ? 'Upgrade' : 'Learn'}</button>
                </div>`;
              }).join('')}
            </div>
          `).join('')}

          <div class="section-label">Current Abilities</div>
          <div class="ability-list">
            ${member.abilities.map(aid => {
              const ab = Party.getAbility(member, aid);
              if (!ab) return '';
              const ul = upgrades[aid] || 0;
              return `<div class="ability-row">
                <span class="ab-name">${ab.name}${ul > 0 ? ` +${ul}` : ''}</span>
                <span class="ab-desc">${ab.description}</span>
                <span class="ab-cost">${ab.mp_cost ? ab.mp_cost + ' MP' : 'Free'}</span>
              </div>`;
            }).join('')}
          </div>

          ${allDone ? '<button class="btn-primary" id="btn-levelup-done" style="align-self:center;margin-top:8px;">Done</button>' : ''}
        </div>
      `;

      content.querySelectorAll('.btn-allocate').forEach(btn => {
        btn.addEventListener('click', () => { Party.allocateStatPoint(member, btn.dataset.stat); render(); });
      });

      content.querySelectorAll('.btn-learn').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.choiceIdx);
          const abilityId = btn.dataset.ability;
          const known = member.abilities.includes(abilityId);
          Party.chooseAbility(member, idx, abilityId);
          toast(`${member.name} ${known ? 'upgraded' : 'learned'} ${btn.closest('.pending-ability').querySelector('.pa-name').textContent.split('(')[0].trim()}!`, 'toast-success');
          render();
        });
      });

      const doneBtn = content.querySelector('#btn-levelup-done');
      if (doneBtn) {
        doneBtn.addEventListener('click', () => { document.getElementById('modal-levelup').style.display = 'none'; if (onClose) onClose(); });
      }
    }

    render();
    document.getElementById('modal-levelup').style.display = 'flex';
    const modal = document.getElementById('modal-levelup');
    modal.querySelector('.modal-close').onclick = () => { modal.style.display = 'none'; if (onClose) onClose(); };
  }

  // Party stats dashboard
  function showPartyDashboard(gameState) {
    const content = document.getElementById('char-detail-content');
    const s = gameState.stats || {};
    const partyMembers = gameState.party || [];
    const avgLv = partyMembers.length > 0 ? Math.round(partyMembers.reduce((sum, m) => sum + m.level, 0) / partyMembers.length) : 0;
    const totalPlaytime = gameState.dungeonRuns || 0;

    // Gather all save slot data for the overview
    const allSlots = [];
    for (let i = 0; i < 3; i++) {
      const raw = localStorage.getItem('dungeon_crawler_save_' + i);
      if (!raw) continue;
      try {
        const d = JSON.parse(raw);
        allSlots.push({
          slot: i + 1,
          name: d.partyName || 'Unnamed',
          members: d.party?.map(m => m.name + ' Lv' + m.level).join(', ') || 'Empty',
          avgLevel: d.party?.length > 0 ? Math.round(d.party.reduce((s, m) => s + m.level, 0) / d.party.length) : 0,
          gold: d.gold || 0,
          stats: d.stats || {},
          cleared: d.clearedDungeons?.length || 0,
        });
      } catch (e) {}
    }

    content.innerHTML = `
      <div style="max-width:550px;">
        <h2 style="color:var(--text-bright);margin-bottom:12px;">${gameState.partyName || 'Party'} — Dashboard</h2>

        <div class="section-label">Current Party</div>
        <div class="stat-grid" style="margin-bottom:12px;">
          <div class="stat-row"><span class="stat-name">Party Name</span><span class="stat-val">${gameState.partyName || 'Unnamed'}</span></div>
          <div class="stat-row"><span class="stat-name">Avg Level</span><span class="stat-val">${avgLv}</span></div>
          <div class="stat-row"><span class="stat-name">Gold</span><span class="stat-val" style="color:var(--gold);">${gameState.gold}</span></div>
          <div class="stat-row"><span class="stat-name">Dungeons Cleared</span><span class="stat-val">${(gameState.clearedDungeons || []).length} / 6</span></div>
        </div>

        <div class="section-label">Combat Statistics</div>
        <div class="stat-grid" style="margin-bottom:12px;">
          <div class="stat-row"><span class="stat-name">Dungeon Runs</span><span class="stat-val">${s.dungeonRuns || 0}</span></div>
          <div class="stat-row"><span class="stat-name">Monsters Killed</span><span class="stat-val">${s.monstersKilled || 0}</span></div>
          <div class="stat-row"><span class="stat-name">Bosses Killed</span><span class="stat-val">${s.bossesKilled || 0}</span></div>
          <div class="stat-row"><span class="stat-name">Party Deaths</span><span class="stat-val" style="color:var(--danger);">${s.deaths || 0}</span></div>
          <div class="stat-row"><span class="stat-name">Total XP Earned</span><span class="stat-val">${s.totalXpEarned || 0}</span></div>
          <div class="stat-row"><span class="stat-name">Total Gold Earned</span><span class="stat-val" style="color:var(--gold);">${s.totalGoldEarned || 0}</span></div>
          <div class="stat-row"><span class="stat-name">Deepest Dungeon</span><span class="stat-val">${s.deepestDungeon || 'None'}</span></div>
        </div>

        <div class="section-label">Members</div>
        <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px;">
          ${partyMembers.map(m => {
            Party.recalcDerived(m);
            const sprite = Assets.getCharacterSprite(m.classId);
            return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-card);border-radius:4px;">
              <div style="width:32px;height:32px;">${sprite ? Assets.spriteImg(sprite, 32) : Party.getClassIcon(m.classId)}</div>
              <div style="flex:1;">
                <div style="font-size:12px;font-weight:600;color:var(--text-bright);">${m.name} <span style="color:var(--accent-light);">Lv${m.level}</span></div>
                <div style="font-size:10px;color:var(--text-dim);">HP ${m.derived.hp} | ATK ${m.derived.phys_atk}/${m.derived.mag_atk} | DEF ${m.derived.phys_def} | SPD ${m.derived.spd}</div>
              </div>
            </div>`;
          }).join('')}
        </div>

        ${s.classDps && Object.keys(s.classDps).length > 0 ? `
        <div class="section-label">Class DPS Analytics</div>
        <table style="width:100%;font-size:11px;border-collapse:collapse;margin-bottom:12px;">
          <tr style="color:var(--text-dim);text-align:left;">
            <th style="padding:4px;">Class</th>
            <th>DPS/Turn</th>
            <th>Total Dmg</th>
            <th>Healing</th>
            <th>Dmg Taken</th>
            <th>Kills</th>
            <th>Combats</th>
          </tr>
          ${Object.entries(s.classDps).sort((a, b) => (b[1].totalDamage / Math.max(1, b[1].totalTurns)) - (a[1].totalDamage / Math.max(1, a[1].totalTurns))).map(([cls, cd]) => {
            const dps = cd.totalTurns > 0 ? (cd.totalDamage / cd.totalTurns).toFixed(1) : '0';
            const hps = cd.totalTurns > 0 ? (cd.totalHealing / cd.totalTurns).toFixed(1) : '0';
            return `<tr style="border-top:1px solid var(--border);">
              <td style="padding:4px;font-weight:600;color:var(--text-bright);">${cls.charAt(0).toUpperCase() + cls.slice(1)}</td>
              <td style="color:var(--danger);">${dps}</td>
              <td>${cd.totalDamage}</td>
              <td style="color:var(--success);">${cd.totalHealing}</td>
              <td>${cd.totalDamageTaken}</td>
              <td>${cd.kills}</td>
              <td>${cd.combats}</td>
            </tr>`;
          }).join('')}
        </table>
        ${Object.entries(s.classDps).map(([cls, cd]) => {
          const abilities = Object.entries(cd.abilityDamage || {}).sort((a, b) => b[1] - a[1]);
          if (abilities.length === 0) return '';
          return `<div style="margin-bottom:6px;"><span style="font-weight:600;font-size:11px;color:var(--text-bright);">${cls.charAt(0).toUpperCase() + cls.slice(1)} — Ability Breakdown:</span>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:2px;">${abilities.map(([name, dmg]) => `<span style="font-size:10px;background:var(--bg-input);padding:2px 6px;border-radius:3px;">${name}: ${dmg} dmg</span>`).join('')}</div>
          </div>`;
        }).join('')}
        ` : ''}

        ${allSlots.length > 1 ? `
        <div class="section-label">All Save Slots</div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          ${allSlots.map(sl => `<div style="padding:6px 8px;background:var(--bg-card);border-radius:4px;font-size:11px;">
            <div style="font-weight:600;color:var(--text-bright);">Slot ${sl.slot}: ${sl.name} (Avg Lv${sl.avgLevel}, ${sl.gold}g)</div>
            <div style="color:var(--text-dim);">${sl.members}</div>
            <div style="color:var(--text-dim);">Cleared: ${sl.cleared}/6 | Kills: ${sl.stats.monstersKilled || 0} | Deaths: ${sl.stats.deaths || 0} | Runs: ${sl.stats.dungeonRuns || 0}</div>
          </div>`).join('')}
        </div>
        ` : ''}
      </div>
    `;

    document.getElementById('modal-character').style.display = 'flex';
  }

  // Manual combat controls
  function showManualControls(actor, onChoose) {
    const container = document.getElementById('manual-controls');
    const abilitiesDiv = document.getElementById('manual-abilities');
    const targetsDiv = document.getElementById('manual-targets');
    const targetList = document.getElementById('manual-target-list');
    const actorName = document.getElementById('manual-actor-name');

    container.style.display = 'block';
    targetsDiv.style.display = 'none';
    actorName.textContent = actor.name;

    const combatState = Combat.getState();
    const available = actor.abilities.filter(ab =>
      ab.type !== 'passive' && ab.currentCooldown <= 0 && (ab.mp_cost || 0) <= actor.mp
    );

    abilitiesDiv.innerHTML = '';
    for (const ab of actor.abilities) {
      const canUse = ab.type !== 'passive' && ab.currentCooldown <= 0 && (ab.mp_cost || 0) <= actor.mp;
      const btn = document.createElement('button');
      btn.className = 'manual-ability-btn';
      btn.disabled = !canUse;
      btn.innerHTML = `
        <span class="mab-name">${ab.name}</span>
        ${ab.mp_cost ? `<span class="mab-cost">${ab.mp_cost} MP</span>` : ''}
        ${ab.currentCooldown > 0 ? `<span class="mab-cd">CD: ${ab.currentCooldown}</span>` : ''}
        <span class="mab-desc">${ab.description || ''}</span>
      `;

      if (canUse) {
        btn.addEventListener('click', () => {
          const needsTarget = ab.target === 'single_enemy' || ab.target === 'single_ally';
          if (needsTarget) {
            showTargetSelection(ab, actor, combatState, onChoose);
          } else {
            onChoose(ab.id, null);
          }
        });
      }
      abilitiesDiv.appendChild(btn);
    }
  }

  function showTargetSelection(ability, actor, combatState, onChoose) {
    const targetsDiv = document.getElementById('manual-targets');
    const targetList = document.getElementById('manual-target-list');
    targetsDiv.style.display = 'block';
    targetList.innerHTML = '';

    const isHeal = ability.type === 'heal' || ability.target === 'single_ally';
    const pool = isHeal
      ? combatState.combatants.filter(c => c.isParty && !c.dead)
      : combatState.combatants.filter(c => !c.isParty && !c.dead);

    for (const target of pool) {
      const btn = document.createElement('button');
      btn.className = 'manual-target-btn';
      const hpPct = Math.round(target.hp / target.maxHp * 100);
      btn.innerHTML = `${target.name} <span class="mt-hp">${target.hp}/${target.maxHp} (${hpPct}%)</span>`;
      btn.addEventListener('click', () => {
        onChoose(ability.id, target.id);
      });
      targetList.appendChild(btn);
    }
  }

  function hideManualControls() {
    document.getElementById('manual-controls').style.display = 'none';
  }

  return {
    showScreen, updateTopBar, renderPartyOverview, renderDungeonSelect,
    renderCombatState, updateCombatLog, renderDungeonHeader, renderResult,
    showCharacterDetail, showLevelUp, showPartyDashboard, renderConsumables, toast, initModals,
    showManualControls, hideManualControls,
  };
})();
