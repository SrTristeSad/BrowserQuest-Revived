# BrowserQuest Revived

Revival and modernization of the original **Mozilla BrowserQuest** while preserving the original game, pixel art, maps, audio and visual identity.

The goal of this repository is to make the old BrowserQuest codebase practical to run and modify on current systems without redesigning the game.

## Current status

The first server modernization layer is working on **Node.js 24 LTS**:

- original BrowserQuest client, maps, sprites and audio preserved;
- obsolete WebSocket implementations replaced by the maintained `ws` package;
- original JSON BrowserQuest protocol preserved;
- `/status` health endpoint preserved;
- old map loading updated for current Node.js;
- automated server startup test;
- automated real WebSocket `HELLO` / `WELCOME` handshake test.

The browser client is still the original BrowserQuest client. Making local/browser startup as simple as the server is the next modernization step.

## Requirements

- Node.js 24 LTS recommended
- Node.js 22+ supported by the project configuration
- npm

No container runtime is required.

## Start the game server

```bash
npm install
npm start
```

The default game server listens on port `8000`.

Server status can be checked at:

```text
http://localhost:8000/status
```

With the default configuration, a freshly started server returns the population of its five worlds.

## Configuration

Default server settings are in:

```text
server/config.json
```

For local overrides, copy:

```text
server/config_local.json-dist
```

to:

```text
server/config_local.json
```

The server also accepts a custom configuration path:

```bash
node server/js/main.js ./path/to/config.json
```

The listening port can additionally be overridden with the `PORT` environment variable.

## Project layout

- `client/` - original HTML5 game client, UI, audio, images, sprites and maps
- `server/` - multiplayer game server and world logic
- `shared/` - protocol/entity definitions shared by client and server
- `tools/` - original map conversion tools
- `test/` - modernization smoke tests

## Modernization policy

Changes should preserve original gameplay and presentation unless a deliberate gameplay change is being developed. Compatibility work should be incremental so that old global/module assumptions can be removed without rewriting the entire game at once.

## Original project

BrowserQuest is an HTML5/JavaScript multiplayer game experiment originally released by Mozilla and created by Little Workshop.

### Credits

Created by [Little Workshop](http://www.littleworkshop.fr):

- Franck Lecollinet - [@whatthefranck](http://twitter.com/whatthefranck)
- Guillaume Lecollinet - [@glecollinet](http://twitter.com/glecollinet)

## License

Code is licensed under **MPL 2.0**. Content is licensed under **CC-BY-SA 3.0**.
See the `LICENSE` file for details.
