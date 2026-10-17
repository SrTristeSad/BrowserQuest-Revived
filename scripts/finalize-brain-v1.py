from pathlib import Path
import re


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    p.write_text(text.replace(old, new, 1))


def regex_once(path, pattern, replacement, label):
    p = Path(path)
    text = p.read_text()
    out, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'regex anchor not found: {label}')
    p.write_text(out)

# Brain timers must not keep tests/process shutdown alive.
replace_once(
    'server/js/brain.js',
    "    this.timer = setInterval(function() {\n        self.tick();\n    }, this.config.thinkMs + jitter);\n};",
    "    this.timer = setInterval(function() {\n        self.tick();\n    }, this.config.thinkMs + jitter);\n    if(this.timer && typeof this.timer.unref === 'function') {\n        this.timer.unref();\n    }\n};",
    'brain timer unref'
)

# Clear old combat links before a mob flees or returns to its territory.
replace_once(
    'server/js/brain.js',
    "            this.memory.lastDecision = 'flee';\n            entity.clearTarget();\n            if(this.stepAwayFrom(player)) {",
    "            this.memory.lastDecision = 'flee';\n            if(typeof this.world.clearMobAggroLink === 'function') { this.world.clearMobAggroLink(entity); }\n            entity.clearTarget();\n            if(this.stepAwayFrom(player)) {",
    'clear aggro on flee'
)
replace_once(
    'server/js/brain.js',
    "    if(distance(entity, this.home) > this.config.leash) {\n        entity.clearTarget();\n        if(typeof entity.forgetEveryone === 'function') {\n            entity.hatelist = [];\n        }",
    "    if(distance(entity, this.home) > this.config.leash) {\n        if(typeof this.world.clearMobAggroLink === 'function') { this.world.clearMobAggroLink(entity); }\n        if(typeof this.world.clearMobHateLinks === 'function') { this.world.clearMobHateLinks(entity); }\n        entity.clearTarget();\n        if(typeof entity.forgetEveryone === 'function') {\n            entity.forgetEveryone();\n        } else if(entity.hatelist) {\n            entity.hatelist = [];\n        }",
    'clear links on leash return'
)

# Old saved profiles without a brain should inherit the preset behavior, not become passive accidentally.
replace_once(
    'server/admin/world-store.js',
    "        fleeFromMobs:brain.fleeFromMobs === true, fleeBelowHp:Math.max(0,Math.min(0.95,fleeBelowHp)),\n        aggressive:brain.aggressive === true, leash:int(brain.leash,2,100,10),",
    "        fleeFromMobs:typeof brain.fleeFromMobs === 'boolean' ? brain.fleeFromMobs : ['villager','merchant','companion'].indexOf(preset) >= 0, fleeBelowHp:Math.max(0,Math.min(0.95,fleeBelowHp)),\n        aggressive:typeof brain.aggressive === 'boolean' ? brain.aggressive : ['aggressive','coward','territorial'].indexOf(preset) >= 0, leash:int(brain.leash,2,100,10),",
    'world store preset defaults'
)

# Some original BrowserQuest NPCs only have idle_down. Movement must degrade gracefully.
animate_replacement = r'''        animate: function(animation, speed, count, onEndCount) {
            var oriented = ['atk', 'walk', 'idle'],
                o = this.orientation,
                requested = animation,
                direction;

            if(!(this.currentAnimation && this.currentAnimation.name === "death")) {
                this.flipSpriteX = false;
                this.flipSpriteY = false;

                if(_.indexOf(oriented, animation) >= 0) {
                    direction = (o === Types.Orientations.LEFT ? "right" : Types.getOrientationAsString(o));
                    animation += "_" + direction;
                    this.flipSpriteX = (this.orientation === Types.Orientations.LEFT);
                }

                // Many legacy NPCs only provide idle_down. Keep movement functional
                // using an available frame until a full walking spritesheet is supplied.
                if(this.animations && !this.animations[animation]) {
                    if(direction && this.animations["idle_" + direction]) {
                        animation = "idle_" + direction;
                    } else if(this.animations.idle_down) {
                        animation = "idle_down";
                    } else if(this.animations[requested]) {
                        animation = requested;
                    } else {
                        animation = _.keys(this.animations)[0];
                    }
                }

                this.setAnimation(animation, speed, count, onEndCount);
            }
        },

        turnTo: function'''
regex_once(
    'client/js/character.js',
    r'\s*animate: function\(animation, speed, count, onEndCount\) \{.*?\n\s*\},\s*\n\s*turnTo: function',
    '\n' + animate_replacement,
    'client animation fallback'
)

# Ensure client syntax participates in npm check.
replace_once(
    'package.json',
    'node --check server/js/main.js && node --check server/js/ws.js',
    'node --check server/js/main.js && node --check server/js/ws.js && node --check client/js/character.js',
    'package client check'
)
