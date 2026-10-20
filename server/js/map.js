var cls = require('./lib/class'),
    fs = require('fs'),
    _ = require('underscore'),
    Utils = require('./utils'),
    SunnysideLayout = require('../../client/maps/sunnyside-layout'),
    Checkpoint = require('./checkpoint'),
    SpawnSafety = require('./spawn-safety'),
    MobBudget = require('./mob-budget'),
    DayCycle = require('../../shared/js/daycycle');

module.exports = cls.Class.extend({
    init: function(filepath) {
        var self = this;
        this.isLoaded = false;

        fs.readFile(filepath, 'utf8', function(err, file) {
            var json;
            if(err) {
                log.error('Could not read map file ' + filepath + ': ' + err.message);
                return;
            }
            try {
                json = JSON.parse(file);
            } catch(parseError) {
                log.error('Could not parse map file ' + filepath + ': ' + parseError.message);
                return;
            }
            self.initMap(json);
        });
    },

    initMap: function(map) {
        this.width = map.width;
        this.height = map.height;
        this.collisions = Array.isArray(map.collisions) ? map.collisions : [];
        // Match the client/worker: blocking terrain is just as solid as
        // explicit collision tiles. Published worlds carry both layers.
        this.blocking = Array.isArray(map.blocking) ? map.blocking : [];
        if(!Array.isArray(map.blocking)) {
            // Legacy server maps predate the client "blocking" layer. Only
            // import it from the paired client map when dimensions, revision
            // and EVERY explicit collision tile match. Never mix layers from
            // unrelated published versions of the world.
            try {
                var mirror = JSON.parse(fs.readFileSync(
                    require('path').join(__dirname, '../../client/maps/world_client.json'),
                    'utf8'));
                var sameCollisions = Array.isArray(mirror.collisions) &&
                    mirror.collisions.length === this.collisions.length &&
                    this.collisions.every(function(tile, index) {
                        return mirror.collisions[index] === tile;
                    });
                if(mirror.width === this.width && mirror.height === this.height &&
                   (mirror.editorRevision || null) === (map.editorRevision || null) &&
                   sameCollisions && Array.isArray(mirror.blocking)) {
                    this.blocking = mirror.blocking;
                }
            } catch(error) {
                // No matching client map: fail closed on explicit server
                // collisions, rather than inventing map geometry.
            }
        }
        this.mobAreas = map.roamingAreas;
        this.spawnSafeRadius = SpawnSafety.normalizeRadius(map.spawnSafeRadius);
        this.maxNearbyMobs = MobBudget.normalizeLimit(map.maxNearbyMobs);
        this.dayNight = DayCycle.normalize(map.dayNight);
        this.chestAreas = map.chestAreas;
        this.staticChests = map.staticChests;
        this.staticEntities = map.staticEntities;
        this.editorMetadata = map.editorMetadata || {};
        this.editorProfiles = map.editorProfiles || {npcs: {}, mobs: {}};
        this.editorRevision = map.editorRevision || null;
        this.isLoaded = true;

        this.zoneWidth = 28;
        this.zoneHeight = 12;
        this.groupWidth = Math.ceil(this.width / this.zoneWidth);
        this.groupHeight = Math.ceil(this.height / this.zoneHeight);

        this.doors = map.doors || [];
        this.initConnectedGroups(this.doors);
        this.initCheckpoints(map.checkpoints);

        if(this.ready_func) {
            this.ready_func();
        }
    },

    ready: function(f) {
        this.ready_func = f;
    },

    tileIndexToGridPosition: function(tileNum) {
        var x = 0, y = 0;
        var getX = function(num, w) {
            if(num === 0) { return 0; }
            return (num % w === 0) ? w - 1 : (num % w) - 1;
        };
        tileNum -= 1;
        x = getX(tileNum + 1, this.width);
        y = Math.floor(tileNum / this.width);
        return { x: x, y: y };
    },

    GridPositionToTileIndex: function(x, y) {
        return (y * this.width) + x + 1;
    },

    generateCollisionGrid: function() {
        this.grid = [];
        if(this.isLoaded) {
            var tileIndex = 0, j, i,
                blocked = new Set((this.collisions || []).concat(this.blocking || []));
            for(i = 0; i < this.height; i += 1) {
                this.grid[i] = [];
                for(j = 0; j < this.width; j += 1) {
                    this.grid[i][j] = blocked.has(tileIndex) ? 1 : 0;
                    tileIndex += 1;
                }
            }
            // Keep furniture footprints authoritative and identical to the
            // client's grid; only enabled for the matching existing house.
            SunnysideLayout.solidCells(this).forEach(function(cell) {
                if(this.grid[cell.y] && this.grid[cell.y][cell.x] !== undefined)
                    this.grid[cell.y][cell.x] = 1;
            }, this);
        }
    },

    isOutOfBounds: function(x, y) {
        return x <= 0 || x >= this.width || y <= 0 || y >= this.height;
    },

    isColliding: function(x, y) {
        if(this.isOutOfBounds(x, y)) { return false; }
        return this.grid[y][x] === 1;
    },

    GroupIdToGroupPosition: function(id) {
        var posArray = id.split('-');
        return pos(parseInt(posArray[0], 10), parseInt(posArray[1], 10));
    },

    forEachGroup: function(callback) {
        var width = this.groupWidth, height = this.groupHeight, x, y;
        for(x = 0; x < width; x += 1) {
            for(y = 0; y < height; y += 1) {
                callback(x + '-' + y);
            }
        }
    },

    getGroupIdFromPosition: function(x, y) {
        var w = this.zoneWidth, h = this.zoneHeight,
            gx = Math.floor((x - 1) / w), gy = Math.floor((y - 1) / h);
        return gx + '-' + gy;
    },

    getAdjacentGroupPositions: function(id) {
        var self = this,
            position = this.GroupIdToGroupPosition(id),
            x = position.x,
            y = position.y,
            list = [];

        // The adaptive camera can show up to 30x22 tiles. Two surrounding
        // groups in each direction keep that whole view subscribed even when
        // the character stands at an edge, not at the centre of the screen.
        // This is bounded to 25 groups, independent of client input.
        for(var dy = -2; dy <= 2; dy += 1) {
            for(var dx = -2; dx <= 2; dx += 1) {
                list.push(pos(x + dx, y + dy));
            }
        }

        _.each(this.connectedGroups[id], function(connectedPosition) {
            if(!_.any(list, function(groupPos) { return equalPositions(groupPos, connectedPosition); })) {
                list.push(connectedPosition);
            }
        });

        return _.reject(list, function(groupPos) {
            return groupPos.x < 0 || groupPos.y < 0 || groupPos.x >= self.groupWidth || groupPos.y >= self.groupHeight;
        });
    },

    forEachAdjacentGroup: function(groupId, callback) {
        if(groupId) {
            _.each(this.getAdjacentGroupPositions(groupId), function(position) {
                callback(position.x + '-' + position.y);
            });
        }
    },

    initConnectedGroups: function(doors) {
        var self = this;
        this.connectedGroups = {};
        _.each(doors, function(door) {
            var groupId = self.getGroupIdFromPosition(door.x, door.y),
                connectedGroupId = self.getGroupIdFromPosition(door.tx, door.ty),
                connectedPosition = self.GroupIdToGroupPosition(connectedGroupId);
            if(groupId in self.connectedGroups) {
                self.connectedGroups[groupId].push(connectedPosition);
            } else {
                self.connectedGroups[groupId] = [connectedPosition];
            }
        });
    },

    initCheckpoints: function(cpList) {
        var self = this;
        this.checkpoints = {};
        this.checkpointList = [];
        this.startingAreas = [];
        this.startingCheckpointRects = [];
        _.each(cpList, function(cp) {
            var checkpoint = new Checkpoint(cp.id, cp.x, cp.y, cp.w, cp.h);
            self.checkpoints[checkpoint.id] = checkpoint;
            self.checkpointList.push(checkpoint);
            if(cp.s === 1) {
                self.startingAreas.push(checkpoint);
                self.startingCheckpointRects.push({x:cp.x, y:cp.y, w:cp.w, h:cp.h, s:1});
            }
        });
    },

    canTeleportFrom: function(x, y, targetX, targetY) {
        return (this.doors || []).some(function(door) {
            return door.x === x && door.y === y && door.tx === targetX && door.ty === targetY;
        });
    },

    isProtectedSpawnTile: function(x, y) {
        return SpawnSafety.isSafeStartingTile(this.startingCheckpointRects, x, y, this.spawnSafeRadius);
    },

    getCheckpoint: function(id) {
        return this.checkpoints[id];
    },

    getVisitLocationIdsAt: function(x, y) {
        var locationIds = [];
        _.each(this.checkpointList || [], function(checkpoint) {
            var locationId;
            if(!checkpoint || typeof checkpoint.containsPosition !== 'function' || !checkpoint.containsPosition(x, y)) { return; }
            locationId = typeof checkpoint.getVisitLocationId === 'function' ? checkpoint.getVisitLocationId() : '';
            if(locationId && !_.include(locationIds, locationId)) {
                locationIds.push(locationId);
            }
        });
        return locationIds.sort();
    },

    getRandomStartingPosition: function() {
        var nbAreas = _.size(this.startingAreas),
            i = Utils.randomInt(0, nbAreas - 1),
            area = this.startingAreas[i];
        return area.getRandomPosition();
    }
});

var pos = function(x, y) { return { x: x, y: y }; };
var equalPositions = function(pos1, pos2) { return pos1.x === pos2.x && pos1.y === pos2.y; };
