var Area = require('./area'),
    _ = require('underscore'),
    Types = require("../../shared/js/gametypes");

module.exports = MobArea = Area.extend({
    init: function(id, nb, kind, x, y, width, height, world, editorData) {
        this._super(id, x, y, width, height, world);
        this.nb = nb;
        this.kind = kind;
        this.editorData = editorData || null;
        this.respawns = [];
        this.setNumberOfEntities(this.nb);
    },

    // A map can place original roaming areas directly over beginner checkpoints.
    // If no eligible tiles remain, keep that area empty rather than spawning
    // enemies on the player (or spinning forever searching for a valid tile).
    spawnMobs: function() {
        for(var i = 0; i < this.nb; i += 1) {
            var mob = this._createMobInsideArea();
            if(!mob) { break; }
            this.addToArea(mob);
        }
        this.setNumberOfEntities(this.entities.length);
    },

    _getSafeSpawnPosition: function() {
        var positions = [], x, y, world = this.world, map = world.map;
        for(y = this.y; y < this.y + this.height; y += 1) {
            for(x = this.x; x < this.x + this.width; x += 1) {
                if(world.isValidPosition(x, y) &&
                    !(map && map.isProtectedSpawnTile && map.isProtectedSpawnTile(x, y))) {
                    positions.push({x:x, y:y});
                }
            }
        }
        return positions.length ? positions[Math.floor(Math.random() * positions.length)] : null;
    },

    _createMobInsideArea: function() {
        var k = Types.getKindFromString(this.kind),
            pos = this._getSafeSpawnPosition();
        if(!pos) { return null; }
        var mob = new Mob('1' + this.id + '' + k + '' + this.entities.length, k, pos.x, pos.y, this.editorData);

        mob.onMove(this.world.onMobMoveCallback.bind(this.world));
        return mob;
    },

    respawnMob: function(mob, delay) {
        var self = this;
        this.removeFromArea(mob);

        setTimeout(function() {
            var pos = self._getSafeSpawnPosition();
            if(!pos) { return; }
            mob.x = pos.x;
            mob.y = pos.y;
            mob.isDead = false;
            self.addToArea(mob);
            self.world.addMob(mob);
        }, delay);
    },

    initRoaming: function(mob) {
        var self = this;
        setInterval(function() {
            _.each(self.entities, function(entity) {
                var canRoam = (Utils.random(20) === 1), pos;
                if(canRoam && !entity.hasTarget() && !entity.isDead) {
                    pos = self._getRandomPositionInsideArea();
                    entity.move(pos.x, pos.y);
                }
            });
        }, 500);
    },

    createReward: function() {
        var pos = this._getRandomPositionInsideArea();
        return { x: pos.x, y: pos.y, kind: Types.Entities.CHEST };
    }
});
