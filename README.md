# BrowserQuest Revived

Revival and modernization of the original **Mozilla BrowserQuest** while preserving the original game, pixel art, maps, audio and visual identity.

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
- automated HTTP, WebSocket, installer, admin, Story Editor and World Editor smoke tests.

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

No Docker, Redis or external database is required for the current version.

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

The first World Editor version includes:

- visual logical map canvas with zoom and optional grid;
- collision painting/removal;
- placement and removal of NPCs and mobs;
- creation and editing of rectangular mob spawn areas;
- reusable custom NPC profiles with name, existing base sprite, custom dialogue and Story Editor hooks;
- reusable custom mob profiles with existing base sprite, HP, armor, attack, respawn time, chase distance and configurable drops;
- draft workflow before publication;
- preservation of the original map as the protected base;
- previous published server-map snapshots under the private `var/` configuration directory;
- synchronized generation of server and browser client map data;
- automatic loading of the published server world after the Node.js project is restarted.

A custom NPC can therefore reuse an original sprite such as `guard`, receive a unique name/dialogue and be linked to story/mission IDs. A custom mob can reuse a sprite such as `rat` while having independent combat statistics, respawn configuration and loot table.

Publishing generates private runtime map files rather than modifying the original repository map files. The browser receives the corresponding published client map automatically, keeping collision, doors and checkpoints synchronized with the server.

**Current scope:** this version edits logical world data and preserves the original terrain/tile artwork. Full terrain tile painting using the BrowserQuest tilesheet is a future expansion of the World Editor.

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
- `server/` - multiplayer game server and world logic
- `server/admin/` - admin authentication, Story Editor, World Editor and private content storage
- `shared/` - protocol/entity definitions shared by client and server
- `tools/` - original map conversion tools
- `test/` - modernization smoke tests

## Original project

BrowserQuest is an HTML5/JavaScript multiplayer game experiment originally released by Mozilla and created by Little Workshop.

### Credits

Created by [Little Workshop](http://www.littleworkshop.fr):

- Franck Lecollinet - [@whatthefranck](http://twitter.com/whatthefranck)
- Guillaume Lecollinet - [@glecollinet](http://twitter.com/glecollinet)

## License

Code is licensed under **MPL 2.0**. Content is licensed under **CC-BY-SA 3.0**.
See the `LICENSE` file for details.
