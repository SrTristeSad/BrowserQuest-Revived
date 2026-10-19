'use strict';

var Utils = require('./utils'),
    Types = require('../../shared/js/gametypes');

var PRESETS = {
    villager: {
        thinkMs: 1800,
        mode: 'wander',
        vision: 6,
        wanderRadius: 5,
        moveChance: 0.55,
        fleeFromMobs: true,
        fleeBelowHp: 0,
        aggressive: false,
        leash: 8,
        followDistance: 2
    },
    merchant: {
        thinkMs: 2200,
        mode: 'wander',
        vision: 5,
        wanderRadius: 2,
        moveChance: 0.35,
        fleeFromMobs: true,
        fleeBelowHp: 0,
        aggressive: false,
        leash: 4,
        followDistance: 2
    },
    guard: {
        thinkMs: 1100,
        mode: 'patrol',
        vision: 9,
        wanderRadius: 8,
        moveChance: 0.8,
        fleeFromMobs: false,
        fleeBelowHp: 0,
        aggressive: false,
        leash: 12,
        followDistance: 2
    },
    passive: {
        thinkMs: 1600,
        mode: 'wander',
        vision: 5,
        wanderRadius: 6,
        moveChance: 0.55,
        fleeFromMobs: false,
        fleeBelowHp: 0.25,
        aggressive: false,
        leash: 9,
        followDistance: 2
    },
    aggressive: {
        thinkMs: 900,
        mode: 'wander',
        vision: 8,
        wanderRadius: 7,
        moveChance: 0.7,
        fleeFromMobs: false,
        fleeBelowHp: 0,
        aggressive: true,
        leash: 12,
        followDistance: 1
    },
    coward: {
        thinkMs: 950,
        mode: 'wander',
        vision: 8,
        wanderRadius: 7,
        moveChance: 0.7,
        fleeFromMobs: false,
        fleeBelowHp: 0.4,
        aggressive: true,
        leash: 10,
        followDistance: 1
    },
    territorial: {
        thinkMs: 1000,
        mode: 'wander',
        vision: 7,
        wanderRadius: 5,
        moveChance: 0.65,
        fleeFromMobs: false,
        fleeBelowHp: 0.15,
        aggressive: true,
        leash: 6,
        followDistance: 1
    },
    companion: {
        thinkMs: 1000,
        mode: 'follow',
        vision: 12,
        wanderRadius: 4,
        moveChance: 0.8,
        fleeFromMobs: true,
        fleeBelowHp: 0,
        aggressive: false,
        leash: 20,
        followDistance: 2
    }
};

function number(value, fallback, min, max) {
    var parsed = Number(value);
    if(!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, parsed));
}

function bool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

function clonePreset(name) {
    var preset = PRESETS[name] || PRESETS.villager;
    return Object.assign({}, preset);
}

function getKindName(entity) {
    try {
        return Types.getKindAsString(entity.kind) || '';
    } catch(error) {
        return '';
    }
}

function defaultPresetFor(entity) {
    var name = getKindName(entity);
    if(entity.type === 'mob') {
        if(name === 'rat' || name === 'bat' || name === 'crab') {
            return 'coward';
        }
        if(name === 'boss' || name === 'deathknight' || name === 'ogre') {
            return 'territorial';
        }
        return 'aggressive';
    }

    if(name === 'guard' || name === 'king') {
        return 'guard';
    }
    if(name === 'scientist' || name === 'priest' || name === 'coder') {
        return 'merchant';
    }
    return 'villager';
}

function normalizeConfig(entity, input) {
    input = input || {};
    var presetName = typeof input.preset === 'string' && PRESETS[input.preset] ? input.preset : defaultPresetFor(entity),
        config = clonePreset(presetName),
        mode = ['wander', 'patrol', 'follow'].indexOf(input.mode) >= 0 ? input.mode : config.mode,
        patrol = Array.isArray(input.patrol) ? input.patrol.slice(0, 32).map(function(point) {
            return {
                x: Math.floor(number(point && point.x, 1, 1, 10000)),
                y: Math.floor(number(point && point.y, 1, 1, 10000))
            };
        }) : [];

    config.preset = presetName;
    config.mode = mode;
    config.enabled = input.enabled !== false;
    config.thinkMs = Math.floor(number(input.thinkMs, config.thinkMs, 400, 10000));
    config.vision = Math.floor(number(input.vision, config.vision, 1, 50));
    config.wanderRadius = Math.floor(number(input.wanderRadius, config.wanderRadius, 1, 50));
    config.moveChance = number(input.moveChance, config.moveChance, 0, 1);
    config.fleeFromMobs = bool(input.fleeFromMobs, config.fleeFromMobs);
    config.fleeBelowHp = number(input.fleeBelowHp, config.fleeBelowHp, 0, 0.95);
    config.aggressive = bool(input.aggressive, config.aggressive);
    config.leash = Math.floor(number(input.leash, config.leash, 2, 100));
    config.followDistance = Math.floor(number(input.followDistance, config.followDistance, 1, 10));
    config.patrol = patrol;
    return config;
}

