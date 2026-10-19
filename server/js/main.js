'use strict';

var fs = require('fs'),
    path = require('path'),
    Metrics = require('./metrics'),
    Log = require('log');

function createLogger(level) {
    switch(level) {
        case 'error':
            return new Log(Log.ERROR);
        case 'debug':
            return new Log(Log.DEBUG);
        case 'info':
        default:
            return new Log(Log.INFO);
    }
}

function resolvePublishedMap(config) {
    var configDir = process.env.BROWSERQUEST_CONFIG_DIR || path.join(process.cwd(), 'var', 'config'),
        published = path.join(configDir, 'world_server_published.json');

    if(fs.existsSync(published)) {
        config.map_filepath = published;
        config.world_editor_published = true;
    }
    return config;
}

function start(config) {
    var ws = require('./ws'),
        WorldServer = require('./worldserver'),
        Player = require('./player'),
        StoryKillProgress = require('../story/kill-progress'),
        _ = require('underscore'),
        worlds = [],
        metrics,
        server,
        lastTotalPlayers = 0,
        checkPopulationInterval;

    StoryKillProgress.attach(WorldServer);
    config = resolvePublishedMap(Object.assign({}, config));
    config.port = parseInt(process.env.PORT || config.port || 8000, 10);
    config.host = process.env.HOST || config.host || '127.0.0.1';

    global.log = createLogger(config.debug_level);
    log.info('Starting BrowserQuest game server...');
    if(config.world_editor_published) {
        log.info('Loading published world from World Editor: ' + config.map_filepath);
    }

    server = new ws.MultiVersionWebsocketServer(config.port, {
        host: config.host,
        serveClient: config.serve_client !== false,
        httpHandler: config.http_handler || null
    });
    metrics = config.metrics_enabled ? new Metrics(config) : null;

    checkPopulationInterval = setInterval(function() {
        if(metrics && metrics.isReady) {
            metrics.getTotalPlayers(function(totalPlayers) {
                if(totalPlayers !== lastTotalPlayers) {
                    lastTotalPlayers = totalPlayers;
                    _.each(worlds, function(world) {
                        world.updatePopulation(totalPlayers);
                    });
                }
            });
        }
    }, 1000);

    function selectWorldAndConnect(connection) {
        var world,
            connect = function() {
                if(connection.closed) { return; }
                if(world) {
                    world.connect_callback(new Player(connection, world));
                } else {
                    connection.close('All game worlds are full.');
                }
            };

        if(metrics) {
            metrics.getOpenWorldCount(function(openWorldCount) {
                world = _.min(_.first(worlds, openWorldCount), function(candidate) {
                    return candidate.playerCount;
                });
                connect();
            });
        } else {
            world = _.detect(worlds, function(candidate) {
                return candidate.playerCount < config.nb_players_per_world;
            });
            if(world) {
                world.updatePopulation();
            }
            connect();
        }
    }

    server.onConnect(function(connection) {
        var authorize = config.player_authenticator;

        if(!authorize) {
            connection.authContext = {allowed: true, type: 'guest', accessMode: 'name_only'};
            connection.characterPersistence = null;
            connection.storyRuntime = config.story_runtime || null;
            connection.storyProgress = null;
            selectWorldAndConnect(connection);
            return;
        }

        Promise.resolve(authorize(connection)).then(function(context) {
            if(!context || context.allowed === false) {
                connection.close((context && context.reason) || 'Acesso não autorizado.');
                return;
            }
            connection.authContext = context;
            connection.playerAuthService = config.player_auth_service || null;
            connection.characterPersistence = config.player_persistence || null;
            connection.storyRuntime = config.story_runtime || null;
            connection.storyProgress = context.type === 'account' ? (config.story_progress || null) : null;
            selectWorldAndConnect(connection);
        }).catch(function(error) {
            log.error('Player authorization failed: ' + (error && error.stack ? error.stack : error));
            connection.close('Falha ao validar sua sessão.');
        });
    });

    server.onError(function(error) {
        log.error(error && error.stack ? error.stack : String(error));
    });

    var onPopulationChange = function() {
        if(!metrics) { return; }
        metrics.updatePlayerCounters(worlds, function(totalPlayers) {
            _.each(worlds, function(world) {
                world.updatePopulation(totalPlayers);
            });
        });
        metrics.updateWorldDistribution(getWorldDistribution(worlds));
    };

    _.each(_.range(config.nb_worlds), function(i) {
        var world = new WorldServer('world' + (i + 1), config.nb_players_per_world, server);
        world.run(config.map_filepath);
        worlds.push(world);
        if(metrics) {
            world.onPlayerAdded(onPopulationChange);
            world.onPlayerRemoved(onPopulationChange);
        }
    });

    server.onRequestStatus(function() {
        return JSON.stringify(getWorldDistribution(worlds));
    });

    server.adminRuntime = {
        startedAt: Date.now(),
        getSnapshot: function() {
            var distribution = getWorldDistribution(worlds);
            return {
                onlinePlayers: distribution.reduce(function(total, count) { return total + count; }, 0),
                worldCount: worlds.length,
                maxPlayersPerWorld: config.nb_players_per_world,
                worlds: worlds.map(function(world, index) {
                    return {
                        id: world.id || ('world' + (index + 1)),
                        index: index + 1,
                        players: world.playerCount,
                        capacity: config.nb_players_per_world
                    };
                }),
                websocket: true
            };
        },
        listPlayers: function() {
            var players = [];
            worlds.forEach(function(world, worldIndex) {
                Object.keys(world.players || {}).forEach(function(playerId) {
                    var player = world.players[playerId],
                        auth = player && player.connection ? player.connection.authContext : null;
                    if(!player) { return; }
                    players.push({
                        id: String(player.id),
                        name: player.name || null,
                        type: auth && auth.type === 'account' ? 'account' : 'guest',
                        world: world.id || ('world' + (worldIndex + 1)),
                        worldIndex: worldIndex + 1,
                        userId: auth && auth.user ? Number(auth.user.id) : null,
                        username: auth && auth.user ? auth.user.username : null,
                        characterId: auth && auth.character ? Number(auth.character.id) : null,
                        connected: true
                    });
                });
            });
            return players;
        },
        broadcastAnnouncement: function(message) {
            var delivered = 0, payload = [require('../../shared/js/gametypes').Messages.ANNOUNCEMENT, message];
            worlds.forEach(function(world) {
                Object.keys(world.players || {}).forEach(function(playerId) {
                    var player = world.players[playerId];
                    if(player && player.connection) {
                        player.connection.send(payload);
                        delivered += 1;
                    }
                });
            });
            return delivered;
        },
        mutePlayer: async function(playerId, durationSeconds, reason) {
            var targetPlayer = null, found = null;
            worlds.some(function(world, worldIndex) {
                var player = world.players && world.players[String(playerId)], auth;
                if(!player) { return false; }
                auth = player.connection && player.connection.authContext;
                targetPlayer = player;
                found = {
                    id: String(player.id),
                    name: player.name || null,
                    world: world.id || ('world' + (worldIndex + 1)),
                    userId: auth && auth.user ? Number(auth.user.id) : null,
                    username: auth && auth.user ? auth.user.username : null,
                    characterId: auth && auth.character ? Number(auth.character.id) : null,
                    type: auth && auth.type === 'account' ? 'account' : 'guest'
                };
                return true;
            });
            if(!targetPlayer) { return null; }

            var seconds = Math.floor(Number(durationSeconds)), until = Date.now() + (seconds * 1000), persistent = false;
            if(found.userId && targetPlayer.connection.playerAuthService && typeof targetPlayer.connection.playerAuthService.setMuteForUser === 'function') {
                var stored = await targetPlayer.connection.playerAuthService.setMuteForUser(found.userId, seconds, reason);
                until = stored.until;
                persistent = true;
            }
            if(typeof targetPlayer.setMute === 'function') { targetPlayer.setMute(until, reason); }
            targetPlayer.send([require('../../shared/js/gametypes').Messages.ANNOUNCEMENT, 'Você foi silenciado por ' + Math.ceil(seconds / 60) + ' min.']);
            found.until = until;
            found.durationSeconds = seconds;
            found.persistent = persistent;
            return found;
        },
        kickPlayer: async function(playerId, reason) {
            var found = null, targetPlayer = null;
            worlds.some(function(world, worldIndex) {
                var player = world.players && world.players[String(playerId)], auth;
                if(!player) { return false; }
                auth = player.connection && player.connection.authContext;
                targetPlayer = player;
                found = {
                    id: String(player.id),
                    name: player.name || null,
                    world: world.id || ('world' + (worldIndex + 1)),
                    userId: auth && auth.user ? Number(auth.user.id) : null,
                    username: auth && auth.user ? auth.user.username : null,
                    characterId: auth && auth.character ? Number(auth.character.id) : null
                };
                return true;
            });
            if(!targetPlayer) { return null; }

            targetPlayer.connection.close(String(reason || 'Conexão encerrada pelo administrador.').slice(0, 120));
            if(typeof targetPlayer.flushPersistence === 'function') {
                await targetPlayer.flushPersistence();
            }
            return found;
        },
        kickByUserId: function(userId, reason) {
            var count = 0;
            userId = Number(userId);
            worlds.forEach(function(world) {
                Object.keys(world.players || {}).forEach(function(playerId) {
                    var player = world.players[playerId],
                        auth = player && player.connection ? player.connection.authContext : null;
                    if(auth && auth.user && Number(auth.user.id) === userId) {
                        count += 1;
                        player.connection.close(String(reason || 'Sua sessão foi encerrada pelo administrador.').slice(0, 120));
                    }
                });
            });
            return count;
        }
    };

    if(metrics) {
        metrics.ready(function() { onPopulationChange(); });
    }

    function shutdown() {
        clearInterval(checkPopulationInterval);
    }

    // Direct/legacy server starts still own their signals. The aaPanel bootstrap
    // disables these handlers so it can flush persistent character state first.
    if(config.manage_process_signals !== false) {
        process.once('SIGINT', function() {
            shutdown();
            process.exit(0);
        });

        process.once('SIGTERM', function() {
            shutdown();
            process.exit(0);
        });
    }

    process.once('uncaughtException', function(error) {
        log.error('uncaughtException: ' + (error && error.stack ? error.stack : error));
    });

    return server;
}

function getWorldDistribution(worlds) {
    return worlds.map(function(world) { return world.playerCount; });
}

function readConfigFile(filepath, callback) {
    fs.readFile(filepath, 'utf8', function(error, jsonString) {
        if(error) {
            if(error.code !== 'ENOENT') {
                console.error('Could not open config file:', error.path || filepath, error.message);
            }
            callback(null);
            return;
        }
        try {
            callback(JSON.parse(jsonString));
        } catch(parseError) {
            console.error('Could not parse config file:', filepath, parseError.message);
            callback(null);
        }
    });
}

function startFromFiles(customConfigPath) {
    var defaultConfigPath = './server/config.json',
        localPath = customConfigPath || './server/config_local.json';

    readConfigFile(defaultConfigPath, function(defaultConfig) {
        readConfigFile(localPath, function(localConfig) {
            var config = localConfig || defaultConfig;
            if(!config) {
                console.error('Server cannot start without a valid configuration file.');
                process.exitCode = 1;
                return;
            }
            start(config);
        });
    });
}

exports.start = start;
exports.startFromFiles = startFromFiles;
exports.readConfigFile = readConfigFile;
exports.resolvePublishedMap = resolvePublishedMap;

if(require.main === module) {
    startFromFiles(process.argv[2]);
}
