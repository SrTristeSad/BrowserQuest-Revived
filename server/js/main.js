'use strict';

var fs = require('fs'),
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

function main(config) {
    var ws = require('./ws'),
        WorldServer = require('./worldserver'),
        Player = require('./player'),
        _ = require('underscore'),
        worlds = [],
        metrics,
        server,
        lastTotalPlayers = 0,
        checkPopulationInterval;

    global.log = createLogger(config.debug_level);
    log.info('Starting BrowserQuest game server...');

    server = new ws.MultiVersionWebsocketServer(config.port);
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

    server.onConnect(function(connection) {
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
    });

    server.onError(function(error) {
        log.error(error && error.stack ? error.stack : String(error));
    });

    var onPopulationChange = function() {
        if(!metrics) {
            return;
        }

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
        metrics.ready(function() {
            onPopulationChange();
        });
    }

    process.on('SIGINT', function() {
        clearInterval(checkPopulationInterval);
        process.exit(0);
    });

    process.on('SIGTERM', function() {
        clearInterval(checkPopulationInterval);
        process.exit(0);
    });

    process.on('uncaughtException', function(error) {
        log.error('uncaughtException: ' + (error && error.stack ? error.stack : error));
    });
}

function getWorldDistribution(worlds) {
    return worlds.map(function(world) {
        return world.playerCount;
    });
}

function getConfigFile(path, callback) {
    fs.readFile(path, 'utf8', function(error, jsonString) {
        if(error) {
            if(error.code !== 'ENOENT') {
                console.error('Could not open config file:', error.path || path, error.message);
            }
            callback(null);
            return;
        }

        try {
            callback(JSON.parse(jsonString));
        } catch(parseError) {
            console.error('Could not parse config file:', path, parseError.message);
            callback(null);
        }
    });
}

var defaultConfigPath = './server/config.json',
    customConfigPath = process.argv[2] || './server/config_local.json';

getConfigFile(defaultConfigPath, function(defaultConfig) {
    getConfigFile(customConfigPath, function(localConfig) {
        var config = localConfig || defaultConfig;

        if(!config) {
            console.error('Server cannot start without a valid configuration file.');
            process.exit(1);
            return;
        }

        if(process.env.PORT) {
            config.port = parseInt(process.env.PORT, 10);
        }

        main(config);
    });
});
