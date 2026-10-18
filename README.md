# BrowserQuest Revived

Revival and modernization of the original **Mozilla BrowserQuest** while preserving the original game, pixel art, maps, audio and visual identity.

> Development plan: see [`ROADMAP.md`](ROADMAP.md) and the master tracking issue.
>
> **Data architecture:** the current v0.4.0 still runs without an external database. The next account/persistence phase adopts **PostgreSQL as the permanent source of truth** and **Redis for sessions, rate limiting, presence and cache**. Docker is not required.

## Current status

The project runs on **Node.js 24 LTS** and now includes:

- original BrowserQuest client, maps, sprites and audio preserved;
- modern RFC 6455 WebSocket server using `ws`;
- original BrowserQuest JSON protocol preserved;
- one-process hosting for the game client + WebSocket;
- automatic `ws://` / `wss://` selection behind HTTP/HTTPS;
- `/status`, `/health` and `/ready` endpoints;
- visual first-run installer at `/setup`;
- six-digit installation code printed in the Node.js logs;
- owner/admin account created during setup with password stored as a `scrypt` hash;
- authenticated administration area at `/admin`;
- visual Story Editor at `/admin/story-editor`;
- visual World Editor at `/admin/world-editor`;
- synchronized publication of server/client world data;
- lightweight server-authoritative Brain System for NPCs and mobs;
- automated HTTP, WebSocket, installer, admin, Story Editor, World Editor and Brain System smoke tests.

## aaPanel installation

Create a **Node.js Project** and use Node.js 24 LTS.

Start command:

```bash
npm start
```

On the first start, open the configured domain. The project redirects to `/setup`.

The six-digit setup code is printed in the Node.js project logs:

```text
CÓDIGO DE INSTALAÇÃO: 123456
```

The setup configures the world count, player limit and first owner/admin account. After setup, the same Node.js process serves the game and the administration area.

No Docker, Redis or external database is required for the current **v0.4.0** runtime. PostgreSQL + Redis are planned for the next account/persistence phase described in the roadmap.

## Story Editor

Open:

```text
/admin/story-editor
```

The editor can create and publish campaign definitions containing:

- stories and chapters;
- missions;
- NPC mission givers;
- introductory and completion dialogue;
- objectives: talk, kill, collect, visit, interact or custom;
- quantities and target IDs;
- rewards: item, achievement, story flag or custom;
- linear next-mission links;
- player choices and branching narrative conditions;
- draft and published states.

Story definitions are stored privately under `var/` and are not committed to Git.

**Important:** the visual editor and storage/API are functional. The gameplay runtime that consumes published stories and advances player mission progress is a separate layer still to be implemented.

## World Editor

Open:

```text
/admin/world-editor
```

The World Editor includes:

- visual logical map canvas with zoom and optional grid;
- collision painting/removal;
- placement and removal of NPCs and mobs;
- creation and editing of rectangular mob spawn areas;
- reusable custom NPC profiles with name, existing base sprite, custom dialogue and Story Editor hooks;
- reusable custom mob profiles with existing base sprite, HP, armor, attack, respawn time, chase distance and configurable drops;
- Brain System configuration for NPCs and mobs;
- draft workflow before publication;
- preservation of the original map as the protected base;
- previous published server-map snapshots under the private `var/` configuration directory;
- synchronized generation of server and browser client map data;
- automatic loading of the published server world after the Node.js project is restarted.

A custom NPC can therefore reuse an original sprite such as `guard`, receive a unique name/dialogue, be linked to story/mission IDs and receive its own behavior preset. A custom mob can reuse a sprite such as `rat` while having independent combat statistics, respawn configuration, loot table and behavior.

Publishing generates private runtime map files rather than modifying the original repository map files. The browser receives the corresponding published client map automatically, keeping collision, doors and checkpoints synchronized with the server.

**Current scope:** this version edits logical world data and preserves the original terrain/tile artwork. Full terrain tile painting using the BrowserQuest tilesheet remains outside the current release scope.

