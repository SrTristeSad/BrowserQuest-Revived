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
        _ = require('underscore'),
        worlds = [],
        metrics,
        server,
        lastTotalPlayers = 0,
        checkPopulationInterval;

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

    if(metrics) {
        metrics.ready(function() { onPopulationChange(); });
    }

    function shutdown() {
        clearInterval(checkPopulationInterval);
    }

    process.once('SIGINT', function() {
        shutdown();
        process.exit(0);
    });

    process.once('SIGTERM', function() {
        shutdown();
        process.exit(0);
    });

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
