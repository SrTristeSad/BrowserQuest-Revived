var Area = require('./area'),
    _ = require('underscore'),
    Utils = require('./utils'),
    Types = require("../../shared/js/gametypes"),
    Entity = require('./entity'),
    Character = require('./character'),
    Mob = require('./mob'),
    DayCycle = require('../../shared/js/daycycle'),
    MobBudget = require('./mob-budget');

module.exports = MobArea = Area.extend({
    init: function(id, nb, kind, x, y, width, height, world, editorData, period) {
        this._super(id, x, y, width, height, world);
        this.nb = nb;
        this.kind = kind;
        this.period = period === 'day' || period === 'night' ? period : 'always';
        this.mobSerial = 0;
        this.editorData = editorData || null;
        this.respawns = [];
        this.setNumberOfEntities(this.nb);
    },

    // A map can place original roaming areas directly over beginner checkpoints.
    // If no eligible tiles remain, keep that area empty rather than spawning
    // enemies on the player (or spinning forever searching for a valid tile).
    isActive: function() {
        return DayCycle.isPeriodActive(this.period, Date.now(), this.world.map.dayNight);
    },

    // Set inactive area mobs aside when the time of day changes, and preserve
    // original mob definitions. No defeated mob is revived by changing phases.
    syncPeriod: function() {
        var self = this;
        if(!this.isActive()) {
            if(this.entities.length) {
                var old = this.entities.slice();
                this.entities.length = 0;
                old.forEach(function(mob) {
                    if(!mob.isDead && mob.id in self.world.mobs) {
                        self.world.despawn(mob);
                    }
                });
            }
            return;
        }
        this.spawnMobs();
    },

    spawnMobs: function() {
        if(!this.isActive()) { return; }
        var remaining = Math.max(0, this.nb - this.entities.length);
        for(var i = 0; i < remaining; i += 1) {
            var mob = this._createMobInsideArea();
            if(!mob) { break; }
            this.addToArea(mob);
        }
    },

    _getSafeSpawnPosition: function() {
        var positions = [], x, y, world = this.world, map = world.map;
        for(y = this.y; y < this.y + this.height; y += 1) {
            for(x = this.x; x < this.x + this.width; x += 1) {
                if(MobBudget.canSpawn(world, x, y)) {
                    positions.push({x:x, y:y});
                }
            }
        }
        return positions.length ? positions[Math.floor(Math.random() * positions.length)] : null;
    },

    _createMobInsideArea: function() {
        var k = Types.getKindFromString(this.kind),
            pos = this.isActive() ? this._getSafeSpawnPosition() : null;
        if(!pos) { return null; }
        var mob = new Mob('1' + this.id + '' + k + '' + this.mobSerial++, k, pos.x, pos.y, this.editorData);

        mob.onMove(this.world.onMobMoveCallback.bind(this.world));
        return mob;
    },

    respawnMob: function(mob, delay) {
        var self = this;
        this.removeFromArea(mob);

        setTimeout(function() {
            if(!self.isActive() || self.entities.length >= self.nb) { return; }
            var pos = self._getSafeSpawnPosition();
            if(!pos) {
                // Retry later rather than spawning enemies on players / in
                // crowded scenes. Timers are bounded to one per defeated mob.
                self.respawnMobLater(mob);
                return;
            }
            mob.x = pos.x;
            mob.y = pos.y;
            mob.isDead = false;
            self.addToArea(mob);

        }, delay);
    },

    respawnMobLater: function(mob) {
        var self = this;
        setTimeout(function() {
            if(!self.isActive() || self.entities.length >= self.nb) { return; }
            var pos = self._getSafeSpawnPosition();
            if(!pos) { self.respawnMobLater(mob); return; }
            mob.x = pos.x;
            mob.y = pos.y;
            mob.isDead = false;
            self.addToArea(mob);

        }, 5000);
    },

    initRoaming: function(mob) {
        var self = this;
        setInterval(function() {
            _.each(self.entities, function(entity) {
                var canRoam = (Utils.random(20) === 1), pos;
                if(canRoam && !entity.hasTarget() && !entity.isDead) {
                    pos = self._getRandomPositionInsideArea();
                    if(pos) { entity.move(pos.x, pos.y); }
                }
            });
        }, 500);
    },

    createReward: function() {
        var pos = this._getRandomPositionInsideArea();
        return pos ? { x: pos.x, y: pos.y, kind: Types.Entities.CHEST } : null;
    }
});
