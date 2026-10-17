'use strict';

var assert = require('assert'),
    BrainModule = require('../server/js/brain'),
    Brain = BrainModule.Brain,
    Types = require('../shared/js/gametypes');

function createWorld(entities, blocked) {
    blocked = blocked || {};
    return {
        map: {},
        moved: [],
        acquired: [],
        clearedAggro: [],
        clearedHate: [],
        entities: entities,
        forEachEntity: function(callback) {
            Object.keys(this.entities).forEach(function(id) { callback(entities[id]); });
        },
        getEntityById: function(id) { return this.entities[id] || null; },
        isValidPosition: function(x, y) { return x > 0 && y > 0 && !blocked[x + ',' + y]; },
        isPositionOccupied: function(x, y, ignoredId) {
            return Object.keys(this.entities).some(function(id) {
                var entity = entities[id];
                return entity.id !== ignoredId && !entity.isDead && entity.x === x && entity.y === y;
            });
        },
        moveBrainEntity: function(entity, x, y) {
            entity.x = x;
            entity.y = y;
            this.moved.push({id:entity.id,x:x,y:y});
        },
        handleMobHate: function(mobId, playerId) {
            this.acquired.push({mobId:mobId,playerId:playerId});
            var mob = this.entities[mobId];
            mob.hatelist.push({id:playerId,hate:1});
            mob.target = playerId;
        },
        clearMobAggroLink: function(mob) { this.clearedAggro.push(mob.id); },
        clearMobHateLinks: function(mob) { this.clearedHate.push(mob.id); }
    };
}

function npc(id, x, y) {
    return {id:id,type:'npc',kind:Types.Entities.VILLAGER,x:x,y:y,isDead:false,setPosition:function(nx,ny){this.x=nx;this.y=ny;}};
}

function player(id, x, y) {
    return {id:id,type:'player',kind:Types.Entities.WARRIOR,x:x,y:y,isDead:false};
}

function mob(id, x, y, hp) {
    return {
        id:id,type:'mob',kind:Types.Entities.GOBLIN,x:x,y:y,isDead:false,
        hitPoints:hp == null ? 100 : hp,maxHitPoints:100,target:null,hatelist:[],
        hasTarget:function(){return this.target !== null;},
        clearTarget:function(){this.target=null;},
        setTarget:function(target){this.target=target.id;},
        hates:function(targetId){return this.hatelist.some(function(e){return e.id===targetId;});},
        forgetEveryone:function(){this.hatelist=[];}
    };
}

(function testNpcPatrol() {
    var n = npc(1,5,5), world = createWorld({'1':n}), brain;
    brain = new Brain(n, world, {preset:'guard',mode:'patrol',patrol:[{x:8,y:5}],moveChance:1,fleeFromMobs:false,thinkMs:1000});
    brain.tick();
    assert.strictEqual(n.x,6,'patrolling NPC should take a step toward its route point');
    assert.strictEqual(n.y,5);
    assert.strictEqual(brain.memory.lastDecision,'patrol');
})();

(function testAggressiveMobAcquiresPlayer() {
    var m = mob(2,5,5), p = player(3,8,5), world = createWorld({'2':m,'3':p}), brain;
    brain = new Brain(m, world, {preset:'aggressive',aggressive:true,vision:8,moveChance:0});
    brain.tick();
    assert.strictEqual(world.acquired.length,1,'aggressive mob should acquire a visible player');
    assert.strictEqual(world.acquired[0].playerId,3);
    assert.strictEqual(brain.memory.lastDecision,'acquire-target');
    assert.strictEqual(m.x,6,'aggressive mob should step toward the acquired player');
})();

(function testCowardFleesAtLowHp() {
    var m = mob(4,5,5,20), p = player(5,4,5), world = createWorld({'4':m,'5':p}), brain;
    m.target = p.id;
    m.hatelist.push({id:p.id,hate:5});
    brain = new Brain(m, world, {preset:'coward',aggressive:true,vision:8,fleeBelowHp:0.4,moveChance:1});
    brain.tick();
    assert.strictEqual(brain.memory.lastDecision,'flee');
    assert.strictEqual(m.x,6,'low-health coward mob should move away from player');
    assert.deepStrictEqual(world.clearedAggro,[4],'fleeing should clear active aggro link');
})();

(function testBlockedAndOccupiedTilesAreAvoided() {
    var n = npc(6,5,5), obstacle = npc(7,6,5), world = createWorld({'6':n,'7':obstacle},{'5,4':true}), brain;
    brain = new Brain(n, world, {preset:'guard',mode:'patrol',patrol:[{x:8,y:5}],moveChance:1,fleeFromMobs:false});
    brain.tick();
    assert.notStrictEqual(n.x + ',' + n.y,'6,5','brain must not enter an occupied tile');
    assert.notStrictEqual(n.x + ',' + n.y,'5,4','brain must not enter a colliding tile');
})();

(function testTimerCanBeStopped() {
    var n = npc(8,5,5), world = createWorld({'8':n}), brain = new Brain(n, world, {preset:'villager',thinkMs:400});
    brain.start();
    assert.ok(brain.timer,'brain timer should start');
    brain.stop();
    assert.strictEqual(brain.timer,null,'brain timer should stop cleanly');
})();

console.log('Brain System smoke tests passed.');
