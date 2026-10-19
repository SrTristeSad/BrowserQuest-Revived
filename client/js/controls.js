/* BrowserQuest input adapter: original pathfinding/network protocol is authoritative. */
define(function() {
    'use strict';

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
                if(self.pressed.length === 0 && self.game.player.isMoving()) {
                    self.game.player.stop();
                }
                self.pressed.push(code);
            }, true);
            document.addEventListener('keyup', function(event) {
                var code = event.code || ('Key' + String.fromCharCode(event.which || 0)),
                    index = self.pressed.indexOf(code);
                if(index !== -1) {
                    self.pressed.splice(index, 1);
                    event.preventDefault();
                }
            }, true);
            window.addEventListener('blur', function() { self.reset(); });
            document.addEventListener('visibilitychange', function() {
                if(document.hidden) { self.reset(); }
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
            this.pointerId = null;
            this.touchDirection = null;
            if(this.joystick) { this.joystick.classList.remove('is-active'); }
            if(this.thumb) { this.thumb.style.transform = 'translate(0px, 0px)'; }
        },

        reset: function() {
            this.pressed.length = 0;
            this.releaseJoystick();
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
            var x = player.gridX + direction[0],
                y = player.gridY + direction[1],
                map = game.map;
            if(map.isOutOfBounds(x, y) || map.isColliding(x, y)) { return; }
            if(map.isPlateau && (player.isOnPlateau ? !map.isPlateau(x, y) : map.isPlateau(x, y))) {
                return;
            }
            // Never replace click interactions with an unintended attack,
            // and never let A* route around a blocked adjacent direction.
            var path = game.findPath(player, x, y);
            if(!path || path.length !== 2 || path[1][0] !== x || path[1][1] !== y) {
                return;
            }
            game.makePlayerGoTo(x, y);
        }
    });

    return Controls;
});