## Sprite Importer — Phase 6 foundation

Administrators can open `/admin/sprite-importer` from the World Editor to import
PNG sprite sheets, inspect grid frames, and store the assets privately.

- Accepted: PNG 8-bit RGB, RGBA, grayscale or indexed, non-interlaced.
- Maximum uploaded file: 2 MiB; maximum image area: 4 megapixels.
- Frame dimensions are configurable (1–1024 px per axis) and must divide
  the full sheet dimensions exactly; at most 4,096 frames per import.
- Imported assets are stored under the installation's private
  `var/sprite-imports` equivalent (the same `configDir` used by the admin panel),
  outside the public `client/img` assets. Existing game sprites are unchanged.
- The PNG preview URL requires a current admin session. Invalid PNG chunks,
  CRCs, oversized compressed payloads and invalid frame geometry are rejected.
- **Import does not yet publish or bind a sprite to an NPC/mob.**
  The next Phase 6 delivery maps animation directions and integrates
  an explicitly published asset into the existing client sprite registry.
  Do not reference an imported ID as a sprite kind until integration ships.

## Brain System

Version **0.4.0** introduces a lightweight behavior engine shared by NPCs and mobs. It is deliberately **not a neural network**: decisions are deterministic game logic using perception, short memory, priorities and small behavior states, so it remains inexpensive enough for a browser multiplayer game.

The server is authoritative. Clients only receive normal BrowserQuest movement/combat messages, so different players see the same NPC and mob behavior.

NPC behavior currently supports:

- wandering inside a configurable radius;
- patrol routes;
- following nearby players;
- fleeing from nearby mobs;
- configurable vision range and thinking interval;
- short memory of recently seen players and threats.

Mob behavior currently supports:

- wandering;
- proactively detecting and acquiring players;
- chasing an active target;
- fleeing below a configurable health percentage;
- territorial/leash limits;
- abandoning combat and returning toward the spawn/home position;
- configurable vision, movement radius and thinking interval.

The World Editor exposes presets so common entities can be configured quickly:

- NPC: **Aldeão**, **Comerciante**, **Guarda** and **Companheiro**;
- mob: **Agressivo**, **Covarde**, **Territorial** and **Passivo**.

NPCs and mobs receive a brain by default. A legacy NPC sprite that has no walking animation can still move: the client safely falls back to an available idle frame rather than failing. A complete imported walking spritesheet can later provide the full visual animation without changing the server behavior.

The current movement solver intentionally remains small and inexpensive, choosing valid neighboring tiles while respecting map collision and occupied positions. More advanced route planning can be added later without changing the Brain System profile format.

Brain behavior and World Editor persistence have deterministic smoke tests:

```bash
npm run test:brain
```

## Native development

```bash
npm install
npm start
```

The default port is `8000`. You can override it with `PORT`.

Diagnostics:

```bash
npm run doctor:aapanel
```

Run the legacy game server directly without the first-run wrapper:

```bash
npm run start:server
```

## Project layout

- `app.js` - aaPanel/first-run application bootstrap
- `client/` - original HTML5 game client, UI, audio, images, sprites and maps
- `server/` - multiplayer game server, world logic and Brain System
- `server/admin/` - admin authentication, Story Editor, World Editor and private content storage
- `shared/` - protocol/entity definitions shared by client and server
- `tools/` - original map conversion tools
- `test/` - modernization, WebSocket and Brain System smoke tests

## Original project

BrowserQuest is an HTML5/JavaScript multiplayer game experiment originally released by Mozilla and created by Little Workshop.

### Credits

Created by [Little Workshop](http://www.littleworkshop.fr):

- Franck Lecollinet - [@whatthefranck](http://twitter.com/whatthefranck)
- Guillaume Lecollinet - [@glecollinet](http://twitter.com/glecollinet)

## License

Code is licensed under **MPL 2.0**. Content is licensed under **CC-BY-SA 3.0**.
See the `LICENSE` file for details.
