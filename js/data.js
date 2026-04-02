// data.js — Loads all JSON game data and provides access
const Data = (() => {
  const cache = {};
  const paths = {
    statSystem: 'data/stat_system.json',
    itemSystem: 'data/items/item_system.json',
    weapons: 'data/items/weapons.json',
    armor: 'data/items/armor.json',
    shields: 'data/items/shields.json',
    accessories: 'data/items/accessories.json',
    classItems: 'data/items/class_items.json',
    consumables: 'data/items/consumables.json',
    warrior: 'data/classes/warrior.json',
    mage: 'data/classes/mage.json',
    rogue: 'data/classes/rogue.json',
    cleric: 'data/classes/cleric.json',
    ranger: 'data/classes/ranger.json',
    paladin: 'data/classes/paladin.json',
    necromancer: 'data/classes/necromancer.json',
    beastlord: 'data/classes/beastlord.json',
    elementalist: 'data/classes/elementalist.json',
    auramancer: 'data/classes/auramancer.json',
    witch: 'data/classes/witch.json',
    shadowknight: 'data/classes/shadowknight.json',
    abilityPools: 'data/ability_pools.json',
    crafting: 'data/crafting.json',
    formations: 'data/formations.json',
    dungeonEvents: 'data/dungeon_events.json',
    dungeonModifiers: 'data/dungeon_modifiers.json',
    setBonuses: 'data/set_bonuses.json',
    postDungeonEvents: 'data/post_dungeon_events.json',
    monsterSystem: 'data/monsters/monster_system.json',
    undead: 'data/monsters/undead.json',
    beasts: 'data/monsters/beasts.json',
    demons: 'data/monsters/demons.json',
    elementals: 'data/monsters/elementals.json',
    humanoids: 'data/monsters/humanoids.json',
    bosses: 'data/monsters/bosses.json',
    encounterSystem: 'data/encounters/encounter_system.json',
    crypt: 'data/encounters/crypt_of_shadows.json',
    thornwood: 'data/encounters/thornwood_depths.json',
    ironHorde: 'data/encounters/iron_horde_fortress.json',
    infernal: 'data/encounters/infernal_rift.json',
    elemental: 'data/encounters/elemental_sanctum.json',
    abyss: 'data/encounters/the_abyss.json',
  };

  async function loadAll() {
    const entries = Object.entries(paths);
    const results = await Promise.all(
      entries.map(([key, path]) =>
        fetch(path).then(r => r.json()).then(data => [key, data])
      )
    );
    for (const [key, data] of results) {
      cache[key] = data;
    }
    buildIndexes();
    return cache;
  }

  // Build lookup maps after load
  function buildIndexes() {
    // Classes by id
    cache.classes = {};
    for (const cid of ['warrior', 'mage', 'rogue', 'cleric', 'ranger', 'paladin', 'necromancer', 'beastlord', 'elementalist', 'auramancer', 'witch', 'shadowknight']) {
      cache.classes[cid] = cache[cid];
    }

    // All equipment items flat list
    cache.allEquipment = [];
    for (const src of [cache.weapons, cache.armor, cache.shields, cache.accessories, cache.classItems]) {
      if (src && src.items) cache.allEquipment.push(...src.items);
    }

    // Equipment by id
    cache.equipById = {};
    for (const item of cache.allEquipment) {
      cache.equipById[item.id] = item;
    }

    // Monsters by id
    cache.monstersById = {};
    for (const src of [cache.undead, cache.beasts, cache.demons, cache.elementals, cache.humanoids]) {
      if (src && src.monsters) {
        for (const m of src.monsters) {
          cache.monstersById[m.id] = m;
        }
      }
    }

    // Bosses by id
    cache.bossesById = {};
    if (cache.bosses && cache.bosses.bosses) {
      for (const b of cache.bosses.bosses) {
        cache.bossesById[b.id] = b;
      }
    }

    // Dungeons list
    cache.dungeons = [
      cache.crypt, cache.thornwood, cache.ironHorde,
      cache.infernal, cache.elemental, cache.abyss
    ];

    cache.dungeonsById = {};
    for (const d of cache.dungeons) {
      cache.dungeonsById[d.dungeon_id] = d;
    }
  }

  function get(key) { return cache[key]; }

  return { loadAll, get, cache };
})();
