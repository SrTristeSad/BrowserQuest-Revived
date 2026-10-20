
var cls = require("./lib/class"),
    _ = require("underscore"),
    Messages = require("./message"),
    Utils = require("./utils"),
    Properties = require("./properties"),
    Formulas = require("./formulas"),
    check = require("./format").check,
    MissionService = require("../story/mission-service"),
    CombatGuard = require("./combat-guard"),
    MovementGuard = require("./movement-guard"),
    RegenPolicy = require("./regen-policy"),
    Types = require("../../shared/js/gametypes");

module.exports = Player = Character.extend({
    init: function(connection, worldServer) {
        var self = this;
        
        this.server = worldServer;
        this.connection = connection;
        this.characterPersistence = connection.characterPersistence || null;
        this.storyRuntime = connection.storyRuntime || null;
        this.storyProgress = connection.storyProgress || null;

        this._super(this.connection.id, "player", Types.Entities.WARRIOR, 0, 0, "");

        this.hasEnteredGame = false;
        this.handshakePending = false;
        this.connectionClosed = false;
        this.isDead = false;
        // Ignore damage during initial spawn and immediately after a revive.
        this.spawnProtectedUntil = 0;
        this.lastMobHurtTimes = Object.create(null);
        this.lastDamagedAt = 0;
        this.lastRegenAt = 0;
        this.haters = {};
        this.lastCheckpoint = null;
        this.formatChecker = new FormatChecker();
        this.disconnectTimeout = null;
        this.accountUserId = null;
        this.characterId = null;
        this.storyState = [];
        this.storyInteractionNpcId = null;
        this.storyOperationChain = Promise.resolve();
        this.mutedUntil = 0;
        this.muteReason = '';
        
        this.connection.listen(function(message) {
            var action = Array.isArray(message) ? message[0] : undefined;
            
            log.debug("Received: "+message);
            if(!check(message)) {
                self.connection.close("Invalid "+Types.getMessageTypeAsString(action)+" message format: "+message);
                return;
            }
            
            if(!self.hasEnteredGame && action !== Types.Messages.HELLO) {
                self.connection.close("Invalid handshake message: "+message);
                return;
            }
            if((self.handshakePending || (self.hasEnteredGame && !self.isDead)) && action === Types.Messages.HELLO) {
                self.connection.close("Cannot initiate handshake twice: "+message);
                return;
            }
            
            self.resetTimeout();
            
            if(action === Types.Messages.HELLO) {
                self.handshakePending = true;
                self.handleHello(message).catch(function(error) {
                    log.error('Player HELLO failed: ' + (error && error.stack ? error.stack : error));
                    self.connection.close('Falha ao validar o personagem.');
                });
                return;
            }
            else if(self.isDead || self.handshakePending) { return; }
            else if(action === Types.Messages.WHO) {
                message.shift();
                self.server.pushSpawnsToPlayer(self, message);
            }
            else if(action === Types.Messages.ZONE) {
                self.zone_callback();
            }
            else if(action === Types.Messages.CHAT) {
                if(self.isMuted()) {
                    var remainingMinutes = Math.max(1, Math.ceil((self.mutedUntil - Date.now()) / 60000));
                    self.send([Types.Messages.ANNOUNCEMENT, 'Você está silenciado. Tempo restante: ' + remainingMinutes + ' min.']);
                    return;
                }
                var msg = Utils.sanitize(message[1]);
                
                if(msg && msg !== "") {
                    msg = msg.substr(0, 60);
                    self.broadcastToZone(new Messages.Chat(self, msg), false);
                }
            }
            else if(action === Types.Messages.MOVE) {
                if(self.move_callback) {
                    var x = message[1],
                        y = message[2];
                    
                    if(x === self.x && y === self.y) { return; }
                    if(MovementGuard.acceptStep(self.server, self, x, y)) {
                        self.setPosition(x, y);
                        self.clearTarget();
                        
                        self.broadcast(new Messages.Move(self));
                        self.move_callback(self.x, self.y);
                    } else {
                        self.send(new Messages.Teleport(self).serialize());
                    }
                }
            }
            else if(action === Types.Messages.LOOTMOVE) {
                if(self.lootmove_callback && self.server.isValidPosition(message[1], message[2])) {
                    
                    var item = self.server.getEntityById(message[3]);
                    if(item && item.type === 'item') {
                        // This is only a loot intent. MOVE reports completed
                        // adjacent steps; never jump to an item's destination.
                        if(item.x !== message[1] || item.y !== message[2]) { return; }
                        self.clearTarget();

                        self.broadcast(new Messages.LootMove(self, item));
                        // No movement callback before a real step occurs.
                    }
                }
            }
            else if(action === Types.Messages.AGGRO) {
                if(self.move_callback) {
                    self.server.handleMobHate(message[1], self.id, 5);
                }
            }
            else if(action === Types.Messages.ATTACK) {
                var mob = self.server.getEntityById(message[1]);
                
                if(mob && mob.type === 'mob' && !mob.isDead && mob.hitPoints > 0) {
                    self.setTarget(mob);
                    self.server.broadcastAttacker(self);
                }
            }
            else if(action === Types.Messages.HIT) {
                var mob = self.server.getEntityById(message[1]);
                // Only the selected live target can receive a player
                // strike, and melee must be cardinal (not diagonal).
                if(mob && mob.type === 'mob' && !mob.isDead && mob.hitPoints > 0 &&
                   !self.isDead && self.hitPoints > 0 && self.target === mob.id &&
                   (!self.server.mobs || self.server.mobs[mob.id] === mob) &&
                   (!self.server.entities || self.server.entities[mob.id] === mob) &&
                   (!self.server.map || !self.server.map.isColliding ||
                    (!self.server.map.isColliding(mob.x, mob.y) &&
                     !self.server.map.isColliding(self.x, self.y))) &&
                   Math.abs(mob.x - self.x) + Math.abs(mob.y - self.y) === 1 &&
                   Date.now() >= (self.nextHitAt || 0)) {
                    self.nextHitAt = Date.now() + 450;
                    var dmg = Formulas.dmg(self.weaponLevel, mob.armorLevel);
                    
                    if(dmg > 0) {
                        mob.receiveDamage(dmg, self.id);
                        self.server.handleMobHate(mob.id, self.id, dmg);
                        self.server.handleHurtEntity(mob, self, dmg);
                    }
                }
            }
            else if(action === Types.Messages.HURT) {
                // Obsolete client animation event. Only the world server's
                // combat timer may inflict damage; forged packets cannot
                // accelerate a legitimate fight or trigger a premature hit.
                return;
            }
            else if(action === Types.Messages.LOOT) {
                var item = self.server.getEntityById(message[1]);
                
                if(item && item.type === 'item' &&
                   Math.max(Math.abs(item.x - self.x), Math.abs(item.y - self.y)) <= 1) {
                    var kind = item.kind;
                    
                    if(Types.isItem(kind)) {
                        self.broadcast(item.despawn());
                        self.server.removeEntity(item);
                        self.progressStoryCollect(kind).catch(function(error) {
                            log.error('Story collect progress failed for ' + self.name + ': ' + (error && error.message ? error.message : error));
                        });
                        
                        if(kind === Types.Entities.FIREPOTION) {
                            self.updateHitPoints();
                            self.broadcast(self.equip(Types.Entities.FIREFOX));
                            if(self.firepotionTimeout) { clearTimeout(self.firepotionTimeout); }
                            self.firepotionTimeout = setTimeout(function() {
                                self.broadcast(self.equip(self.armor));
                                self.firepotionTimeout = null;
                            }, 15000);
                            self.send(new Messages.HitPoints(self.maxHitPoints).serialize());
                        } else if(Types.isHealingItem(kind)) {
                            var amount;
                            
                            switch(kind) {
                                case Types.Entities.FLASK: 
                                    amount = 40;
                                    break;
                                case Types.Entities.BURGER: 
                                    amount = 100;
                                    break;
                            }
                            
                            if(!self.hasFullHealth()) {
                                self.regenHealthBy(amount);
                                self.server.pushToPlayer(self, self.health());
                            }
                        } else if(Types.isArmor(kind) || Types.isWeapon(kind)) {
                            self.equipItem(item);
                            self.broadcast(self.equip(kind));
                        }
                    }
                }
            }
            else if(action === Types.Messages.TELEPORT) {
                var x = message[1],
                    y = message[2];
                
                if(self.server.isValidPosition(x, y) && self.server.map.canTeleportFrom &&
                   self.server.map.canTeleportFrom(self.x, self.y, x, y)) {
                    self.setPosition(x, y);
                    self.clearTarget();
                    
                    self.broadcast(new Messages.Teleport(self));
                    
                    self.server.handlePlayerVanish(self);
                    self.server.pushRelevantEntityListTo(self);
                } else {
                    self.send(new Messages.Teleport(self).serialize());
                }
            }
            else if(action === Types.Messages.OPEN) {
                var chest = self.server.getEntityById(message[1]);
                if(chest && chest instanceof Chest &&
                   Math.max(Math.abs(chest.x - self.x), Math.abs(chest.y - self.y)) <= 1) {
                    self.server.handleOpenedChest(chest, self);
                }
            }
            else if(action === Types.Messages.CHECK) {
                var checkpoint = self.server.map.getCheckpoint(message[1]);
                if(checkpoint && checkpoint.containsPosition(self.x, self.y)) {
                    self.lastCheckpoint = checkpoint;
                    self.schedulePersistence({checkpointId: checkpoint.id});
                }
            }
            else if(action === Types.Messages.NPC_INTERACT) {
                var npc = self.server.getEntityById(message[1]);
                if(npc && npc.type === 'npc') {
                    var npcDistance = Math.abs(self.x - npc.x) + Math.abs(self.y - npc.y);
                    if(npcDistance === 1 && self.npcinteract_callback) {
                        self.progressStoryTalk(npc).catch(function(error) {
                            log.error('Story talk progress failed for ' + self.name + ': ' + (error && error.message ? error.message : error));
                        });
                        self.storyInteractionNpcId = npc.id;
                        try {
                            self.npcinteract_callback(npc);
                        } finally {
                            self.storyInteractionNpcId = null;
                        }
                    }
                }
            }
            else {
                if(self.message_callback) {
                    self.message_callback(message);
                }
            }
        });
        
        this.connection.onClose(function() {
            self.connectionClosed = true;
            if(self.firepotionTimeout) {
                clearTimeout(self.firepotionTimeout);
            }
            clearTimeout(self.disconnectTimeout);
            self.flushPersistence();
            if(self.exit_callback) {
                self.exit_callback();
            }
        });
        
        this.connection.sendUTF8("go");
    },

    handleHello: async function(message) {
        var auth = this.connection.authContext || {type: 'guest'},
            authService = this.connection.playerAuthService,
            persisted = null,
            name,
            armor,
            weapon,
            checkpoint;

        if(auth.type === 'account' && auth.character) {
            name = String(auth.character.name || '').substr(0, 15);
            if(auth.mute && Number(auth.mute.until) > Date.now()) {
                this.setMute(Number(auth.mute.until), auth.mute.reason);
            }
            this.accountUserId = auth.user ? auth.user.id : null;
            this.characterId = auth.character.id || null;
            if(this.storyProgress && this.characterId) {
                try {
                    this.storyState = await this.storyProgress.list(this.characterId);
                    if(this.storyState.length) {
                        log.info('Story progress loaded for character ' + this.characterId + ': ' + this.storyState.length + ' storie(s).');
                    }
                } catch(error) {
                    this.storyState = [];
                    log.error('Falha ao carregar progresso de história do personagem ' + this.characterId + ': ' + error.message);
                }
            }
            armor = Number(auth.character.armorKind);
            weapon = Number(auth.character.weaponKind);

            if(this.characterPersistence && this.characterId) {
                try {
                    persisted = await this.characterPersistence.load(this.characterId);
                } catch(error) {
                    log.error('Falha ao carregar estado persistente do personagem ' + this.characterId + ': ' + error.message);
                }
            }
            if(persisted) {
                if(persisted.armorKind !== null) { armor = persisted.armorKind; }
                if(persisted.weaponKind !== null) { weapon = persisted.weaponKind; }
                if(persisted.checkpointId !== null && this.server.map) {
                    checkpoint = this.server.map.getCheckpoint(persisted.checkpointId);
                    if(checkpoint) { this.lastCheckpoint = checkpoint; }
                }
            }

            if(!Types.isArmor(armor)) { armor = Types.Entities.CLOTHARMOR; }
            if(!Types.isWeapon(weapon)) { weapon = Types.Entities.SWORD1; }
        } else {
            name = Utils.sanitize(message[1]);
            name = (name === "") ? "lorem ipsum" : name.substr(0, 15);
            if(authService && await authService.isCharacterNameReserved(name)) {
                this.connection.close('Este nome pertence a uma conta registrada.');
                return;
            }
            armor = message[2];
            weapon = message[3];
        }

        if(this.connectionClosed) { return; }
        if(!Types.isArmor(armor)) { armor = Types.Entities.CLOTHARMOR; }
        if(!Types.isWeapon(weapon)) { weapon = Types.Entities.SWORD1; }

        // A respawn uses the same socket/player. Discard old mob targets before
        // relocating; otherwise attackers can hit the revived character instantly.
        if(this.hasEnteredGame && this.isDead) {
            this.server.handlePlayerVanish(this);
            this.destroy();
        }

        this.name = name;
        this.kind = Types.Entities.WARRIOR;
        this.equipArmor(armor);
        this.equipWeapon(weapon);
        this.orientation = Utils.randomOrientation();
        this.updateHitPoints();
        this.updatePosition();
        this.spawnProtectedUntil = Date.now() + 10000;
        this.lastMobHurtTimes = Object.create(null);
        this.lastDamagedAt = 0;
        this.lastRegenAt = 0;
        this.nextHitAt = 0;
        this.lastStepAt = Date.now();
        this.stepCreditMs = MovementGuard.STEP_MS;
        
        this.server.addPlayer(this);
        this.server.enter_callback(this);
        this.send([Types.Messages.WELCOME, this.id, this.name, this.x, this.y, this.hitPoints]);
        if(auth.type === 'account') {
            // WELCOME stays backward-compatible; existing EQUIP messages synchronize
            // the account's authoritative PostgreSQL equipment to this client.
            this.send(this.equip(this.armor).serialize());
            this.send(this.equip(this.weapon).serialize());
        }
        this.hasEnteredGame = true;
        this.handshakePending = false;
        this.isDead = false;
    },
    
    destroy: function() {
        var self = this;
        
        this.forEachAttacker(function(mob) {
            mob.clearTarget();
        });
        this.attackers = {};
        
        this.forEachHater(function(mob) {
            mob.forgetPlayer(self.id);
        });
        this.haters = {};
    },
    
    getState: function() {
        var basestate = this._getBaseState(),
            state = [this.name, this.orientation, this.armor, this.weapon];

        if(this.target) {
            state.push(this.target);
        }
        
        return basestate.concat(state);
    },
    
    setMute: function(until, reason) {
        this.mutedUntil = Math.max(Date.now(), Number(until) || 0);
        this.muteReason = String(reason || '').slice(0, 120);
    },

    isMuted: function() {
        if(this.mutedUntil > Date.now()) { return true; }
        this.mutedUntil = 0;
        this.muteReason = '';
        return false;
    },

    send: function(message) {
        this.connection.send(message);
    },
    
    broadcast: function(message, ignoreSelf) {
        if(this.broadcast_callback) {
            this.broadcast_callback(message, ignoreSelf === undefined ? true : ignoreSelf);
        }
    },
    
    broadcastToZone: function(message, ignoreSelf) {
        if(this.broadcastzone_callback) {
            this.broadcastzone_callback(message, ignoreSelf === undefined ? true : ignoreSelf);
        }
    },
    
    onExit: function(callback) {
        this.exit_callback = callback;
    },
    
    onMove: function(callback) {
        this.move_callback = callback;
    },
    
    onLootMove: function(callback) {
        this.lootmove_callback = callback;
    },
    
    onZone: function(callback) {
        this.zone_callback = callback;
    },
    
    onOrient: function(callback) {
        this.orient_callback = callback;
    },
    
    onMessage: function(callback) {
        this.message_callback = callback;
    },

    onNpcInteract: function(callback) {
        this.npcinteract_callback = callback;
    },
    
    onBroadcast: function(callback) {
        this.broadcast_callback = callback;
    },
    
    onBroadcastToZone: function(callback) {
        this.broadcastzone_callback = callback;
    },
    
    equip: function(item) {
        return new Messages.EquipItem(this, item);
    },
    
    addHater: function(mob) {
        if(mob) {
            if(!(mob.id in this.haters)) {
                this.haters[mob.id] = mob;
            }
        }
    },
    
    removeHater: function(mob) {
        if(mob && mob.id in this.haters) {
            delete this.haters[mob.id];
        }
    },
    
    forEachHater: function(callback) {
        _.each(this.haters, function(mob) {
            callback(mob);
        });
    },
    
    equipArmor: function(kind) {
        this.armor = kind;
        this.armorLevel = Properties.getArmorLevel(kind);
    },
    
    equipWeapon: function(kind) {
        this.weapon = kind;
        this.weaponLevel = Properties.getWeaponLevel(kind);
    },
    
    equipItem: function(item) {
        if(item) {
            log.debug(this.name + " equips " + Types.getKindAsString(item.kind));
            
            if(Types.isArmor(item.kind)) {
                this.equipArmor(item.kind);
                this.schedulePersistence({armorKind: item.kind});
                this.updateHitPoints();
                this.send(new Messages.HitPoints(this.maxHitPoints).serialize());
            } else if(Types.isWeapon(item.kind)) {
                this.equipWeapon(item.kind);
                this.schedulePersistence({weaponKind: item.kind});
            }
        }
    },

    queueStoryOperation: function(operation) {
        var previous = this.storyOperationChain || Promise.resolve(),
            run = previous.catch(function() {
                return null;
            }).then(operation);

        this.storyOperationChain = run.catch(function() {
            return null;
        });
        return run;
    },

    progressStoryTalk: function(npc) {
        var self = this,
            targetProfileId = npc && npc.editorData ? String(npc.editorData.id || '').trim() : '';

        if(!targetProfileId) {
            return Promise.resolve({changed: false, updates: []});
        }

        return this.queueStoryOperation(function() {
            return MissionService.progressTalkObjectives({
                runtime: self.storyRuntime,
                progressStore: self.storyProgress,
                characterId: self.characterId,
                targetProfileId: targetProfileId,
                states: self.storyState
            }).then(function(result) {
                (result.updates || []).forEach(function(update) {
                    self.storyState = MissionService.upsertStoryState(self.storyState, update.state);
                });
                return result;
            });
        });
    },

    progressStoryCollect: function(kind) {
        var self = this,
            targetKind = String(Types.getKindAsString(kind) || '').trim();

        if(!Types.isItem(kind) || !targetKind) {
            return Promise.resolve({changed: false, updates: []});
        }

        return this.queueStoryOperation(function() {
            return MissionService.progressCollectObjectives({
                runtime: self.storyRuntime,
                progressStore: self.storyProgress,
                characterId: self.characterId,
                targetKind: targetKind,
                states: self.storyState
            }).then(function(result) {
                (result.updates || []).forEach(function(update) {
                    self.storyState = MissionService.upsertStoryState(self.storyState, update.state);
                });
                return result;
            });
        });
    },

    startStoryMission: function(storyId, missionId) {
        var self = this,
            sourceNpcId = this.storyInteractionNpcId;

        return this.queueStoryOperation(function() {
            return MissionService.startMission({
                runtime: self.storyRuntime,
                progressStore: self.storyProgress,
                characterId: self.characterId,
                storyId: storyId,
                missionId: missionId,
                states: self.storyState
            }).then(function(result) {
                self.storyState = MissionService.upsertStoryState(self.storyState, result.state);

                if(result && result.changed && sourceNpcId && result.mission && result.mission.mission) {
                    var dialogue = Array.isArray(result.mission.mission.introDialogue) ? result.mission.mission.introDialogue : [],
                        lines = dialogue.map(function(line) {
                            return Utils.sanitize(line && line.text || '');
                        }).filter(function(text) {
                            return text;
                        });

                    if(lines.length) {
                        self.send([Types.Messages.STORY_DIALOGUE, sourceNpcId, lines]);
                    }
                }

                return result;
            });
        });
    },

    schedulePersistence: function(patch) {
        if(this.characterPersistence && this.characterId) {
            this.characterPersistence.schedule(this.characterId, patch);
        }
    },

    flushPersistence: function() {
        if(this.characterPersistence && this.characterId) {
            return this.characterPersistence.flush(this.characterId).catch(function(error) {
                log.error('Falha no flush do personagem: ' + error.message);
                return false;
            });
        }
        return Promise.resolve(false);
    },
    
    // Server-owned damage path shared by periodic mob attacks and legacy
    // client HURT. The browser's animations must not control player health.
    applyMobHit: function(mob, now) {
        now = Number.isFinite(now) ? now : Date.now();
        if(!CombatGuard.canMobDamagePlayer(this.server, mob, this, now)) {
            return false;
        }
        var damage = Formulas.dmg(mob.weaponLevel, this.armorLevel);
        if(!Number.isFinite(damage) || damage <= 0) { return false; }
        this.lastMobHurtTimes[mob.id] = now;
        // Opt-in diagnostics for investigating invisible/unsynced damage.
        // Disabled by default to avoid flooding production logs.
        if(process.env.BQ_COMBAT_DIAGNOSTICS === '1') {
            log.info('[combat] attacker=' + mob.id +
                ' at=' + mob.x + ',' + mob.y +
                ' player=' + this.id + ' at=' + this.x + ',' + this.y +
                ' damage=' + damage + ' hp-before=' + this.hitPoints);
        }
        RegenPolicy.noteDamage(this, now);
        this.hitPoints = Math.max(0, this.hitPoints - damage);
        if(this.hitPoints <= 0) {
            this.isDead = true;
            if(this.firepotionTimeout) { clearTimeout(this.firepotionTimeout); }
        }
        this.server.handleHurtEntity(this);
        return true;
    },

    updateHitPoints: function() {
        this.resetHitPoints(Formulas.hp(this.armorLevel));
    },
    
    updatePosition: function() {
        if(this.requestpos_callback) {
            var pos = this.requestpos_callback();
            this.setPosition(pos.x, pos.y);
        }
    },
    
    onRequestPosition: function(callback) {
        this.requestpos_callback = callback;
    },
    
    resetTimeout: function() {
        clearTimeout(this.disconnectTimeout);
        this.disconnectTimeout = setTimeout(this.timeout.bind(this), 1000 * 60 * 15);
    },
    
    timeout: function() {
        this.connection.sendUTF8("timeout");
        this.connection.close("Player was idle for too long");
    }
});