function distance(a, b) {
    if(!a || !b) {
        return Number.MAX_SAFE_INTEGER;
    }
    return Utils.distanceTo(a.x, a.y, b.x, b.y);
}

function Brain(entity, world, config) {
    this.entity = entity;
    this.world = world;
    this.config = normalizeConfig(entity, config);
    this.home = {x: entity.x, y: entity.y};
    this.memory = {
        lastSeenPlayerId: null,
        lastSeenAt: 0,
        lastThreatId: null,
        lastThreatAt: 0,
        lastDecision: 'idle'
    };
    this.patrolIndex = 0;
    this.timer = null;
}

Brain.prototype.start = function() {
    var self = this;
    if(!this.config.enabled || this.timer) {
        return;
    }
    var jitter = Math.floor(Math.random() * Math.min(400, this.config.thinkMs / 2));
    this.timer = setInterval(function() {
        self.tick();
    }, this.config.thinkMs + jitter);
    if(this.timer && typeof this.timer.unref === 'function') {
        this.timer.unref();
    }
};

Brain.prototype.stop = function() {
    if(this.timer) {
        clearInterval(this.timer);
        this.timer = null;
    }
};

Brain.prototype.destroy = function() {
    this.stop();
};

Brain.prototype.tick = function() {
    var entity = this.entity;
    if(!entity || entity.isDead || !this.world || !this.world.map) {
        return;
    }

    if(entity.type === 'mob') {
        this.tickMob();
    } else if(entity.type === 'npc') {
        this.tickNpc();
    }
};

Brain.prototype.tickNpc = function() {
    var threat;

    if(this.config.fleeFromMobs) {
        threat = this.findNearest('mob', this.config.vision);
        if(threat) {
            this.memory.lastThreatId = threat.id;
            this.memory.lastThreatAt = Date.now();
            this.memory.lastDecision = 'flee';
            if(this.stepAwayFrom(threat)) {
                return;
            }
        }
    }

    if(this.config.mode === 'follow') {
        var player = this.findNearest('player', this.config.vision);
        if(player) {
            this.memory.lastSeenPlayerId = player.id;
            this.memory.lastSeenAt = Date.now();
            if(distance(this.entity, player) > this.config.followDistance) {
                this.memory.lastDecision = 'follow';
                if(this.stepToward(player.x, player.y)) {
                    return;
                }
            }
        }
    }

    this.idleMovement();
};

Brain.prototype.tickMob = function() {
    var entity = this.entity,
        hpRatio = entity.maxHitPoints ? entity.hitPoints / entity.maxHitPoints : 1,
        player;

    if(this.config.fleeBelowHp > 0 && hpRatio <= this.config.fleeBelowHp) {
        player = this.findNearest('player', this.config.vision);
        if(player) {
            this.memory.lastThreatId = player.id;
            this.memory.lastThreatAt = Date.now();
            this.memory.lastDecision = 'flee';
            if(typeof this.world.clearMobAggroLink === 'function') { this.world.clearMobAggroLink(entity); }
            entity.clearTarget();
            if(this.stepAwayFrom(player)) {
                return;
            }
        }
    }

    if(distance(entity, this.home) > this.config.leash) {
        if(typeof this.world.clearMobAggroLink === 'function') { this.world.clearMobAggroLink(entity); }
        if(typeof this.world.clearMobHateLinks === 'function') { this.world.clearMobHateLinks(entity); }
        entity.clearTarget();
        if(typeof entity.forgetEveryone === 'function') {
            entity.forgetEveryone();
        } else if(entity.hatelist) {
            entity.hatelist = [];
        }
        this.memory.lastDecision = 'return-home';
        if(this.stepToward(this.home.x, this.home.y)) {
            return;
        }
    }

    if(entity.hasTarget && entity.hasTarget()) {
        var target = this.world.getEntityById(entity.target);
        if(target && !target.isDead &&
            !(target.type === 'player' && this.world.map && this.world.map.isProtectedSpawnTile &&
              this.world.map.isProtectedSpawnTile(target.x, target.y))) {
            this.memory.lastSeenPlayerId = target.id;
            this.memory.lastSeenAt = Date.now();
            this.memory.lastDecision = 'chase';
            if(distance(entity, target) > 1) {
                this.stepToward(target.x, target.y);
            }
            return;
        }
        entity.clearTarget();
    }

    if(this.config.aggressive) {
        player = this.findNearest('player', this.config.vision);
        if(player) {
            this.memory.lastSeenPlayerId = player.id;
            this.memory.lastSeenAt = Date.now();
            this.memory.lastDecision = 'acquire-target';
            if(typeof entity.hates === 'function' && !entity.hates(player.id)) {
                this.world.handleMobHate(entity.id, player.id, 1);
            } else if(!entity.hasTarget()) {
                entity.setTarget(player);
            }
            if(distance(entity, player) > 1) {
                this.stepToward(player.x, player.y);
            }
            return;
        }
    }

    this.idleMovement();
};

