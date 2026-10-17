var cls = require("./lib/class"),
    _ = require("underscore"),
    Messages = require("./message"),
    Properties = require("./properties"),
    Types = require("../../shared/js/gametypes");

module.exports = Mob = Character.extend({
    init: function(id, kind, x, y, editorData) {
        this.editorData = editorData || null;
        this._super(id, "mob", kind, x, y);

        this.updateHitPoints();
        this.spawningX = x;
        this.spawningY = y;
        this.armorLevel = this.editorData && Number.isFinite(Number(this.editorData.armorLevel)) ? Number(this.editorData.armorLevel) : Properties.getArmorLevel(this.kind);
        this.weaponLevel = this.editorData && Number.isFinite(Number(this.editorData.weaponLevel)) ? Number(this.editorData.weaponLevel) : Properties.getWeaponLevel(this.kind);
        this.aggroDistance = this.editorData && Number.isFinite(Number(this.editorData.aggroDistance)) ? Number(this.editorData.aggroDistance) : 50;
        this.respawnDelay = this.editorData && Number.isFinite(Number(this.editorData.respawnMs)) ? Number(this.editorData.respawnMs) : 30000;
        this.hatelist = [];
        this.respawnTimeout = null;
        this.returnTimeout = null;
        this.isDead = false;
    },

    getState: function() {
        var state = this._super();
        if(this.editorData) {
            if(!this.target) {
                state.push(null);
            }
            state.push(this.editorData);
        }
        return state;
    },

    destroy: function() {
        this.isDead = true;
        this.hatelist = [];
        this.clearTarget();
        this.updateHitPoints();
        this.resetPosition();
        this.handleRespawn();
    },

    receiveDamage: function(points, playerId) {
        this.hitPoints -= points;
    },

    hates: function(playerId) {
        return _.any(this.hatelist, function(obj) {
            return obj.id === playerId;
        });
    },

    increaseHateFor: function(playerId, points) {
        if(this.hates(playerId)) {
            _.detect(this.hatelist, function(obj) {
                return obj.id === playerId;
            }).hate += points;
        } else {
            this.hatelist.push({ id: playerId, hate: points });
        }

        if(this.returnTimeout) {
            clearTimeout(this.returnTimeout);
            this.returnTimeout = null;
        }
    },

    getHatedPlayerId: function(hateRank) {
        var i, playerId,
            sorted = _.sortBy(this.hatelist, function(obj) { return obj.hate; }),
            size = _.size(this.hatelist);

        if(hateRank && hateRank <= size) {
            i = size - hateRank;
        } else {
            i = size - 1;
        }
        if(sorted && sorted[i]) {
            playerId = sorted[i].id;
        }
        return playerId;
    },

    forgetPlayer: function(playerId, duration) {
        this.hatelist = _.reject(this.hatelist, function(obj) { return obj.id === playerId; });
        if(this.hatelist.length === 0) {
            this.returnToSpawningPosition(duration);
        }
    },

    forgetEveryone: function() {
        this.hatelist = [];
        this.returnToSpawningPosition(1);
    },

    drop: function(item) {
        if(item) {
            return new Messages.Drop(this, item);
        }
    },

    handleRespawn: function() {
        var delay = this.respawnDelay,
            self = this;

        if(this.area && this.area instanceof MobArea) {
            this.area.respawnMob(this, delay);
        } else {
            if(this.area && this.area instanceof ChestArea) {
                this.area.removeFromArea(this);
            }
            setTimeout(function() {
                if(self.respawn_callback) {
                    self.respawn_callback();
                }
            }, delay);
        }
    },

    onRespawn: function(callback) {
        this.respawn_callback = callback;
    },

    resetPosition: function() {
        this.setPosition(this.spawningX, this.spawningY);
    },

    returnToSpawningPosition: function(waitDuration) {
        var self = this,
            delay = waitDuration || 4000;

        this.clearTarget();
        this.returnTimeout = setTimeout(function() {
            self.resetPosition();
            self.move(self.x, self.y);
        }, delay);
    },

    onMove: function(callback) {
        this.move_callback = callback;
    },

    move: function(x, y) {
        this.setPosition(x, y);
        if(this.move_callback) {
            this.move_callback(this);
        }
    },

    updateHitPoints: function() {
        var hp = this.editorData && Number.isFinite(Number(this.editorData.hitPoints)) ? Number(this.editorData.hitPoints) : Properties.getHitPoints(this.kind);
        this.resetHitPoints(hp);
    },

    distanceToSpawningPoint: function(x, y) {
        return Utils.distanceTo(x, y, this.spawningX, this.spawningY);
    }
});
