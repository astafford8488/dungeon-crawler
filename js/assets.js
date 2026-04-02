// assets.js — Asset path mapping for sprites
const Assets = (() => {
  const characterSprites = {
    warrior: 'assets/characters/warrior.png',
    mage: 'assets/characters/mage.png',
    rogue: 'assets/characters/rogue.png',
    cleric: 'assets/characters/cleric.png',
    ranger: 'assets/characters/ranger.png',
    paladin: 'assets/characters/paladin.png',
    necromancer: 'assets/characters/necromancer.png',
    beastlord: 'assets/characters/beastlord.png',
    elementalist: 'assets/characters/elementalist.png',
    auramancer: 'assets/characters/auramancer.png',
    witch: 'assets/characters/witch.png',
    shadowknight: 'assets/characters/shadowknight.png',
  };

  const monsterSprites = {
    skeleton_warrior: 'assets/monsters/skeleton_warrior.png',
    skeleton_archer: 'assets/monsters/skeleton_warrior.png',
    zombie: 'assets/monsters/skeleton_warrior.png',
    ghoul: 'assets/monsters/skeleton_warrior.png',
    wraith: 'assets/monsters/boss_lich_king.png',
    necromancer_acolyte: 'assets/monsters/boss_lich_king.png',
    giant_rat: 'assets/monsters/dire_wolf.png',
    dire_wolf: 'assets/monsters/dire_wolf.png',
    cave_spider: 'assets/monsters/dire_wolf.png',
    cave_bear: 'assets/monsters/boss_alpha_beast.png',
    giant_scorpion: 'assets/monsters/dire_wolf.png',
    bat_swarm: 'assets/monsters/dire_wolf.png',
    imp: 'assets/monsters/imp.png',
    hellhound: 'assets/monsters/imp.png',
    succubus: 'assets/monsters/boss_demon_lord.png',
    pit_fiend: 'assets/monsters/boss_demon_lord.png',
    shadow_stalker: 'assets/monsters/imp.png',
    fire_elemental: 'assets/monsters/fire_elemental.png',
    ice_elemental: 'assets/monsters/fire_elemental.png',
    lightning_elemental: 'assets/monsters/fire_elemental.png',
    earth_elemental: 'assets/monsters/fire_elemental.png',
    goblin_grunt: 'assets/monsters/orc_berserker.png',
    goblin_shaman: 'assets/monsters/orc_berserker.png',
    orc_berserker: 'assets/monsters/orc_berserker.png',
    bandit_rogue: 'assets/monsters/orc_berserker.png',
    dark_knight: 'assets/monsters/boss_warlord.png',
    cultist: 'assets/monsters/orc_berserker.png',
  };

  const bossSprites = {
    boss_lich_king: 'assets/monsters/boss_lich_king.png',
    boss_alpha_beast: 'assets/monsters/boss_alpha_beast.png',
    boss_demon_lord: 'assets/monsters/boss_demon_lord.png',
    boss_elemental_titan: 'assets/monsters/boss_elemental_titan.png',
    boss_warlord: 'assets/monsters/boss_warlord.png',
    boss_abyss_lord: 'assets/monsters/boss_demon_lord.png',
  };

  function getCharacterSprite(classId) {
    return characterSprites[classId] || null;
  }

  function getMonsterSprite(monsterId) {
    return bossSprites[monsterId] || monsterSprites[monsterId] || null;
  }

  function spriteImg(src, size) {
    if (!src) return '';
    const s = size || 36;
    return `<img src="${src}" width="${s}" height="${s}" style="image-rendering:pixelated;" alt="">`;
  }

  return { getCharacterSprite, getMonsterSprite, spriteImg, characterSprites, monsterSprites, bossSprites };
})();
