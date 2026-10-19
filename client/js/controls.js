/* BrowserQuest input adapter: original pathfinding/network protocol is authoritative. */
define(function() {
    'use strict';

    // A held direction follows a short straight path. Four connected tiles
    // avoid restarting the walk animation every single tile; the existing
    // Game.onStep still reports each completed step to the server.
    var RUN_TILES = 4;
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
                !game.isZoning() && !game.isZoningTile(player.nextGridX, player.nextGridY));
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
                // Keyboard direction overrides click-to-move at the next tile.
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
            if(!document.createElement || !document.body) { return; }
            var self = this,
                base = document.createElement('div'),
                thumb = document.createElement('div');
            base.id = 'bq-joystick';
            base.setAttribute('role', 'group');
            base.setAttribute('aria-label', 'Movement joystick');
            thumb.className = 'bq-joystick-thumb';
            thumb.setAttribute('aria-hidden', 'true');
            base.appendChild(thumb);
            document.body.appendChild(base);
            this.joystick = base;
            this.thumb = thumb;

            function updateFromPointer(event) {
                var rect = base.getBoundingClientRect(),
                    halfW = rect.width / 2, halfH = rect.height / 2,
                    dx = event.clientX - (rect.left + halfW),
                    dy = event.clientY - (rect.top + halfH),
                    distance = Math.sqrt(dx * dx + dy * dy),
                    radius = Math.max(1, Math.min(halfW, halfH) * .54),
                    ratio = distance ? Math.min(1, radius / distance) : 0;
                thumb.style.transform = 'translate(' + Math.round(dx * ratio) +
                    'px, ' + Math.round(dy * ratio) + 'px)';
                // Touch jitter should not send a one-tile movement.
                if(distance < 13) {
                    self.touchDirection = null;
                } else if(Math.abs(dx) >= Math.abs(dy)) {
                    self.touchDirection = dx > 0 ? [1, 0] : [-1, 0];
                } else {
                    self.touchDirection = dy > 0 ? [0, 1] : [0, -1];
                }
            }
            base.addEventListener('pointerdown', function(event) {
                if(self.pointerId !== null || !self.canMove()) { return; }
                if(event.pointerType === 'mouse') { return; }
                self.pointerId = event.pointerId;
                base.classList.add('is-active');
                self.pressed.length = 0;
                if(self.game.player.isMoving()) { self.game.player.stop(); }
                if(base.setPointerCapture) { base.setPointerCapture(event.pointerId); }
                updateFromPointer(event);
                event.preventDefault();
                event.stopPropagation();
            });
            base.addEventListener('pointermove', function(event) {
                if(self.pointerId !== event.pointerId) { return; }
                updateFromPointer(event);
                event.preventDefault();
                event.stopPropagation();
            });
            function release(event) {
                if(self.pointerId !== event.pointerId) { return; }
                self.releaseJoystick();
                event.preventDefault();
                event.stopPropagation();
            }
            base.addEventListener('pointerup', release);
            base.addEventListener('pointercancel', release);
            base.addEventListener('lostpointercapture', function(event) {
                if(self.pointerId === event.pointerId) { self.releaseJoystick(); }
            });
            // Mobile Safari and embedded browsers can deliver touchstart on
            // the overlay even when their synthetic click is sent later.
            base.addEventListener('touchstart', function(event) {
                event.stopPropagation();
            }, {passive: true});
            base.addEventListener('touchend', function(event) {
                event.stopPropagation();
            }, {passive: true});
            // Synthetic click events must never reach BrowserQuest click-to-move.
            base.addEventListener('click', function(event) {
                event.preventDefault();
                event.stopPropagation();
            });
        },

        releaseJoystick: function() {
            if(this.pointerId !== null && this.autoRunActive &&
               this.game.player && this.game.player.isMoving()) {
                this.game.player.stop();
            }
            this.pointerId = null;
            this.touchDirection = null;
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
