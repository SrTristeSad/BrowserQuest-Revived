/* BrowserQuest input adapter: original pathfinding/network protocol is authoritative. */
define(function() {
    'use strict';

    // A held direction follows a short straight path. Four connected tiles
    // avoid restarting the walk animation every single tile; the existing
    // Game.onStep still reports each completed step to the server.
    var RUN_TILES = 4;
    var TOUCH_DEAD_ZONE = 16;
    var DIRECTION = {
        KeyW: [0, -1], ArrowUp: [0, -1],
        KeyS: [0, 1], ArrowDown: [0, 1],
        KeyA: [-1, 0], ArrowLeft: [-1, 0],
        KeyD: [1, 0], ArrowRight: [1, 0]
    };

    function isEditable(element) {
        while(element) {
            if(element.isContentEditable ||
                /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName || '')) {
                return true;
            }
            element = element.parentElement;
        }
        return false;
    }

    var Controls = Class.extend({
        init: function(game) {
            this.game = game;
            this.pressed = [];
            this.touchDirection = null;
            this.pointerId = null;
            this.joystick = null;
            this.thumb = null;
            this.attackButton = null;
            this.touchSurface = null;
            this.touchOrigin = null;
            this.touchDragged = false;
            this.actionPointerId = null;
            this.actionOrigin = null;
            this.autoRunActive = false;
            this.installKeyboard();
            this.installJoystick();
        },

        canMove: function() {
            var game = this.game,
                player = game.player;
            // Tutorial and achievement dialogs should not move the character.
            if(document.querySelector &&
                document.querySelector('#chatbox.active, #instructions.active, #achievements.active')) {
                return false;
            }
            return Boolean(game.started && game.ready && game.playerId !== undefined &&
                game.map && game.pathfinder && player && !player.isDead &&
                !game.isZoning());
        },

        installKeyboard: function() {
            var self = this;
            document.addEventListener('keydown', function(event) {
                var code = event.code || ('Key' + String.fromCharCode(event.which || 0));
                if(!DIRECTION[code] || isEditable(event.target) || !self.canMove()) {
                    return;
                }
                event.preventDefault();
                if(self.pressed.indexOf(code) !== -1) { return; }
                // A newly held direction takes over at the next safe tile.
                if(self.game.player.isMoving()) {
                    // Interrupt the old route at the next tile for responsive
                    // changes of direction, not mid-tile teleports.
                    self.game.player.stop();
                }
                self.pressed.push(code);
            }, true);
            document.addEventListener('keyup', function(event) {
                var code = event.code || ('Key' + String.fromCharCode(event.which || 0)),
                    index = self.pressed.indexOf(code);
                if(index !== -1) {
                    var wasActive = index === self.pressed.length - 1;
                    self.pressed.splice(index, 1);
                    if(wasActive && self.game.player && self.game.player.isMoving() &&
                       self.autoRunActive) {
                        self.game.player.stop();
                    }
                    event.preventDefault();
                }
            }, true);
            window.addEventListener('blur', function() { self.reset(true); });
            document.addEventListener('visibilitychange', function() {
                if(document.hidden) { self.reset(true); }
            });
        },

        installJoystick: function() {
            // The joystick is visual feedback; dragging the Canvas controls
            // movement. The separate attack button remains thumb-accessible.
            if(!document.createElement || !document.body) { return; }
            var base = document.createElement('div'),
                thumb = document.createElement('div');
            base.id = 'bq-joystick';
            base.setAttribute('aria-hidden', 'true');
            thumb.className = 'bq-joystick-thumb';
            base.appendChild(thumb);
            document.body.appendChild(base);
            this.joystick = base;
            this.thumb = thumb;

            var button = document.createElement('button'),
                self = this;
            button.id = 'bq-attack-button';
            button.type = 'button';
            button.textContent = 'ATQ';
            button.setAttribute('aria-label', 'Atacar inimigo adjacente');
            button.setAttribute('title', 'Atacar inimigo adjacente');
            button.addEventListener('click', function(event) {
                if(event.stopPropagation) { event.stopPropagation(); }
                if(event.preventDefault) { event.preventDefault(); }
                self.attack();
            });
            // This button stays separate from the movement Canvas and can
            // be tapped with the opposite thumb during an active gesture.
            document.body.appendChild(button);
            this.attackButton = button;
        },

        attack: function() {
            if(!this.canMove() ||
               typeof this.game.attackNearestAdjacentMob !== 'function') {
                return false;
            }
            return this.game.attackNearestAdjacentMob();
        },

        attachTouchSurface: function(surface, onTap) {
            if(!surface || !surface.addEventListener) { return; }
            var self = this;
            this.touchSurface = surface;

            function consume(event) {
                if(event.preventDefault) { event.preventDefault(); }
                if(event.stopPropagation) { event.stopPropagation(); }
            }

            function updateFromPointer(event) {
                var origin = self.touchOrigin;
                if(!origin) { return; }
                var dx = event.clientX - origin.x,
                    dy = event.clientY - origin.y,
                    distance = Math.sqrt(dx * dx + dy * dy),
                    rect = self.joystick.getBoundingClientRect(),
                    radius = Math.max(1, Math.min(rect.width, rect.height) * .28),
                    ratio = distance ? Math.min(1, radius / distance) : 0,
                    previous = self.touchDirection,
                    direction = null;
                self.thumb.style.transform = 'translate(' +
                    Math.round(dx * ratio) + 'px, ' +
                    Math.round(dy * ratio) + 'px)';
                if(distance >= TOUCH_DEAD_ZONE) {
                    self.touchDragged = true;
                    if(Math.abs(dx) >= Math.abs(dy)) {
                        direction = dx > 0 ? [1, 0] : [-1, 0];
                    } else {
                        direction = dy > 0 ? [0, 1] : [0, -1];
                    }
                }
                // A previously planned four-tile run must not keep going in
                // the old direction after the player steers or recenters.
                // Character.stop interrupts safely at the next tile boundary.
                if(previous && (!direction ||
                   previous[0] !== direction[0] || previous[1] !== direction[1]) &&
                   self.autoRunActive && self.game.player &&
                   self.game.player.isMoving()) {
                    self.game.player.stop();
                    self.autoRunActive = false;
                }
                self.touchDirection = direction;
            }

            function capture(event) {
                if(surface.setPointerCapture) {
                    surface.setPointerCapture(event.pointerId);
                }
            }

            surface.addEventListener('pointerdown', function(event) {
                if(event.pointerType !== 'touch') { return; }
                if(self.pointerId !== null) {
                    // Keep the first finger moving. A second finger may tap
                    // a mob or item without relocating the movement origin.
                    if(self.actionPointerId === null && self.canMove()) {
                        self.actionPointerId = event.pointerId;
                        self.actionOrigin = {x:event.clientX, y:event.clientY};
                        capture(event);
                    }
                    consume(event);
                    return;
                }
                if(!self.canMove()) { return; }
                self.pointerId = event.pointerId;
                self.touchOrigin = {x:event.clientX, y:event.clientY};
                self.touchDragged = false;
                self.touchDirection = null;
                self.autoRunActive = false;
                self.pressed.length = 0;
                if(self.game.player.isMoving()) { self.game.player.stop(); }
                self.joystick.style.left = event.clientX + 'px';
                self.joystick.style.top = event.clientY + 'px';
                self.joystick.classList.add('is-active');
                self.thumb.style.transform = 'translate(0px, 0px)';
                capture(event);
                consume(event);
            });

            surface.addEventListener('pointermove', function(event) {
                if(event.pointerId === self.pointerId) {
                    updateFromPointer(event);
                    consume(event);
                } else if(event.pointerId === self.actionPointerId) {
                    consume(event);
                }
            });

            function release(event, cancelled) {
                if(event.pointerId === self.pointerId) {
                    var wasTap = !cancelled && !self.touchDragged;
                    self.releaseJoystick();
                    consume(event);
                    if(wasTap && self.canMove() && typeof onTap === 'function') {
                        onTap(event);
                    }
                } else if(event.pointerId === self.actionPointerId) {
                    var origin = self.actionOrigin,
                        dx = origin ? event.clientX - origin.x : Infinity,
                        dy = origin ? event.clientY - origin.y : Infinity,
                        wasActionTap = !cancelled &&
                            dx * dx + dy * dy < TOUCH_DEAD_ZONE * TOUCH_DEAD_ZONE;
                    self.actionPointerId = null;
                    self.actionOrigin = null;
                    consume(event);
                    if(wasActionTap && self.canMove() && typeof onTap === 'function') {
                        onTap(event);
                    }
                }
            }
            surface.addEventListener('pointerup', function(event) { release(event, false); });
            surface.addEventListener('pointercancel', function(event) { release(event, true); });
            surface.addEventListener('lostpointercapture', function(event) {
                if(event.pointerId === self.pointerId ||
                   event.pointerId === self.actionPointerId) {
                    release(event, true);
                }
            });

            // A captured pointer normally keeps events on the Canvas. Support
            // older touch browsers without setPointerCapture too.
            if(!surface.setPointerCapture && window.addEventListener) {
                window.addEventListener('pointermove', function(event) {
                    if(event.pointerId === self.pointerId) { updateFromPointer(event); }
                });
                window.addEventListener('pointerup', function(event) { release(event, false); });
                window.addEventListener('pointercancel', function(event) { release(event, true); });
            }
        },

        releaseJoystick: function() {
            if(this.pointerId !== null && this.autoRunActive &&
               this.game.player && this.game.player.isMoving()) {
                this.game.player.stop();
            }
            this.pointerId = null;
            this.touchDirection = null;
            this.touchOrigin = null;
            this.touchDragged = false;
            this.actionPointerId = null;
            this.actionOrigin = null;
            this.autoRunActive = false;
            if(this.joystick) { this.joystick.classList.remove('is-active'); }
            if(this.thumb) { this.thumb.style.transform = 'translate(0px, 0px)'; }
        },

        reset: function(stopMotion) {
            if(stopMotion && this.autoRunActive && this.game.player &&
               this.game.player.isMoving()) {
                this.game.player.stop();
            }
            this.pressed.length = 0;
            this.releaseJoystick();
            this.autoRunActive = false;
        },

        currentDirection: function() {
            if(this.touchDirection) { return this.touchDirection; }
            if(!this.pressed.length) { return null; }
            return DIRECTION[this.pressed[this.pressed.length - 1]];
        },

        update: function() {
            if(!this.canMove()) {
                this.reset();
                return;
            }
            if(isEditable(document.activeElement)) {
                this.reset();
                return;
            }
            var direction = this.currentDirection(),
                game = this.game,
                player = game.player;
            if(!direction || player.isMoving()) { return; }
            var map = game.map,
                x0 = player.gridX,
                y0 = player.gridY,
                furthest = 0,
                i, x, y, n, path, straight;

            // Stop at the first obstacle. In particular, never ask A* to
            // detour around a wall when a direction key is being held.
            for(i = 1; i <= RUN_TILES; i += 1) {
                x = x0 + direction[0] * i;
                y = y0 + direction[1] * i;
                if(map.isOutOfBounds(x, y) || map.isColliding(x, y) ||
                   (map.isPlateau && (player.isOnPlateau ?
                       !map.isPlateau(x, y) : map.isPlateau(x, y)))) {
                    break;
                }
                furthest = i;
                // Portals are processed on step boundaries; never plan to
                // walk *past* the door in one straight keyboard segment.
                if(map.isDoor && map.isDoor(x, y)) { break; }
            }
            for(n = furthest; n >= 1; n -= 1) {
                x = x0 + direction[0] * n;
                y = y0 + direction[1] * n;
                path = game.findPath(player, x, y);
                straight = path && path.length === n + 1;
                for(i = 1; straight && i <= n; i += 1) {
                    if(path[i][0] !== x0 + direction[0] * i ||
                       path[i][1] !== y0 + direction[1] * i) {
                        straight = false;
                    }
                }
                if(straight) {
                    this.autoRunActive = true;
                    game.makePlayerGoTo(x, y);
                    return;
                }
            }
        }
    });

    return Controls;
});
