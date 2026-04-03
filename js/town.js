// town.js — Town building interactions (guild, blacksmith, alchemist)
const Town = (() => {
  let blacksmithStock = [];
  let alchemistStock = [];
  let currentShopTab = 'weapons';
  let currentAlchTab = 'potions';
  let selectedShopItem = null;

  function refreshShops(playerLevel, partyClasses, maxDungeonTier) {
    blacksmithStock = Items.generateShopStock(playerLevel, partyClasses, maxDungeonTier || 1);
    alchemistStock = generateAlchemistStock(playerLevel);
  }

  function generateAlchemistStock(playerLevel) {
    const cons = Data.cache.consumables;
    const stock = [];
    // Add potions of appropriate rarity
    const maxRarityIdx = Math.min(Math.floor(playerLevel / 8), 4); // up to legendary at high levels
    const rarities = Items.RARITIES.slice(0, maxRarityIdx + 1);

    for (const potion of cons.potions) {
      for (const rarity of rarities) {
        const tier = potion.values_by_rarity[rarity];
        if (!tier) continue;
        stock.push({
          uid: 'cons_' + potion.id + '_' + rarity,
          id: potion.id,
          name: tier.name,
          type: 'consumable',
          subtype: 'potion',
          rarity,
          description: potion.description,
          effect: potion.effect,
          value: tier.value,
          price: tier.price,
          target: potion.target,
          tags: potion.tags,
        });
      }
    }

    for (const buff of cons.buff_potions) {
      for (const rarity of rarities) {
        const tier = buff.values_by_rarity[rarity];
        if (!tier) continue;
        stock.push({
          uid: 'cons_' + buff.id + '_' + rarity,
          id: buff.id,
          name: tier.name,
          type: 'consumable',
          subtype: 'buff_potion',
          rarity,
          description: buff.description,
          effect: buff.effect,
          value: tier.value,
          price: tier.price,
          target: buff.target,
          duration: buff.duration,
          tags: buff.tags,
        });
      }
    }

    for (const scroll of cons.scrolls) {
      for (const rarity of rarities) {
        const tier = scroll.values_by_rarity?.[rarity];
        if (!tier) continue;
        stock.push({
          uid: 'cons_' + scroll.id + '_' + rarity,
          id: scroll.id,
          name: tier.name,
          type: 'consumable',
          subtype: 'scroll',
          rarity,
          description: scroll.description,
          effect: scroll.effect,
          value: tier.value,
          price: tier.price,
          target: scroll.target,
          tags: scroll.tags,
        });
      }
    }

    // Special consumables
    for (const spec of cons.special_consumables) {
      stock.push({
        uid: 'cons_' + spec.id,
        id: spec.id,
        name: spec.name,
        type: 'consumable',
        subtype: 'special',
        rarity: 'common',
        description: spec.description,
        effect: spec.effect,
        price: spec.price,
        target: spec.target,
        tags: spec.tags,
      });
    }

    // Crafting reagent packs — doubles per rarity, 3-10 reagents
    for (const rarity of rarities) {
      const rarIdx = Items.RARITIES.indexOf(rarity);
      const packPrice = 100 * Math.pow(2, rarIdx); // 100, 200, 400, 800, 1600, 3200, 6400
      stock.push({
        uid: 'pack_' + rarity,
        id: 'reagent_pack_' + rarity,
        name: rarity.charAt(0).toUpperCase() + rarity.slice(1) + ' Reagent Pack',
        type: 'consumable',
        subtype: 'reagent_pack',
        rarity,
        description: `Contains 3-10 ${rarity} crafting reagents of random types.`,
        effect: 'reagent_pack',
        price: packPrice,
        tags: ['consumable', 'crafting'],
      });
    }

    return stock;
  }

  // Render guild screen
  function renderGuild(gameState) {
    const roster = document.getElementById('guild-roster');
    const partyList = document.getElementById('guild-party-list');
    const partyCount = document.getElementById('party-count');

    partyCount.textContent = gameState.party.length;

    // Show all classes available for hire
    roster.innerHTML = '';
    for (const [classId, cls] of Object.entries(Data.cache.classes)) {
      const countInParty = gameState.party.filter(m => m.classId === classId).length;
      const card = document.createElement('div');
      card.className = 'guild-hire-card';
      const sprite = Assets.getCharacterSprite(classId);
      card.innerHTML = `
        <div class="ghc-avatar">${sprite ? Assets.spriteImg(sprite, 56) : Party.getClassIcon(classId)}</div>
        <div class="ghc-info">
          <div class="ghc-name">${cls.name}</div>
          <div class="ghc-role">${cls.role.replace(/_/g, ' ')}</div>
          <div class="ghc-desc">${cls.hire_description}</div>
          <div class="ghc-stats">
            <span>STR ${cls.primary_stats.str}</span>
            <span>INT ${cls.primary_stats.int}</span>
            <span>DEX ${cls.primary_stats.dex}</span>
            <span>STA ${cls.primary_stats.sta}</span>
          </div>
        </div>
        <div class="ghc-actions">
          <div class="ghc-cost">${cls.hire_cost}g</div>
          <button class="btn-primary btn-hire" data-class="${classId}" ${gameState.party.length >= 4 || gameState.gold < cls.hire_cost ? 'disabled' : ''}>
            ${countInParty > 0 ? `Hire (${countInParty} in party)` : 'Hire'}
          </button>
        </div>
      `;
      roster.appendChild(card);
    }

    // Hire button handlers
    roster.querySelectorAll('.btn-hire').forEach(btn => {
      btn.addEventListener('click', () => {
        const classId = btn.dataset.class;
        const cls = Data.cache.classes[classId];
        if (gameState.gold < cls.hire_cost || gameState.party.length >= 4) return;
        gameState.gold -= cls.hire_cost;
        const member = Party.createMember(classId);
        // Auto-assign formation position
        const positions = ['front_left', 'front_right', 'back_left', 'back_right'];
        const taken = gameState.party.map(m => m.formation);
        const available = positions.filter(p => !taken.includes(p));
        // Tanks go front, casters go back
        const role = cls.role;
        if (role.includes('tank') && available.includes('front_left')) member.formation = 'front_left';
        else if (role.includes('tank') && available.includes('front_right')) member.formation = 'front_right';
        else if (role.includes('ranged') || role.includes('healer')) member.formation = available.find(p => p.startsWith('back')) || available[0];
        else member.formation = available[0];
        // Don't override ability slots — createMember already auto-slots correctly
        Party.recalcDerived(member);
        gameState.party.push(member);
        UI.toast(`${cls.name} joined the party!`, 'toast-success');
        renderGuild(gameState);
        UI.updateTopBar(gameState);
      });
    });

    // Party list
    partyList.innerHTML = '';
    for (const member of gameState.party) {
      const cls = Data.cache.classes[member.classId];
      const dismissValue = Math.floor((cls.hire_cost || 100) * 0.5);
      const row = document.createElement('div');
      row.className = 'party-member-card';
      row.style.flexWrap = 'wrap';
      const memberSprite = Assets.getCharacterSprite(member.classId);
      row.innerHTML = `
        <div class="pm-avatar">${memberSprite ? Assets.spriteImg(memberSprite, 40) : Party.getClassIcon(member.classId)}</div>
        <div class="pm-info" style="flex:1;">
          <div class="pm-name">${member.name}</div>
          <div class="pm-level">Level ${member.level}</div>
        </div>
        <button class="btn-small btn-danger btn-dismiss" data-member-id="${member.id}" style="font-size:10px;">Dismiss (${dismissValue}g)</button>
      `;
      row.querySelector('.pm-info').addEventListener('click', () => UI.showCharacterDetail(member, gameState));
      partyList.appendChild(row);
    }

    // Dismiss handlers
    partyList.querySelectorAll('.btn-dismiss').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const memberId = btn.dataset.memberId;
        const member = gameState.party.find(m => m.id === memberId);
        if (!member) return;
        const cls = Data.cache.classes[member.classId];
        const dismissValue = Math.floor((cls.hire_cost || 100) * 0.5);
        // Confirmation
        document.getElementById('sell-confirm-text').textContent = `Dismiss ${member.name} (Lv${member.level} ${cls.name})? You'll receive ${dismissValue} gold. Their equipment will be returned to your inventory.`;
        document.getElementById('modal-sell-confirm').style.display = 'flex';
        document.getElementById('btn-sell-yes').onclick = () => {
          document.getElementById('modal-sell-confirm').style.display = 'none';
          // Return equipment to inventory
          for (const [slot, item] of Object.entries(member.equipment)) {
            if (item) gameState.inventory.push(item);
          }
          gameState.gold += dismissValue;
          gameState.party = gameState.party.filter(m => m.id !== memberId);
          UI.toast(`${member.name} dismissed. Equipment returned. +${dismissValue}g`, 'toast-gold');
          renderGuild(gameState);
          UI.updateTopBar(gameState);
        };
        document.getElementById('btn-sell-no').onclick = () => {
          document.getElementById('modal-sell-confirm').style.display = 'none';
        };
      });
    });
  }

  // Render blacksmith
  function renderBlacksmith(gameState, tab) {
    currentShopTab = tab || currentShopTab;
    const container = document.getElementById('blacksmith-items');
    document.getElementById('bs-gold').textContent = gameState.gold;

    // Filter stock by tab
    const filtered = blacksmithStock.filter(item => {
      const slot = item.slot || Items.guessSlot(item);
      if (currentShopTab === 'weapons') return slot === 'weapon' || ['tome', 'offhand_weapon', 'quiver', 'focus'].includes(slot);
      if (currentShopTab === 'armor') return slot === 'armor';
      if (currentShopTab === 'accessories') return slot === 'accessory' || slot === 'shield';
      return true;
    });

    container.innerHTML = '';
    for (const item of filtered) {
      const canAfford = gameState.gold >= item.price;
      const row = document.createElement('div');
      row.className = 'shop-item' + (selectedShopItem?.uid === item.uid ? ' selected' : '');
      const classStr = item.classes ? item.classes.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ') : 'Any';
      row.innerHTML = `
        <div class="si-icon">${getItemIcon(item)}</div>
        <div class="si-info">
          <div class="si-name rarity-${item.rarity}">${item.name}</div>
          <div class="si-stats">${Items.statSummary(item)}</div>
          <div class="si-stats" style="font-size:9px;color:var(--text-dim);">${(item.slot || '').replace(/_/g,' ')} | ${classStr}</div>
        </div>
        <div class="si-price ${canAfford ? '' : 'cant-afford'}">${item.price}g</div>
      `;
      row.addEventListener('click', () => {
        selectedShopItem = item;
        renderBlacksmithDetail(item, gameState);
        renderBlacksmith(gameState);
      });
      container.appendChild(row);
    }

    // Update tabs
    document.querySelectorAll('#screen-blacksmith .shop-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === currentShopTab);
    });
  }

  function renderBlacksmithDetail(item, gameState) {
    const detail = document.getElementById('bs-item-detail');
    if (!item) { detail.innerHTML = '<p class="text-dim">Select an item</p>'; return; }
    const canAfford = gameState.gold >= item.price;
    const itemSlot = item.slot || Items.guessSlot(item);

    // Build comparison for each party member who can equip this
    let comparisonHtml = '';
    for (const member of gameState.party) {
      if (!Party.canEquip(member, item)) continue;
      Party.recalcDerived(member);
      const equipped = member.equipment[itemSlot];
      const compLines = [];

      // Compare primary stats
      for (const stat of ['str', 'int', 'dex', 'sta']) {
        const newVal = item.stats?.[stat] || 0;
        const oldVal = equipped?.stats?.[stat] || 0;
        const diff = newVal - oldVal;
        if (diff !== 0) {
          const cls = diff > 0 ? 'stat-positive' : 'stat-negative';
          compLines.push(`<span class="${cls}">${diff > 0 ? '+' : ''}${diff} ${stat.toUpperCase()}</span>`);
        }
      }

      // Compare resistances
      for (const [res, newVal] of Object.entries(item.resistances || {})) {
        const oldVal = equipped?.resistances?.[res] || 0;
        const diff = newVal - oldVal;
        if (Math.abs(diff) > 0.001) {
          const cls = diff > 0 ? 'stat-positive' : 'stat-negative';
          compLines.push(`<span class="${cls}">${diff > 0 ? '+' : ''}${Math.round(diff * 100)}% ${res.replace('_resist', '')}</span>`);
        }
      }

      const equippedName = equipped ? `<span class="rarity-${equipped.rarity}">${equipped.name}</span>` : '<span style="color:var(--text-dim);">Empty</span>';
      comparisonHtml += `
        <div class="compare-block">
          <div class="compare-member">${member.name}</div>
          <div class="compare-current">Current: ${equippedName}</div>
          ${compLines.length > 0 ? `<div class="compare-diff">${compLines.join(' ')}</div>` : '<div class="compare-diff" style="color:var(--text-dim);">No stat change</div>'}
        </div>
      `;
    }

    detail.innerHTML = `
      <div class="item-detail">
        <div class="id-name rarity-${item.rarity}">${item.name}</div>
        <div class="id-type">${item.rarity} Rank ${item.rank} ${item.type}</div>
        <div class="id-desc">${item.description}</div>
        <div class="id-stats">${renderStatBlock(item)}</div>
        ${item.bonusEffects?.length ? `<div class="id-effects"><div class="section-label">Bonus Effects</div>${item.bonusEffects.map(e => `<div class="id-effect">${e.name}: ${formatEffectValue(e.value)}</div>`).join('')}</div>` : ''}
        ${item.resistances && Object.keys(item.resistances).length ? `<div class="id-stats"><div class="section-label">Resistances</div>${Object.entries(item.resistances).filter(([,v]) => v !== 0).map(([k,v]) => `<div class="${v > 0 ? 'stat-positive' : 'stat-negative'}">${k.replace('_resist','').replace('_',' ')}: ${v > 0 ? '+' : ''}${Math.round(v*100)}%</div>`).join('')}</div>` : ''}
        <div class="id-classes">Classes: ${item.classes?.join(', ') || 'Any'}</div>
        ${comparisonHtml ? `<div class="section-label">Compared to Equipped</div>${comparisonHtml}` : ''}
        <div class="id-price">${item.price} gold</div>
        <div class="id-actions">
          <button class="btn-primary btn-buy" ${canAfford ? '' : 'disabled'}>${canAfford ? 'Buy' : 'Not enough gold'}</button>
        </div>
      </div>
    `;
    detail.querySelector('.btn-buy')?.addEventListener('click', () => {
      if (gameState.gold < item.price) return;
      gameState.gold -= item.price;
      gameState.inventory.push(item);
      blacksmithStock = blacksmithStock.filter(i => i.uid !== item.uid);
      selectedShopItem = null;
      UI.toast(`Bought ${item.name}!`, 'toast-gold');
      renderBlacksmith(gameState);
      renderBlacksmithDetail(null, gameState);
      UI.updateTopBar(gameState);
    });
  }

  // Blacksmith sell panel
  let skipSellConfirm = false;
  let selectedSellItem = null;

  function renderBlacksmithSell(gameState) {
    const container = document.getElementById('bs-sell-items');
    document.getElementById('bs-gold').textContent = gameState.gold;
    container.innerHTML = '';

    const totalSellValue = gameState.inventory.reduce((sum, i) => sum + (i.sellPrice || 0), 0);
    const totalEl = document.getElementById('bs-sell-total');
    if (totalEl) totalEl.textContent = `${gameState.inventory.length} items (${totalSellValue}g total)`;

    if (gameState.inventory.length === 0) {
      container.innerHTML = '<p style="color:var(--text-dim);padding:20px;">Your inventory is empty.</p>';
      renderSellDetail(null, gameState);
      return;
    }

    for (const item of gameState.inventory) {
      const row = document.createElement('div');
      row.className = 'shop-item' + (selectedSellItem?.uid === item.uid ? ' selected' : '');
      const effectsStr = (item.bonusEffects && item.bonusEffects.length > 0)
        ? ' | ' + item.bonusEffects.map(e => e.name).join(', ')
        : '';
      row.innerHTML = `
        <div class="si-icon">${getItemIcon(item)}</div>
        <div class="si-info">
          <div class="si-name rarity-${item.rarity}">${item.name}</div>
          <div class="si-stats">${Items.statSummary(item)}${effectsStr}</div>
          <div class="si-stats" style="font-size:10px;color:var(--text-dim);">${(item.slot || '').replace('_',' ')} | ${item.classes?.join(', ') || 'Any'}</div>
        </div>
        <div class="si-price" style="color:var(--gold);">${item.sellPrice || 0}g</div>
      `;
      row.addEventListener('click', () => {
        selectedSellItem = item;
        renderSellDetail(item, gameState);
        renderBlacksmithSell(gameState);
      });
      container.appendChild(row);
    }
  }

  function renderSellDetail(item, gameState) {
    const detail = document.getElementById('bs-sell-item-detail');
    if (!item) { detail.innerHTML = '<p style="color:var(--text-dim);">Select an item to sell</p>'; return; }
    detail.innerHTML = `
      <div class="item-detail">
        <div class="id-name rarity-${item.rarity}">${item.name}</div>
        <div class="id-type">${item.rarity} Rank ${item.rank} ${item.type}</div>
        <div class="id-desc">${item.description || ''}</div>
        <div class="id-stats">${renderStatBlock(item)}</div>
        ${item.bonusEffects?.length ? `<div class="id-effects"><div class="section-label">Bonus Effects</div>${item.bonusEffects.map(e => `<div class="id-effect">${e.name}: ${formatEffectValue(e.value)}</div>`).join('')}</div>` : ''}
        <div class="id-price">Sell for: ${item.sellPrice || 0} gold</div>
        <div class="id-actions">
          <button class="btn-primary btn-sell-item">Sell (${item.sellPrice || 0}g)</button>
        </div>
      </div>
    `;
    detail.querySelector('.btn-sell-item')?.addEventListener('click', () => {
      sellItem(item, gameState);
    });
  }

  function sellItem(item, gameState) {
    skipSellConfirm = document.getElementById('bs-skip-confirm')?.checked || false;
    if (skipSellConfirm) {
      executeSell(item, gameState);
    } else {
      // Show confirmation
      document.getElementById('sell-confirm-text').textContent =
        `Sell "${item.name}" for ${item.sellPrice || 0} gold?`;
      document.getElementById('modal-sell-confirm').style.display = 'flex';
      document.getElementById('btn-sell-yes').onclick = () => {
        document.getElementById('modal-sell-confirm').style.display = 'none';
        executeSell(item, gameState);
      };
      document.getElementById('btn-sell-no').onclick = () => {
        document.getElementById('modal-sell-confirm').style.display = 'none';
      };
    }
  }

  function executeSell(item, gameState) {
    gameState.gold += item.sellPrice || 0;
    gameState.inventory = gameState.inventory.filter(i => i.uid !== item.uid);
    UI.toast(`Sold ${item.name} for ${item.sellPrice || 0}g`, 'toast-gold');
    selectedSellItem = null;
    renderBlacksmithSell(gameState);
    renderSellDetail(null, gameState);
    UI.updateTopBar(gameState);
    document.getElementById('bs-gold').textContent = gameState.gold;
  }

  // Salvage panel
  let selectedSalvageItem = null;

  function renderSalvagePanel(gameState) {
    const container = document.getElementById('bs-salvage-items');
    document.getElementById('bs-gold').textContent = gameState.gold;
    container.innerHTML = '';

    const totalEl = document.getElementById('bs-salvage-total');
    if (totalEl) totalEl.textContent = `${gameState.inventory.length} items`;

    // Show materials
    const matDiv = document.getElementById('bs-salvage-materials');
    const mats = Crafting.getAllMaterials(gameState);
    matDiv.innerHTML = mats.length === 0
      ? '<div style="font-size:11px;color:var(--text-dim);">No materials yet.</div>'
      : mats.map(m => `<div style="font-size:11px;margin:2px 0;"><span class="rarity-${m.rarity}">${m.icon} ${m.name}</span>: ${m.quantity}</div>`).join('');

    if (gameState.inventory.length === 0) {
      container.innerHTML = '<p style="color:var(--text-dim);padding:20px;">Inventory empty.</p>';
      renderSalvageDetail(null, gameState);
      return;
    }

    for (const item of gameState.inventory) {
      const row = document.createElement('div');
      row.className = 'shop-item' + (selectedSalvageItem?.uid === item.uid ? ' selected' : '');
      const yields = Crafting.salvage(item);
      const yieldStr = yields.map(m => `${m.quantity}x ${m.id.replace(/_/g,' ')}`).join(', ');
      row.innerHTML = `
        <div class="si-icon">${getItemIcon(item)}</div>
        <div class="si-info">
          <div class="si-name rarity-${item.rarity}">${item.name}</div>
          <div class="si-stats" style="font-size:10px;color:var(--warning);">Yields: ${yieldStr}</div>
        </div>
      `;
      row.addEventListener('click', () => {
        selectedSalvageItem = item;
        renderSalvageDetail(item, gameState);
        renderSalvagePanel(gameState);
      });
      container.appendChild(row);
    }
  }

  function renderSalvageDetail(item, gameState) {
    const detail = document.getElementById('bs-salvage-item-detail');
    if (!item) { detail.innerHTML = '<p style="color:var(--text-dim);">Select an item to salvage</p>'; return; }
    const yields = Crafting.salvage(item);
    detail.innerHTML = `
      <div class="item-detail">
        <div class="id-name rarity-${item.rarity}">${item.name}</div>
        <div class="id-type">${item.rarity} Rank ${item.rank} ${item.type}</div>
        <div class="id-stats">${renderStatBlock(item)}</div>
        <div class="section-label">Salvage Yields</div>
        <div class="id-stats" style="font-size:12px;">${yields.map(m => `<div><span class="rarity-${m.rarity}">${m.quantity}x ${m.id.replace(/_/g,' ')}</span> (${m.rarity})</div>`).join('')}</div>
        <div class="id-actions">
          <button class="btn-primary btn-do-salvage" style="background:var(--warning);">Salvage</button>
        </div>
      </div>
    `;
    detail.querySelector('.btn-do-salvage')?.addEventListener('click', () => {
      const skip = document.getElementById('bs-skip-salvage-confirm')?.checked;
      if (skip) {
        executeSalvage(item, gameState);
      } else {
        const yieldStr = yields.map(m => `${m.quantity}x ${m.id.replace(/_/g,' ')}`).join(', ');
        document.getElementById('sell-confirm-text').textContent = `Salvage "${item.name}" into ${yieldStr}?`;
        document.getElementById('modal-sell-confirm').style.display = 'flex';
        document.getElementById('btn-sell-yes').onclick = () => { document.getElementById('modal-sell-confirm').style.display = 'none'; executeSalvage(item, gameState); };
        document.getElementById('btn-sell-no').onclick = () => { document.getElementById('modal-sell-confirm').style.display = 'none'; };
      }
    });
  }

  function executeSalvage(item, gameState) {
    const mats = Crafting.salvage(item);
    Crafting.addMaterials(gameState, mats);
    gameState.inventory = gameState.inventory.filter(i => i.uid !== item.uid);
    const matStr = mats.map(m => `${m.quantity}x ${m.id.replace(/_/g,' ')}`).join(', ');
    UI.toast(`Salvaged: ${matStr}`, 'toast-success');
    selectedSalvageItem = null;
    renderSalvagePanel(gameState);
    renderSalvageDetail(null, gameState);
  }

  // Render alchemist
  function renderAlchemist(gameState, tab) {
    currentAlchTab = tab || currentAlchTab;
    const container = document.getElementById('alchemist-items');
    document.getElementById('alch-gold').textContent = gameState.gold;

    const filtered = alchemistStock.filter(item => {
      if (currentAlchTab === 'potions') return item.subtype === 'potion' || item.subtype === 'special';
      if (currentAlchTab === 'buffs') return item.subtype === 'buff_potion';
      if (currentAlchTab === 'scrolls') return item.subtype === 'scroll';
      if (currentAlchTab === 'crafting') return item.subtype === 'reagent_pack';
      return true;
    });

    container.innerHTML = '';
    for (const item of filtered) {
      const canAfford = gameState.gold >= item.price;
      const row = document.createElement('div');
      row.className = 'shop-item';
      row.innerHTML = `
        <div class="si-icon">${getConsumableIcon(item)}</div>
        <div class="si-info">
          <div class="si-name rarity-${item.rarity}">${item.name}</div>
          <div class="si-stats">${item.description}</div>
        </div>
        <div class="si-price ${canAfford ? '' : 'cant-afford'}">${item.price}g</div>
      `;
      row.addEventListener('click', () => {
        if (gameState.gold < item.price) return;
        gameState.gold -= item.price;
        if (item.subtype === 'reagent_pack') {
          // Open reagent pack — give 3-10 random materials of this rarity
          const count = 3 + Math.floor(Math.random() * 8);
          const matTypes = ['metal_scrap', 'leather_scrap', 'cloth_scrap', 'wood_scrap', 'gem_dust', 'essence'];
          const mats = [];
          for (let i = 0; i < count; i++) {
            mats.push({ id: matTypes[Math.floor(Math.random() * matTypes.length)], rarity: item.rarity, quantity: 1 });
          }
          Crafting.addMaterials(gameState, mats);
          UI.toast(`Opened ${item.name}: ${count} reagents!`, 'toast-success');
        } else {
          gameState.consumables.push({ ...item, uid: item.uid + '_' + Date.now() });
          UI.toast(`Bought ${item.name}!`, 'toast-gold');
        }
        renderAlchemist(gameState);
        UI.updateTopBar(gameState);
      });
      container.appendChild(row);
    }

    document.querySelectorAll('#screen-alchemist .shop-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === currentAlchTab);
    });
  }

  function renderStatBlock(item) {
    const lines = [];
    for (const [stat, val] of Object.entries(item.stats || {})) {
      if (val === 0) continue;
      const cls = val > 0 ? 'stat-positive' : 'stat-negative';
      lines.push(`<div class="${cls}">${val > 0 ? '+' : ''}${val} ${stat.toUpperCase()}</div>`);
    }
    return lines.join('');
  }

  function formatEffectValue(val) {
    return typeof val === 'number' && val < 1 && val > 0 ? `${Math.round(val * 100)}%` : val;
  }

  function getItemIcon(item) {
    const icons = { sword: '&#9876;', axe: '&#9935;', mace: '&#9876;', hammer: '&#9876;', dagger: '&#128481;', bow: '&#127993;', crossbow: '&#127993;', staff: '&#10038;', wand: '&#10038;', scepter: '&#10038;', heavy: '&#128737;', medium: '&#128737;', light: '&#128737;', cloth: '&#128737;', shield: '&#128737;', ring: '&#128141;', amulet: '&#128141;', trinket: '&#128142;', tome: '&#128214;', offhand_weapon: '&#128481;', quiver: '&#127993;', focus: '&#10024;' };
    return icons[item.type] || '&#9734;';
  }

  function getConsumableIcon(item) {
    if (item.subtype === 'potion') return '&#127862;';
    if (item.subtype === 'buff_potion') return '&#127863;';
    if (item.subtype === 'scroll') return '&#128220;';
    return '&#128188;';
  }

  // Render party camp — equip/manage party
  let selectedPartyMember = null;

  function renderPartyCamp(gameState) {
    const membersList = document.getElementById('party-members-list');
    const invList = document.getElementById('inventory-list');
    const invCount = document.getElementById('inv-count');

    invCount.textContent = gameState.inventory.length;
    membersList.innerHTML = '';
    membersList.className = 'camp-grid';

    if (gameState.party.length === 0) {
      membersList.innerHTML = '<p style="color:var(--text-dim);padding:20px;">No party members. Visit the Guild to hire adventurers.</p>';
    }

    for (const member of gameState.party) {
      Party.recalcDerived(member);
      const cls = Data.cache.classes[member.classId];
      const card = document.createElement('div');
      card.className = 'camp-card' + (selectedPartyMember?.id === member.id ? ' selected' : '');

      const campSprite = Assets.getCharacterSprite(member.classId);
      const hasLevelUp = Party.needsLevelUp(member);
      const xpPct = member.xpToNext > 0 ? Math.round(member.xp / member.xpToNext * 100) : 0;
      const d = member.derived;
      const b = member.baseDerived;
      const memberId = member.id.replace(/[^a-zA-Z0-9]/g, '_');

      // Equipment with item bonuses shown
      const slotsHtml = cls.equipment_slots.map(slot => {
        const eq = member.equipment[slot];
        let bonusHtml = '';
        if (eq) {
          const parts = [];
          for (const [s, v] of Object.entries(eq.stats || {})) { if (v !== 0) parts.push(`<span class="${v > 0 ? 'stat-positive' : 'stat-negative'}">${v > 0 ? '+' : ''}${v} ${s.toUpperCase()}</span>`); }
          for (const eff of (eq.bonusEffects || [])) { parts.push(`<span style="color:var(--accent-light);">${eff.name}: ${formatEffectValue(eff.value)}</span>`); }
          for (const [r, v] of Object.entries(eq.resistances || {})) { if (v !== 0) parts.push(`<span style="color:var(--success);">${r.replace('_resist','').replace('_',' ')} +${Math.round(v*100)}%</span>`); }
          if (parts.length) bonusHtml = `<div class="es-bonuses">${parts.join(' ')}</div>`;
        }
        return `<div class="equip-slot" data-member="${member.id}" data-slot="${slot}">
          <span class="es-label">${slot.replace(/_/g, ' ')}</span>
          ${eq ? `<span class="es-name rarity-${eq.rarity}">${eq.name}</span>` : `<span class="es-empty">Empty</span>`}
          ${eq ? `<button class="btn-small btn-unequip" data-member="${member.id}" data-slot="${slot}" style="margin-left:auto;font-size:10px;">X</button>` : ''}
          ${bonusHtml}
        </div>`;
      }).join('');

      // Stat detail helper
      const fs = (label, total, base, pct) => {
        const diff = total - base;
        const diffStr = diff > 0 ? `<span class="stat-gear-bonus">+${pct ? Math.round(diff*100)+'%' : diff}</span>` : '';
        const val = pct ? Math.round(total * 100) + '%' : total;
        const baseVal = pct ? Math.round(base * 100) + '%' : base;
        return `<div class="stat-detail-row"><span class="sdr-name">${label}</span><span class="sdr-val">${val}</span><span class="sdr-base">(${baseVal})</span>${diffStr}</div>`;
      };
      const resistEntries = Object.entries(member.resistances || {}).filter(([,v]) => v !== 0);
      const baseResists = member.baseResistances || {};

      card.innerHTML = `
        <div class="camp-card-header">
          <div class="ghc-avatar" style="width:40px;height:40px;">${campSprite ? Assets.spriteImg(campSprite, 40) : Party.getClassIcon(member.classId)}</div>
          <div style="flex:1;min-width:0;">
            <div class="ghc-name" style="font-size:13px;">
              <span class="char-name-display" data-member-id="${member.id}">${member.name}</span>
              <button class="btn-small btn-rename" data-member-id="${member.id}" style="font-size:8px;padding:1px 4px;" title="Rename">&#9998;</button>
              <span style="font-size:10px;color:var(--accent-light);">Lv${member.level}</span>
              ${hasLevelUp ? `<button class="btn-small btn-levelup-indicator btn-levelup" data-member-id="${member.id}" style="font-size:9px;padding:2px 6px;">Level Up!</button>` : ''}
            </div>
            <div style="display:flex;gap:6px;font-size:10px;color:var(--text-dim);flex-wrap:wrap;">
              <span>HP ${d.hp}</span><span>ATK ${d.phys_atk}/${d.mag_atk}</span><span>DEF ${d.phys_def}</span><span>SPD ${d.spd}</span>
            </div>
            <div class="bar-container" style="height:4px;margin-top:2px;">
              <div class="bar-fill xp" style="width:${xpPct}%"></div>
            </div>
          </div>
        </div>
        <button class="btn-small btn-toggle-stats" data-target="stats-${memberId}" style="width:100%;margin:4px 0;">Stats &#9660;</button>
        <div id="stats-${memberId}" class="stat-detail-panel" style="display:none;">
          <div class="stat-detail-section">
            <div class="section-label">Primary (base)</div>
            <div class="stat-detail-grid">
              ${['str','int','dex','sta','wis'].map(s => `<div class="stat-detail-row"><span class="sdr-name">${s.toUpperCase()}</span><span class="sdr-val">${member.totalPrimary[s]}</span><span class="sdr-base">(${member.primaryStats[s]})</span>${member.totalPrimary[s] - member.primaryStats[s] > 0 ? `<span class="stat-gear-bonus">+${member.totalPrimary[s] - member.primaryStats[s]}</span>` : ''}</div>`).join('')}
            </div>
          </div>
          <div class="stat-detail-section">
            <div class="section-label">Combat (base)</div>
            <div class="stat-detail-grid">
              ${fs('HP', d.hp, b.hp)}${fs('MP', d.mp, b.mp)}
              ${fs('P.ATK', d.phys_atk, b.phys_atk)}${fs('M.ATK', d.mag_atk, b.mag_atk)}
              ${fs('P.DEF', d.phys_def, b.phys_def)}${fs('M.DEF', d.mag_def, b.mag_def)}
              ${fs('SPD', d.spd, b.spd)}${fs('Crit', d.crit_rate, b.crit_rate, true)}
              ${fs('Dodge', d.dodge, b.dodge, true)}${fs('Heal', d.heal_power, b.heal_power)}
            </div>
          </div>
          ${resistEntries.length > 0 ? `<div class="stat-detail-section"><div class="section-label">Resistances</div><div class="stat-detail-grid">${resistEntries.map(([k, v]) => { const bv = baseResists[k]||0; const diff = v-bv; return `<div class="stat-detail-row"><span class="sdr-name">${k.replace('_resist','').replace('_',' ')}</span><span class="sdr-val">${Math.round(v*100)}%</span>${diff>0?`<span class="stat-gear-bonus">+${Math.round(diff*100)}%</span>`:''}</div>`; }).join('')}</div></div>` : ''}
        </div>
        <div class="equip-grid" style="margin-top:4px;">${slotsHtml}</div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-unequip') || e.target.closest('.equip-slot') || e.target.closest('.btn-levelup') || e.target.closest('.btn-toggle-stats') || e.target.closest('.stat-detail-panel')) return;
        selectedPartyMember = member;
        renderPartyCamp(gameState);
      });

      membersList.appendChild(card);

      // Toggle stats
      card.querySelector('.btn-toggle-stats')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const panel = document.getElementById(e.currentTarget.dataset.target);
        if (!panel) return;
        const isOpen = panel.style.display !== 'none';
        panel.style.display = isOpen ? 'none' : 'block';
        e.currentTarget.innerHTML = isOpen ? 'Stats &#9660;' : 'Stats &#9650;';
      });
    }

    // Unequip handlers
    membersList.querySelectorAll('.btn-unequip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const member = gameState.party.find(m => m.id === btn.dataset.member);
        if (!member) return;
        const old = Party.unequip(member, btn.dataset.slot);
        if (old) { gameState.inventory.push(old); UI.toast(`Unequipped ${old.name}`, 'toast-success'); }
        renderPartyCamp(gameState);
      });
    });

    // Level-up handlers
    membersList.querySelectorAll('.btn-levelup').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const member = gameState.party.find(m => m.id === btn.dataset.memberId);
        if (member) UI.showLevelUp(member, gameState, () => renderPartyCamp(gameState));
      });
    });

    // Rename handlers
    membersList.querySelectorAll('.btn-rename').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const memberId = btn.dataset.memberId;
        const member = gameState.party.find(m => m.id === memberId);
        if (!member) return;
        const nameSpan = btn.parentElement.querySelector('.char-name-display');
        const input = document.createElement('input');
        input.className = 'rename-input';
        input.value = member.name;
        input.maxLength = 20;
        nameSpan.replaceWith(input);
        input.focus();
        input.select();
        const finish = () => {
          const newName = input.value.trim() || member.name;
          member.name = newName;
          renderPartyCamp(gameState);
        };
        input.addEventListener('blur', finish);
        input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') finish(); });
      });
    });

    // Render inventory sidebar with click-to-assign
    invList.innerHTML = '';
    const items = gameState.inventory;

    if (items.length === 0) {
      invList.innerHTML = '<p style="color:var(--text-dim);font-size:12px;">Inventory empty</p>';
    }

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'shop-item';
      row.draggable = true;
      row.dataset.itemUid = item.uid;

      const classRestriction = item.classes ? item.classes.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ') : 'Any';
      const slotLabel = (item.slot || 'unknown').replace(/_/g, ' ');
      const effectsStr = (item.bonusEffects && item.bonusEffects.length > 0)
        ? item.bonusEffects.map(e => `<span style="color:var(--accent-light);">${e.name}: ${formatEffectValue(e.value)}</span>`).join(' ')
        : '';
      const resistStr = item.resistances ? Object.entries(item.resistances).filter(([,v]) => v !== 0)
        .map(([k,v]) => `<span style="color:var(--success);">${k.replace('_resist','').replace('_',' ')} +${Math.round(v*100)}%</span>`).join(' ') : '';

      row.innerHTML = `
        <div class="si-icon">${getItemIcon(item)}</div>
        <div class="si-info">
          <div class="si-name rarity-${item.rarity}">${item.name}</div>
          <div class="si-stats">${Items.statSummary(item)}</div>
          ${effectsStr ? `<div class="si-stats" style="font-size:10px;">${effectsStr}</div>` : ''}
          ${resistStr ? `<div class="si-stats" style="font-size:10px;">${resistStr}</div>` : ''}
          <div class="si-stats" style="font-size:10px;color:var(--text-dim);">${slotLabel} | ${classRestriction}</div>
        </div>
      `;

      // Drag support
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(item.uid)); row.style.opacity = '0.5'; });
      row.addEventListener('dragend', () => { row.style.opacity = '1'; });

      // Click to show assign popup
      row.addEventListener('click', () => showAssignPopup(item, gameState));

      invList.appendChild(row);
    }

    setupDropTargets(gameState);
  }

  // Click-to-assign popup: shows which party members can equip this item
  function showAssignPopup(item, gameState) {
    const eligible = gameState.party.filter(m => Party.canEquip(m, item));
    if (eligible.length === 0) {
      UI.toast('No party member can equip this item', 'toast-error');
      return;
    }
    if (eligible.length === 1) {
      equipItemToMember(gameState, eligible[0], item);
      return;
    }
    // Show modal with choices
    const content = document.getElementById('item-detail-content');
    const itemSlot = item.slot || Items.guessSlot(item);
    content.innerHTML = `
      <div class="item-detail">
        <div class="id-name rarity-${item.rarity}">${item.name}</div>
        <div class="id-stats">${Items.statSummary(item)}</div>
        <div class="section-label" style="margin-top:8px;">Give to:</div>
        <div class="assign-list">
          ${eligible.map(m => {
            const equipped = m.equipment[itemSlot];
            const sprite = Assets.getCharacterSprite(m.classId);
            return `<button class="assign-btn" data-member-id="${m.id}">
              <span>${sprite ? Assets.spriteImg(sprite, 24) : ''} ${m.name} Lv${m.level}</span>
              <span style="font-size:10px;color:var(--text-dim);">Current: ${equipped ? equipped.name : 'Empty'}</span>
            </button>`;
          }).join('')}
        </div>
      </div>
    `;
    document.getElementById('modal-item').style.display = 'flex';
    content.querySelectorAll('.assign-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const member = gameState.party.find(m => m.id === btn.dataset.memberId);
        if (member) {
          document.getElementById('modal-item').style.display = 'none';
          equipItemToMember(gameState, member, item);
        }
      });
    });
  }

  function equipItemToMember(gameState, member, item) {
    const old = Party.equip(member, item);
    gameState.inventory = gameState.inventory.filter(i => i.uid !== item.uid);
    if (old) gameState.inventory.push(old);
    UI.toast(`${member.name} equipped ${item.name}!`, 'toast-success');
    renderPartyCamp(gameState);
    UI.updateTopBar(gameState);
  }

  function setupDropTargets(gameState) {
    document.querySelectorAll('#party-members-list .equip-slot').forEach(slot => {
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        slot.style.borderColor = 'var(--accent)';
        slot.style.background = 'var(--bg-card-hover)';
      });
      slot.addEventListener('dragleave', () => {
        slot.style.borderColor = '';
        slot.style.background = '';
      });
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.style.borderColor = '';
        slot.style.background = '';
        const uid = parseInt(e.dataTransfer.getData('text/plain'));
        const item = gameState.inventory.find(i => i.uid === uid);
        if (!item) return;
        const memberId = slot.dataset.member;
        const member = gameState.party.find(m => m.id === memberId);
        if (!member) return;
        const targetSlot = slot.dataset.slot;
        const itemSlot = item.slot || Items.guessSlot(item);
        if (itemSlot !== targetSlot) {
          UI.toast(`${item.name} doesn't fit in the ${targetSlot} slot`, 'toast-error');
          return;
        }
        if (!Party.canEquip(member, item)) {
          UI.toast(`${member.name} can't equip ${item.name}`, 'toast-error');
          return;
        }
        equipItemToMember(gameState, member, item);
      });
    });
  }

  // Forge panel — upgrade items
  let selectedForgeItem = null;

  function renderForge(gameState) {
    const container = document.getElementById('bs-forge-items');
    const matDiv = document.getElementById('bs-forge-materials');
    document.getElementById('bs-gold').textContent = gameState.gold;
    container.innerHTML = '';

    // Show all equipped items + inventory items
    const allItems = [];
    for (const member of gameState.party) {
      for (const [slot, item] of Object.entries(member.equipment)) {
        if (item) allItems.push({ item, owner: member.name, equipped: true });
      }
    }
    for (const item of gameState.inventory) {
      allItems.push({ item, owner: 'Inventory', equipped: false });
    }

    if (allItems.length === 0) {
      container.innerHTML = '<p style="color:var(--text-dim);padding:20px;">No items to upgrade.</p>';
    }

    for (const entry of allItems) {
      const item = entry.item;
      const row = document.createElement('div');
      row.className = 'shop-item' + (selectedForgeItem?.uid === item.uid ? ' selected' : '');
      row.innerHTML = `
        <div class="si-icon">${getItemIcon(item)}</div>
        <div class="si-info">
          <div class="si-name rarity-${item.rarity}">${item.name}</div>
          <div class="si-stats">${Items.statSummary(item)}</div>
          <div class="si-stats" style="font-size:10px;color:var(--text-dim);">Rank ${item.rank}/5 | ${entry.owner}</div>
        </div>
      `;
      row.addEventListener('click', () => {
        selectedForgeItem = item;
        renderForgeDetail(item, gameState);
        renderForge(gameState);
      });
      container.appendChild(row);
    }

    // Show materials
    const mats = Crafting.getAllMaterials(gameState);
    matDiv.innerHTML = mats.length === 0
      ? '<div style="font-size:11px;color:var(--text-dim);">No materials. Salvage items to get materials.</div>'
      : mats.map(m => `<div style="font-size:11px;margin:2px 0;"><span class="rarity-${m.rarity}">${m.icon} ${m.name}</span>: ${m.quantity}</div>`).join('');
  }

  function renderForgeDetail(item, gameState) {
    const detail = document.getElementById('bs-forge-item-detail');
    if (!item) { detail.innerHTML = '<p style="color:var(--text-dim);">Select an item to upgrade</p>'; return; }

    const rankCheck = Crafting.canUpgradeRank(gameState, item);
    const rarityCheck = Crafting.canUpgradeRarity(gameState, item);

    detail.innerHTML = `
      <div class="item-detail">
        <div class="id-name rarity-${item.rarity}">${item.name}</div>
        <div class="id-type">${item.rarity} Rank ${item.rank}/5</div>
        <div class="id-stats">${renderStatBlock(item)}</div>

        ${item.rank < 5 ? `
        <div class="section-label" style="margin-top:8px;">Upgrade Rank (${item.rank} → ${item.rank + 1})</div>
        <div style="font-size:11px;margin-bottom:4px;">
          <div>Gold: ${rankCheck.gold} ${rankCheck.hasGold ? '&#10003;' : '<span style="color:var(--danger);">&#10007;</span>'}</div>
          <div>${rankCheck.matId?.replace(/_/g,' ')}: ${rankCheck.materials} needed (have ${rankCheck.matCount || 0}) ${rankCheck.hasMats ? '&#10003;' : '<span style="color:var(--danger);">&#10007;</span>'}</div>
        </div>
        <button class="btn-primary btn-upgrade-rank" ${rankCheck.can ? '' : 'disabled'}>Upgrade Rank</button>
        ` : ''}

        ${item.rank >= 5 ? `
        <div class="section-label" style="margin-top:8px;">Upgrade Rarity (${item.rarity} → ${rarityCheck.nextRarity || '?'})</div>
        ${rarityCheck.reason && !rarityCheck.can && rarityCheck.reason !== 'Must be rank 5 first' ? `<div style="font-size:11px;color:var(--danger);">${rarityCheck.reason}</div>` : `
        <div style="font-size:11px;margin-bottom:4px;">
          <div>Gold: ${rarityCheck.gold} ${rarityCheck.hasGold ? '&#10003;' : '<span style="color:var(--danger);">&#10007;</span>'}</div>
          <div>${rarityCheck.matId?.replace(/_/g,' ')} (${rarityCheck.matRarity}): ${rarityCheck.materials} needed (have ${rarityCheck.matCount || 0}) ${rarityCheck.hasMats ? '&#10003;' : '<span style="color:var(--danger);">&#10007;</span>'}</div>
          <div style="color:var(--warning);font-size:10px;">Resets rank to 1, re-rolls bonus effects</div>
        </div>
        <button class="btn-primary btn-upgrade-rarity" style="background:var(--gold);color:var(--bg-dark);" ${rarityCheck.can ? '' : 'disabled'}>Upgrade Rarity</button>
        `}
        ` : ''}
      </div>
    `;

    detail.querySelector('.btn-upgrade-rank')?.addEventListener('click', () => {
      if (Crafting.upgradeRank(gameState, item)) {
        UI.toast(`${item.name} upgraded to Rank ${item.rank}!`, 'toast-success');
        // Recalc if equipped
        for (const m of gameState.party) Party.recalcDerived(m);
        renderForgeDetail(item, gameState);
        renderForge(gameState);
        UI.updateTopBar(gameState);
      }
    });

    detail.querySelector('.btn-upgrade-rarity')?.addEventListener('click', () => {
      const oldName = item.name;
      if (Crafting.upgradeRarity(gameState, item)) {
        UI.toast(`${oldName} evolved to ${item.rarity} ${item.name}!`, 'toast-levelup');
        for (const m of gameState.party) Party.recalcDerived(m);
        renderForgeDetail(item, gameState);
        renderForge(gameState);
        UI.updateTopBar(gameState);
      }
    });
  }

  // Formation grid rendering
  function renderFormation(gameState) {
    const grid = document.getElementById('formation-grid');
    const positions = [
      { id: 'front_left', label: 'Front Left' },
      { id: 'front_right', label: 'Front Right' },
      { id: 'back_left', label: 'Back Left' },
      { id: 'back_right', label: 'Back Right' },
    ];

    grid.innerHTML = `
      <div class="formation-row-label">&#128737; Front Row (Tank Line)</div>
      <div class="formation-row">
        ${positions.filter(p => p.id.startsWith('front')).map(pos => renderFormationSlot(pos, gameState)).join('')}
      </div>
      <div class="formation-row-label">&#127993; Back Row (Damage/Support)</div>
      <div class="formation-row">
        ${positions.filter(p => p.id.startsWith('back')).map(pos => renderFormationSlot(pos, gameState)).join('')}
      </div>
    `;

    // Drag and drop
    grid.querySelectorAll('.formation-slot').forEach(slot => {
      slot.addEventListener('dragover', (e) => { e.preventDefault(); slot.classList.add('drag-over'); });
      slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drag-over');
        const memberId = e.dataTransfer.getData('text/plain');
        const targetPos = slot.dataset.position;
        const member = gameState.party.find(m => m.id === memberId);
        if (!member) return;
        // Swap with whoever is at target
        const occupant = gameState.party.find(m => m.formation === targetPos);
        if (occupant && occupant.id !== member.id) {
          occupant.formation = member.formation;
        }
        member.formation = targetPos;
        renderFormation(gameState);
      });
    });

    grid.querySelectorAll('[draggable="true"]').forEach(el => {
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', el.dataset.memberId);
        el.classList.add('formation-dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('formation-dragging'));
    });
  }

  function renderFormationSlot(pos, gameState) {
    const member = gameState.party.find(m => m.formation === pos.id);
    if (member) {
      const sprite = Assets.getCharacterSprite(member.classId);
      const cls = Data.cache.classes[member.classId];
      return `<div class="formation-slot occupied" data-position="${pos.id}">
        <div class="fs-avatar" draggable="true" data-member-id="${member.id}">${sprite ? Assets.spriteImg(sprite, 48) : Party.getClassIcon(member.classId)}</div>
        <div class="fs-name">${member.name}</div>
        <div class="fs-role">${cls.role.replace(/_/g, ' ')}</div>
      </div>`;
    }
    return `<div class="formation-slot" data-position="${pos.id}"><div class="fs-empty">${pos.label}</div></div>`;
  }

  // Ability manager rendering
  function renderAbilityManager(gameState) {
    const container = document.getElementById('ability-manager');
    container.innerHTML = '';

    for (const member of gameState.party) {
      Party.recalcDerived(member);
      const sprite = Assets.getCharacterSprite(member.classId);
      const allAbilities = member.abilities.map(aid => Party.getAbility(member, aid)).filter(Boolean);
      const activeSlots = member.abilitySlots || [];
      const passiveSlots = member.passiveSlots || [];
      const upgrades = member.abilityUpgrades || {};

      // Abilities not in any slot
      const slottedIds = [...activeSlots, ...passiveSlots];
      const unslotted = allAbilities.filter(a => !slottedIds.includes(a.id));

      const section = document.createElement('div');
      section.className = 'ability-member-section';
      section.innerHTML = `
        <div class="ability-member-header">
          ${sprite ? Assets.spriteImg(sprite, 32) : ''}<span style="font-weight:600;color:var(--text-bright);">${member.name}</span>
          <span style="font-size:10px;color:var(--text-dim);">Lv${member.level}</span>
        </div>
        <div class="section-label">Active Slots (${activeSlots.length}/${member.maxActiveSlots || 4}) — Execute in order</div>
        <div class="ability-slot-list" data-member="${member.id}" data-slot-type="active">
          ${activeSlots.map((aid, i) => {
            const ab = Party.getAbility(member, aid);
            if (!ab) return '';
            const ul = upgrades[aid] || 0;
            return `<div class="ability-slot-item" draggable="true" data-ability-id="${aid}" data-idx="${i}">
              <span class="asi-num">#${i + 1}</span>
              <span class="asi-name">${ab.name}${ul > 0 ? ` +${ul}` : ''}</span>
              <span class="asi-type">${ab.type}</span>
              <span style="font-size:9px;color:var(--mp-bar);">${ab.mp_cost ? ab.mp_cost + 'MP' : ''}</span>
              <span class="asi-remove" data-member="${member.id}" data-ability="${aid}" data-from="active">&times;</span>
            </div>`;
          }).join('')}
        </div>
        <div class="section-label" style="margin-top:6px;">Passive Slots (${passiveSlots.length}/${member.maxPassiveSlots || 2})</div>
        <div class="ability-slot-list" data-member="${member.id}" data-slot-type="passive">
          ${passiveSlots.map((aid, i) => {
            const ab = Party.getAbility(member, aid);
            if (!ab) return '';
            return `<div class="ability-slot-item" data-ability-id="${aid}">
              <span class="asi-name">${ab.name}</span>
              <span class="asi-type">passive</span>
              <span class="asi-remove" data-member="${member.id}" data-ability="${aid}" data-from="passive">&times;</span>
            </div>`;
          }).join('')}
        </div>
        ${unslotted.length > 0 ? `
        <div class="section-label" style="margin-top:6px;">Available (click to add)</div>
        <div class="ability-available">
          ${unslotted.map(ab => {
            const isPassive = ab.type === 'passive';
            return `<button class="ability-add-btn ${isPassive ? 'passive' : ''}" data-member="${member.id}" data-ability="${ab.id}" data-is-passive="${isPassive}">${ab.name} <span style="font-size:8px;color:var(--text-dim);">(${ab.type})</span></button>`;
          }).join('')}
        </div>
        ` : ''}
      `;
      container.appendChild(section);
    }

    // Add button handlers
    container.querySelectorAll('.ability-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const member = gameState.party.find(m => m.id === btn.dataset.member);
        if (!member) return;
        const abilityId = btn.dataset.ability;
        const isPassive = btn.dataset.isPassive === 'true';
        if (isPassive) {
          if (!member.passiveSlots) member.passiveSlots = [];
          if (member.passiveSlots.length < (member.maxPassiveSlots || 2)) {
            member.passiveSlots.push(abilityId);
          } else { UI.toast('Passive slots full!', 'toast-error'); return; }
        } else {
          if (!member.abilitySlots) member.abilitySlots = [];
          if (member.abilitySlots.length < (member.maxActiveSlots || 4)) {
            member.abilitySlots.push(abilityId);
          } else { UI.toast('Active slots full!', 'toast-error'); return; }
        }
        renderAbilityManager(gameState);
      });
    });

    // Remove button handlers
    container.querySelectorAll('.asi-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const member = gameState.party.find(m => m.id === btn.dataset.member);
        if (!member) return;
        const aid = btn.dataset.ability;
        const from = btn.dataset.from;
        if (from === 'active') member.abilitySlots = (member.abilitySlots || []).filter(a => a !== aid);
        else member.passiveSlots = (member.passiveSlots || []).filter(a => a !== aid);
        renderAbilityManager(gameState);
      });
    });

    // Drag reorder for active slots
    container.querySelectorAll('.ability-slot-list[data-slot-type="active"]').forEach(list => {
      let dragIdx = null;
      list.querySelectorAll('[draggable="true"]').forEach(item => {
        item.addEventListener('dragstart', (e) => { dragIdx = parseInt(item.dataset.idx); e.dataTransfer.effectAllowed = 'move'; });
        item.addEventListener('dragover', (e) => { e.preventDefault(); });
        item.addEventListener('drop', (e) => {
          e.preventDefault();
          const targetIdx = parseInt(item.dataset.idx);
          if (dragIdx === null || dragIdx === targetIdx) return;
          const memberId = list.dataset.member;
          const member = gameState.party.find(m => m.id === memberId);
          if (!member || !member.abilitySlots) return;
          const arr = member.abilitySlots;
          const [moved] = arr.splice(dragIdx, 1);
          arr.splice(targetIdx, 0, moved);
          renderAbilityManager(gameState);
        });
      });
    });

    // Ability detail click handlers
    container.querySelectorAll('.ability-slot-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.asi-remove')) return; // don't trigger on X button
        const abilityId = item.dataset.abilityId;
        // Find which member this belongs to
        const memberEl = item.closest('.ability-member-section');
        const memberId = memberEl?.querySelector('[data-member]')?.dataset.member ||
                         item.closest('[data-member]')?.dataset.member;
        const member = gameState.party.find(m => m.id === memberId);
        if (!member) return;
        const ab = Party.getAbility(member, abilityId);
        if (ab) showAbilityDetail(ab, member);
      });
    });

    container.querySelectorAll('.ability-add-btn').forEach(btn => {
      const origClick = btn.onclick;
      btn.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const memberId = btn.dataset.member;
        const abilityId = btn.dataset.ability;
        const member = gameState.party.find(m => m.id === memberId);
        if (!member) return;
        const ab = Party.getAbility(member, abilityId) || member.abilityData?.[abilityId];
        if (ab) showAbilityDetail(ab, member);
      });
    });
  }

  function showAbilityDetail(ab, member) {
    const upgrades = member?.abilityUpgrades || {};
    const ul = upgrades[ab.id] || 0;
    const content = document.getElementById('item-detail-content');

    // Build stat lines
    const lines = [];
    if (ab.damage_multiplier) lines.push(`<div><span style="color:var(--text-dim);">Damage:</span> <span style="color:var(--danger);">${ab.damage_multiplier}x${ul > 0 ? ` (base) → ${(ab.damage_multiplier * Math.pow(1.2, ul)).toFixed(2)}x (upgraded)` : ''}</span></div>`);
    if (ab.damage_type) lines.push(`<div><span style="color:var(--text-dim);">Type:</span> ${ab.damage_type}</div>`);
    if (ab.damage_stat) lines.push(`<div><span style="color:var(--text-dim);">Scales with:</span> ${ab.damage_stat.replace('_', ' ')}</div>`);
    if (ab.target) lines.push(`<div><span style="color:var(--text-dim);">Target:</span> ${ab.target.replace(/_/g, ' ')}</div>`);
    if (ab.mp_cost) lines.push(`<div><span style="color:var(--mp-bar);">MP Cost:</span> ${ab.mp_cost}${ul > 0 ? ` → ${Math.floor(ab.mp_cost * Math.pow(0.85, ul))} (upgraded)` : ''}</div>`);
    if (ab.mp_reserve) lines.push(`<div><span style="color:var(--warning);">MP Reserved:</span> ${ab.mp_reserve}</div>`);
    if (ab.cooldown) lines.push(`<div><span style="color:var(--text-dim);">Cooldown:</span> ${ab.cooldown} turns${ul > 0 ? ` → ${Math.max(0, ab.cooldown - ul)} (upgraded)` : ''}</div>`);
    if (ab.hits) lines.push(`<div><span style="color:var(--text-dim);">Hits:</span> ${ab.hits}</div>`);
    if (ab.crit_bonus) lines.push(`<div><span style="color:var(--text-dim);">Crit Bonus:</span> +${Math.round(ab.crit_bonus * 100)}%</div>`);
    if (ab.heal_multiplier) lines.push(`<div><span style="color:var(--success);">Heal Power:</span> ${ab.heal_base || 0} + ${ab.heal_multiplier}x heal power</div>`);

    // Effects
    const effectLines = [];
    if (ab.effect) {
      const e = ab.effect;
      if (e.lifesteal) effectLines.push(`Lifesteal: ${Math.round(e.lifesteal * 100)}%`);
      if (e.poison_dot) effectLines.push(`Poison: ${Math.round((e.dot_percent || 0.03) * 100)}% HP/turn for ${e.dot_duration || 3} turns`);
      if (e.burn_dot) effectLines.push(`Burn: ${Math.round((e.dot_percent || 0.03) * 100)}% HP/turn for ${e.dot_duration || 3} turns`);
      if (e.stun_duration) effectLines.push(`Stun: ${e.stun_duration} turn(s)`);
      if (e.reduce_spd) effectLines.push(`Slow: -${Math.round(e.reduce_spd * 100)}% SPD for ${e.duration || 2} turns`);
      if (e.reduce_phys_atk) effectLines.push(`Weaken: -${Math.round(e.reduce_phys_atk * 100)}% Phys ATK`);
      if (e.reduce_mag_atk) effectLines.push(`Weaken: -${Math.round(e.reduce_mag_atk * 100)}% Mag ATK`);
      if (e.reduce_phys_def) effectLines.push(`Shred: -${Math.round(e.reduce_phys_def * 100)}% Phys DEF`);
      if (e.reduce_heal_received) effectLines.push(`Anti-heal: -${Math.round(e.reduce_heal_received * 100)}% healing received`);
      if (e.damage_taken_increase) effectLines.push(`Vulnerability: +${Math.round(e.damage_taken_increase * 100)}% damage taken`);
      if (e.phys_def_multiplier) effectLines.push(`Phys DEF: +${Math.round((e.phys_def_multiplier - 1) * 100)}%`);
      if (e.mag_def_multiplier) effectLines.push(`Mag DEF: +${Math.round((e.mag_def_multiplier - 1) * 100)}%`);
      if (e.phys_atk_multiplier) effectLines.push(`Phys ATK: +${Math.round((e.phys_atk_multiplier - 1) * 100)}%`);
      if (e.mag_atk_multiplier) effectLines.push(`Mag ATK: +${Math.round((e.mag_atk_multiplier - 1) * 100)}%`);
      if (e.dodge_bonus) effectLines.push(`Dodge: +${Math.round(e.dodge_bonus * 100)}%`);
      if (e.heal_allies_percent_of_damage) effectLines.push(`Heals allies: ${Math.round(e.heal_allies_percent_of_damage * 100)}% of damage`);
      if (e.physical_resist_bonus) effectLines.push(`Phys Resist: +${Math.round(e.physical_resist_bonus * 100)}%`);
      if (e.damage_reduction) effectLines.push(`Damage Reduction: ${Math.round(e.damage_reduction * 100)}%`);
      if (e.hp_regen_per_turn) effectLines.push(`HP Regen: +${e.hp_regen_per_turn}/turn`);
      if (e.mp_regen_per_turn) effectLines.push(`MP Regen: +${e.mp_regen_per_turn}/turn`);
      if (e.duration) effectLines.push(`Duration: ${e.duration} turns`);
      if (e.execute_threshold) effectLines.push(`Execute: kills below ${Math.round(e.execute_threshold * 100)}% HP`);
      if (e.guaranteed_crit) effectLines.push(`Guaranteed Critical Hit`);
      if (e.force_target) effectLines.push(`Forces enemies to attack you`);
    }
    if (ab.bonus_vs) {
      for (const [type, mult] of Object.entries(ab.bonus_vs)) {
        effectLines.push(`+${Math.round((mult - 1) * 100)}% vs ${type}`);
      }
    }

    content.innerHTML = `
      <div style="max-width:400px;">
        <div style="font-size:18px;font-weight:700;color:var(--text-bright);">${ab.name}${ul > 0 ? ` <span style="color:var(--accent-light);font-size:12px;">+${ul} upgraded</span>` : ''}</div>
        <div style="font-size:11px;color:var(--accent-light);text-transform:uppercase;margin-bottom:8px;">${ab.type}${ab.type === 'aura' ? ' (passive)' : ''}</div>
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:10px;">${ab.description}</div>
        <div style="display:flex;flex-direction:column;gap:3px;font-size:12px;">${lines.join('')}</div>
        ${effectLines.length > 0 ? `
          <div class="section-label" style="margin-top:8px;">Effects</div>
          <div style="display:flex;flex-direction:column;gap:2px;font-size:12px;">
            ${effectLines.map(l => `<div style="color:var(--accent-light);">${l}</div>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
    document.getElementById('modal-item').style.display = 'flex';
  }

  return { refreshShops, renderGuild, renderBlacksmith, renderBlacksmithSell, renderSalvagePanel, renderForge, renderAlchemist, renderPartyCamp, renderFormation, renderAbilityManager, getBlacksmithStock: () => blacksmithStock, getAlchemistStock: () => alchemistStock };
})();
