<div align="center">

# ⚔️ Dungeon Crawler

### Browser-Based Team Autobattler

[![HTML5](https://img.shields.io/badge/HTML5-E34F26.svg)](https://developer.mozilla.org/en-US/docs/Web/HTML)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E.svg)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Supabase](https://img.shields.io/badge/Supabase-Cloud%20Saves-3ECF8E.svg)](https://supabase.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Build your party. Enter the dungeon. Watch them fight.**

*A browser-based team autobattler dungeon crawler with 12 character classes, crafting, formations, set bonuses, and cloud saves — built for my son.*

</div>

---

## Quick Start

```bash
# Clone and play immediately
git clone https://github.com/astafford8488/dungeon-crawler.git
cd dungeon-crawler

# Option 1: Open directly in your browser
# Just open index.html — no build step, no dependencies

# Option 2: Use a local server (recommended for cloud saves)
npx serve .
# Then open http://localhost:3000
```

> **Cloud saves** require a Supabase project. Set up your own Supabase instance and update the credentials in `js/cloud.js`. The game works fully offline with local storage saves — cloud saves are optional.

## Features

| Feature | Details |
|---------|---------|
| **12 Character Classes** | Warrior, Mage, Rogue, Paladin, Necromancer, Ranger, Cleric, Berserker, Bard, Monk, Warlock, Druid |
| **6 Dungeons** | Progressive difficulty with unique monster encounters |
| **Crafting System** | Collect materials, craft weapons and armor |
| **Formations** | Strategic party positioning affects combat |
| **Set Bonuses** | Equip matching gear for bonus stats |
| **Monster Types** | Beasts, Demons, Undead, Elementals, Bosses |
| **Cloud Saves** | Supabase auth + 3 save slots with offline fallback |
| **Leaderboards** | Track party progress and achievements |

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JavaScript (zero dependencies)
- **Backend:** Supabase (authentication + cloud saves)
- **Data:** JSON-driven classes, monsters, items, and encounters

## Project Structure

```
dungeon-crawler/
├── index.html          # Main game page
├── js/
│   ├── game.js         # Game loop, save/load, state management
│   ├── combat.js       # Autobattle engine
│   ├── dungeon.js      # Dungeon generation and encounters
│   ├── party.js        # Party management and leveling
│   ├── town.js         # Town hub (shop, crafting, tavern)
│   ├── crafting.js     # Crafting system
│   ├── items.js        # Item and equipment management
│   ├── ui.js           # UI rendering and modals
│   └── cloud.js        # Supabase cloud save integration
├── data/
│   ├── classes/        # 12 character class definitions (JSON)
│   ├── monsters/       # Monster types and stats (JSON)
│   ├── encounters/     # Dungeon encounter tables (JSON)
│   └── items/          # Weapons, armor, materials (JSON)
└── css/
    └── style.css       # Game styling
```

## How to Play

1. Open `index.html` in a browser
2. Create a new party and recruit heroes from the tavern
3. Equip gear and set formations
4. Enter a dungeon and watch your party autobattle
5. Collect loot, level up, craft better gear, go deeper

## License

MIT