Brain.prototype.idleMovement = function() {
    if(Math.random() > this.config.moveChance) {
        this.memory.lastDecision = 'idle';
        return false;
    }

    if(this.config.mode === 'patrol' && this.config.patrol.length > 0) {
        var point = this.config.patrol[this.patrolIndex % this.config.patrol.length];
        if(this.entity.x === point.x && this.entity.y === point.y) {
            this.patrolIndex = (this.patrolIndex + 1) % this.config.patrol.length;
            point = this.config.patrol[this.patrolIndex];
        }
        this.memory.lastDecision = 'patrol';
        return this.stepToward(point.x, point.y);
    }

    this.memory.lastDecision = 'wander';
    return this.wander();
};

Brain.prototype.wander = function() {
    var choices = [
        {x: this.entity.x + 1, y: this.entity.y},
        {x: this.entity.x - 1, y: this.entity.y},
        {x: this.entity.x, y: this.entity.y + 1},
        {x: this.entity.x, y: this.entity.y - 1}
    ];

    choices.sort(function() { return Math.random() - 0.5; });
    for(var i = 0; i < choices.length; i += 1) {
        if(Utils.distanceTo(choices[i].x, choices[i].y, this.home.x, this.home.y) <= this.config.wanderRadius && this.tryMove(choices[i].x, choices[i].y)) {
            return true;
        }
    }
    return false;
};

Brain.prototype.stepToward = function(targetX, targetY) {
    var dx = targetX - this.entity.x,
        dy = targetY - this.entity.y,
        candidates = [];

    if(Math.abs(dx) >= Math.abs(dy)) {
        if(dx !== 0) { candidates.push({x: this.entity.x + Math.sign(dx), y: this.entity.y}); }
        if(dy !== 0) { candidates.push({x: this.entity.x, y: this.entity.y + Math.sign(dy)}); }
    } else {
        if(dy !== 0) { candidates.push({x: this.entity.x, y: this.entity.y + Math.sign(dy)}); }
        if(dx !== 0) { candidates.push({x: this.entity.x + Math.sign(dx), y: this.entity.y}); }
    }

    candidates.push(
        {x: this.entity.x + 1, y: this.entity.y},
        {x: this.entity.x - 1, y: this.entity.y},
        {x: this.entity.x, y: this.entity.y + 1},
        {x: this.entity.x, y: this.entity.y - 1}
    );

    for(var i = 0; i < candidates.length; i += 1) {
        if(this.tryMove(candidates[i].x, candidates[i].y)) {
            return true;
        }
    }
    return false;
};

Brain.prototype.stepAwayFrom = function(target) {
    var dx = this.entity.x - target.x,
        dy = this.entity.y - target.y,
        candidates = [];

    if(Math.abs(dx) >= Math.abs(dy)) {
        if(dx !== 0) { candidates.push({x: this.entity.x + Math.sign(dx), y: this.entity.y}); }
        if(dy !== 0) { candidates.push({x: this.entity.x, y: this.entity.y + Math.sign(dy)}); }
    } else {
        if(dy !== 0) { candidates.push({x: this.entity.x, y: this.entity.y + Math.sign(dy)}); }
        if(dx !== 0) { candidates.push({x: this.entity.x + Math.sign(dx), y: this.entity.y}); }
    }

    for(var i = 0; i < candidates.length; i += 1) {
        if(this.tryMove(candidates[i].x, candidates[i].y)) {
            return true;
        }
    }
    return this.wander();
};

Brain.prototype.tryMove = function(x, y) {
    if(!this.world.isValidPosition(x, y) ||
        (this.entity.type === 'mob' && this.world.map && this.world.map.isProtectedSpawnTile &&
         this.world.map.isProtectedSpawnTile(x, y))) {
        return false;
    }
    if(typeof this.world.isPositionOccupied === 'function' && this.world.isPositionOccupied(x, y, this.entity.id)) {
        return false;
    }
    if(typeof this.world.moveBrainEntity === 'function') {
        this.world.moveBrainEntity(this.entity, x, y);
    } else if(typeof this.entity.move === 'function') {
        this.entity.move(x, y);
    } else {
        this.entity.setPosition(x, y);
    }
    return true;
};

Brain.prototype.findNearest = function(type, radius) {
    var nearest = null,
        nearestDistance = radius + 1,
        entity = this.entity,
        safeMap = this.world.map;

    this.world.forEachEntity(function(candidate) {
        var d;
        if(!candidate || candidate.id === entity.id || candidate.type !== type || candidate.isDead) {
            return;
        }
        if(type === 'player' && entity.type === 'mob' && safeMap &&
            safeMap.isProtectedSpawnTile &&
            safeMap.isProtectedSpawnTile(candidate.x, candidate.y)) {
            return;
        }
        d = distance(entity, candidate);
        if(d <= radius && d < nearestDistance) {
            nearest = candidate;
            nearestDistance = d;
        }
    });
    return nearest;
};

Brain.prototype.getDebugState = function() {
    return {
        preset: this.config.preset,
        mode: this.config.mode,
        decision: this.memory.lastDecision,
        home: this.home,
        memory: Object.assign({}, this.memory)
    };
};

exports.Brain = Brain;
exports.PRESETS = PRESETS;
exports.normalizeConfig = normalizeConfig;
exports.defaultPresetFor = defaultPresetFor;
