from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    p.write_text(text.replace(old, new, 1))

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

# Some original BrowserQuest NPCs only have idle_down. Movement must degrade gracefully instead of requesting missing animations.
replace_once(
    'client/js/character.js',
    '''    \tanimate: function(animation, speed, count, onEndCount) {\n    \t    var oriented = ['atk', 'walk', 'idle'];\n    \t        o = this.orientation;\n            \n            if(!(this.currentAnimation && this.currentAnimation.name === "death")) { // don't change animation if the character is dying\n            \tthis.flipSpriteX = false;\n        \t    this.flipSpriteY = false;\n    \t    \n        \t    if(_.indexOf(oriented, animation) >= 0) {\n        \t        animation += "_" + (o === Types.Orientations.LEFT ? "right" : Types.getOrientationAsString(o));\n        \t        this.flipSpriteX = (this.orientation === Types.Orientations.LEFT) ? true : false;\n        \t    }\n\n        \t\tthis.setAnimation(animation, speed, count, onEndCount);\n        \t}\n    \t},''',
    '''    \tanimate: function(animation, speed, count, onEndCount) {\n    \t    var oriented = ['atk', 'walk', 'idle'],\n                o = this.orientation,\n                requested = animation,\n                direction;\n            \n            if(!(this.currentAnimation && this.currentAnimation.name === "death")) { // don't change animation if the character is dying\n            \tthis.flipSpriteX = false;\n        \t    this.flipSpriteY = false;\n    \t    \n        \t    if(_.indexOf(oriented, animation) >= 0) {\n                    direction = (o === Types.Orientations.LEFT ? "right" : Types.getOrientationAsString(o));\n        \t        animation += "_" + direction;\n        \t        this.flipSpriteX = (this.orientation === Types.Orientations.LEFT) ? true : false;\n        \t    }\n\n                // Legacy NPC art is often static (for example only idle_down).\n                // Keep movement functional using an available frame instead of logging missing-animation errors.\n                if(this.animations && !this.animations[animation]) {\n                    if(direction && this.animations["idle_" + direction]) {\n                        animation = "idle_" + direction;\n                    } else if(this.animations.idle_down) {\n                        animation = "idle_down";\n                    } else if(this.animations[requested]) {\n                        animation = requested;\n                    } else {\n                        animation = _.keys(this.animations)[0];\n                    }\n                }\n\n        \t\tthis.setAnimation(animation, speed, count, onEndCount);\n        \t}\n    \t},''',
    'client animation fallback'
)

# Ensure client syntax participates in npm check.
replace_once(
    'package.json',
    'node --check server/js/main.js && node --check server/js/ws.js',
    'node --check server/js/main.js && node --check server/js/ws.js && node --check client/js/character.js',
    'package client check'
)
