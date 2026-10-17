
var cls = require("./lib/class"),
    _ = require("underscore"),
    Messages = require("./message"),
    Utils = require("./utils"),
    Properties = require("./properties"),
    Formulas = require("./formulas"),
    check = require("./format").check,
    Types = require("../../shared/js/gametypes");

module.exports = Player = Character.extend({
    init: function(connection, worldServer) {
        var self = this;
        
        this.server = worldServer;
        this.connection = connection;
        this.persistence = connection.playerPersistenceService || null;

        this._super(this.connection.id, "player", Types.Entities.WARRIOR, 0, 0, "");

        this.hasEnteredGame = false;
        this.handshakePending = false;
        this.isDead = false;
        this.haters = {};
        this.lastCheckpoint = null;
        this.lastCheckpointId = null;
        this.formatChecker = new FormatChecker();
        this.disconnectTimeout = null;
        this.accountUserId = null;
        this.characterId = null;
        
        this.connection.listen(function(message) {
            var action = parseInt(message[0]);
            
            log.debug("Received: "+message);
            if(!check(message)) {
                self.connection.close("Invalid "+Types.getMessageTypeAsString(action)+" message format: "+message);
                return;
            }
            
            if(!self.hasEnteredGame && action !== Types.Messages.HELLO) {
                self.connection.close("Invalid handshake message: "+message);
                return;
            }
            if((self.hasEnteredGame || self.handshakePending) && !self.isDead && action === Types.Messages.HELLO) {
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
            else if(action === Types.Messages.WHO) {
                message.shift();
                self.server.pushSpawnsToPlayer(self, message);
            }
            else if(action === Types.Messages.ZONE) {
                self.zone_callback();
            }
            else if(action === Types.Messages.CHAT) {
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
                    
                    if(self.server.isValidPosition(x, y)) {
                        self.setPosition(x, y);
                        self.clearTarget();
                        
                        self.broadcast(new Messages.Move(self));
                        self.move_callback(self.x, self.y);
                    }
                }
            }
            else if(action === Types.Messages.LOOTMOVE) {
                if(self.lootmove_callback) {
                    self.setPosition(message[1], message[2]);
                    
                    var item = self.server.getEntityById(message[3]);
                    if(item) {
                        self.clearTarget();

                        self.broadcast(new Messages.LootMove(self, item));
                        self.lootmove_callback(self.x, self.y);
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
                
                if(mob) {
                    self.setTarget(mob);
                    self.server.broadcastAttacker(self);
                }
            }
            else if(action === Types.Messages.HIT) {
                var mob = self.server.getEntityById(message[1]);
                if(mob) {
                    var dmg = Formulas.dmg(self.weaponLevel, mob.armorLevel);
                    
                    if(dmg > 0) {
                        mob.receiveDamage(dmg, self.id);
                        self.server.handleMobHate(mob.id, self.id, dmg);
                        self.server.handleHurtEntity(mob, self, dmg);
                    }
                }
            }
            else if(action === Types.Messages.HURT) {
                var mob = self.server.getEntityById(message[1]);
                if(mob && self.hitPoints > 0) {
                    self.hitPoints -= Formulas.dmg(mob.weaponLevel, self.armorLevel);
                    self.server.handleHurtEntity(self);
                    
                    if(self.hitPoints <= 0) {
                        self.isDead = true;
                        if(self.firepotionTimeout) {
                            clearTimeout(self.firepotionTimeout);
                        }
                    }
                }
            }
            else if(action === Types.Messages.LOOT) {
                var item = self.server.getEntityById(message[1]);
                
                if(item) {
                    var kind = item.kind;
                    
                    if(Types.isItem(kind)) {
                        self.broadcast(item.despawn());
                        self.server.removeEntity(item);
                        
                        if(kind === Types.Entities.FIREPOTION) {
                            self.updateHitPoints();
                            self.broadcast(self.equip(Types.Entities.FIREFOX));
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
                
                if(self.server.isValidPosition(x, y)) {
                    self.setPosition(x, y);
                    self.clearTarget();
                    
                    self.broadcast(new Messages.Teleport(self));
                    
                    self.server.handlePlayerVanish(self);
                    self.server.pushRelevantEntityListTo(self);
                }
            }
            else if(action === Types.Messages.OPEN) {
                var chest = self.server.getEntityById(message[1]);
                if(chest && chest instanceof Chest) {
                    self.server.handleOpenedChest(chest, self);
                }
            }
            else if(action === Types.Messages.CHECK) {
                var checkpoint = self.server.map.getCheckpoint(message[1]);
                if(checkpoint && self.isInsideCheckpoint(checkpoint)) {
                    self.lastCheckpoint = checkpoint;
                    self.lastCheckpointId = checkpoint.id;
                    self.persistCheckpoint(checkpoint.id);
                }
            }
            else {
                if(self.message_callback) {
                    self.message_callback(message);
                }
            }
        });
        
        this.connection.onClose(function() {
            if(self.firepotionTimeout) {
                clearTimeout(self.firepotionTimeout);
            }
            clearTimeout(self.disconnectTimeout);
            self.persistTouch();
            if(self.exit_callback) {
                self.exit_callback();
            }
        });
        
        this.connection.sendUTF8("go");
    },

    handleHello: async function(message) {
        var auth = this.connection.authContext || {type: 'guest'},
            authService = this.connection.playerAuthService,
            name,
            armor,
            weapon;

        if(auth.type === 'account' && auth.character) {
            name = String(auth.character.name || '').substr(0, 15);
            this.accountUserId = auth.user ? auth.user.id : null;
            this.characterId = auth.character.id || null;
            this.lastCheckpointId = auth.character.lastCheckpointId === null || auth.character.lastCheckpointId === undefined ? null : Number(auth.character.lastCheckpointId);
            armor = Number(auth.character.armorKind);
            weapon = Number(auth.character.weaponKind);
            if(!Types.isArmor(armor)) { armor = Types.Entities.CLOTHARMOR; }
            if(!Types.isWeapon(weapon)) { weapon = Types.Entities.SWORD1; }
            if(this.lastCheckpointId !== null) {
                this.lastCheckpoint = this.server.map.getCheckpoint(this.lastCheckpointId) || null;
                if(!this.lastCheckpoint) {
                    this.lastCheckpointId = null;
                    this.persistClearCheckpoint();
                }
            }
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

        this.name = name;
        this.kind = Types.Entities.WARRIOR;
        this.equipArmor(armor);
        this.equipWeapon(weapon);
        this.orientation = Utils.randomOrientation();
        this.updateHitPoints();
        this.updatePosition();
        
        this.server.addPlayer(this);
        this.server.enter_callback(this);
        this.send([Types.Messages.WELCOME, this.id, this.name, this.x, this.y, this.hitPoints]);
        this.hasEnteredGame = true;
        this.handshakePending = false;
        this.isDead = false;
        if(auth.type === 'account') {
            this.send(new Messages.EquipItem(this, this.armor).serialize());
            this.send(new Messages.EquipItem(this, this.weapon).serialize());
        }
        this.persistTouch();
    },

    isInsideCheckpoint: function(checkpoint) {
        if(!checkpoint) { return false; }
        return this.x >= checkpoint.x && this.x < checkpoint.x + checkpoint.width &&
               this.y >= checkpoint.y && this.y < checkpoint.y + checkpoint.height;
    },

    persistEquipment: function() {
        var self = this;
        if(!this.persistence || !this.characterId) { return; }
        Promise.resolve(this.persistence.saveEquipment(this.characterId, this.weapon, this.armor)).catch(function(error) {
            log.error('Could not persist equipment for ' + self.name + ': ' + error.message);
        });
    },

    persistCheckpoint: function(checkpointId) {
        var self = this;
        if(!this.persistence || !this.characterId) { return; }
        Promise.resolve(this.persistence.saveCheckpoint(this.characterId, checkpointId)).catch(function(error) {
            log.error('Could not persist checkpoint for ' + self.name + ': ' + error.message);
        });
    },

    persistClearCheckpoint: function() {
        var self = this;
        if(!this.persistence || !this.characterId) { return; }
        Promise.resolve(this.persistence.clearCheckpoint(this.characterId)).catch(function(error) {
            log.error('Could not clear checkpoint for ' + self.name + ': ' + error.message);
        });
    },

    persistTouch: function() {
        var self = this;
        if(!this.persistence || !this.characterId) { return; }
        Promise.resolve(this.persistence.touch(this.characterId)).catch(function(error) {
            log.error('Could not update last seen for ' + self.name + ': ' + error.message);
        });
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
                this.updateHitPoints();
                this.send(new Messages.HitPoints(this.maxHitPoints).serialize());
                this.persistEquipment();
            } else if(Types.isWeapon(item.kind)) {
                this.equipWeapon(item.kind);
                this.persistEquipment();
            }
        }
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