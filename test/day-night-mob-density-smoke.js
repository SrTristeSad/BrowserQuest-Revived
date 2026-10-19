'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const clock=require('../shared/js/daycycle'),budget=require('../server/js/mob-budget');
const MobArea=require('../server/js/mobarea'),Store=require('../server/admin/world-store').WorldStore;
const defaults=clock.normalize();
assert.deepEqual(defaults,{enabled:true,dayMinutes:20,nightMinutes:10});
const d=20*60000,n=10*60000;
assert.equal(clock.phase(d-61000),'day');
assert.equal(clock.phase(d-1000),'dusk');
assert.equal(clock.phase(d+1000),'night');
assert.equal(clock.phase(d+n-1000),'dawn');
assert.equal(clock.phase(d+1000,{enabled:false}),'day');
assert.equal(clock.isPeriodActive('night',d+1000),true);
assert.equal(clock.isPeriodActive('night',d-1000),false);
assert.equal(clock.isPeriodActive('always',d-1000),true);
assert.equal(budget.normalizeLimit(400),10);
assert.equal(budget.normalizeLimit(4),4);

const world={
    map:{maxNearbyMobs:2,dayNight:clock.normalize(),isProtectedSpawnTile:()=>false},
    mobs:{},players:{},moving:[],
    isValidPosition(x,y){return x>0&&y>0&&x<100&&y<100;},
    onMobMoveCallback(){},
    addMob(mob){this.mobs[mob.id]=mob;},
    despawn(mob){delete this.mobs[mob.id];this.removed=(this.removed||0)+1;}
};
assert.equal(budget.canSpawn(world,30,30),true);
world.players['p']={x:30,y:30,isDead:false};
assert.equal(budget.canSpawn(world,34,34),false,'do not spawn immediately beside a player');
delete world.players.p;
const first={id:'one',x:29,y:30,isDead:false};
const second={id:'two',x:34,y:30,isDead:false};
world.mobs.one=first;world.mobs.two=second;
assert.equal(budget.canSpawn(world,30,30),false,'nearby density cap takes effect');
assert.equal(budget.canSpawn(world,70,70),true,'faraway mobs can still be created');
delete world.mobs.one;delete world.mobs.two;
const wasNow=Date.now;
try {
    Date.now=()=>d+30000;
    const area=new MobArea(18,4,'rat',30,30,5,5,world,null,'night');
    area.spawnMobs();
    assert.equal(area.entities.length,2,'all configured mobs must respect local budget');
    assert.equal(Object.keys(world.mobs).length,2);
    assert(area.entities.every(m=>typeof m.getState==='function'),
      'spawned mobs must have the original complete visible entity state');
    Date.now=()=>d-90000;
    area.syncPeriod();
    assert.equal(area.entities.length,0,'night-only monsters disappear when morning comes');
    assert.equal(Object.keys(world.mobs).length,0);
    Date.now=()=>d+30000;
    area.syncPeriod();
    assert.equal(area.entities.length,2,'night-only monsters return with bounded counts');
    assert.equal(Object.keys(world.mobs).length,2);
} finally {Date.now=wasNow}

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bq-daycycle-'));
try {
    const file=n=>path.join(dir,n);
    const checkpoints=[{id:1,x:3,y:3,w:2,h:2,s:1}];
    const base={width:40,height:40,collisions:[],doors:[],checkpoints,
        chestAreas:[],staticChests:[],roamingAreas:[],staticEntities:{}};
    const client={width:40,height:40,data:Array(1600).fill(0),collisions:[],doors:[],checkpoints,
        blocking:[],plateau:[],high:[],animated:{}};
    fs.writeFileSync(file('base.json'),JSON.stringify(base));
    fs.writeFileSync(file('client.json'),JSON.stringify(client));
    const store=new Store({
        baseMapPath:file('base.json'),baseClientMapPath:file('client.json'),
        statePath:file('draft.json'),publishedMapPath:file('published.json'),
        publishedClientJsonPath:file('published-client.json'),
        publishedClientJsPath:file('published-client.js'),
        versionsDir:file('versions')
    });
    const state=store.load();
    state.map.maxNearbyMobs=5;
    state.map.dayNight={enabled:true,dayMinutes:15,nightMinutes:7};
    state.map.roamingAreas.push({id:1,x:10,y:10,width:4,height:4,nb:2,
        type:'rat',profileId:'',period:'night'});
    store.save(state);
    const published=store.buildServerMap(store.load());
    assert.equal(published.maxNearbyMobs,5);
    assert.equal(published.dayNight.nightMinutes,7);
    assert.equal(published.roamingAreas[0].period,'night');
    assert.equal(store.buildClientMap(store.load()).dayNight.nightMinutes,7);
    const bad=store.load();bad.map.maxNearbyMobs=999;
    assert.throws(()=>store.save(bad),/maxNearbyMobs|Limite de mobs/);
    const badPeriod=store.load();badPeriod.map.roamingAreas[0].period='invisible';
    assert.throws(()=>store.save(badPeriod),/Áreas de mobs inválidas/);
}finally{fs.rmSync(dir,{recursive:true,force:true})}

const home=fs.readFileSync(path.join(__dirname,'../client/js/main.js'),'utf8');
const game=fs.readFileSync(path.join(__dirname,'../client/js/game.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../client/css/main.css'),'utf8');
const editor=fs.readFileSync(path.join(__dirname,'../server/admin/public/world-editor.html'),'utf8');
const scripts=[...editor.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/g)];
assert.equal(scripts.length,2,'editor scripts must still parse');
scripts.forEach(s=>new vm.Script(s[1],{filename:'world-editor.js'}));
for(const text of ['id="enableDayNight"','id="dayMinutes"','id="nightMinutes"',
                    'id="maxNearbyMobs"','id="areaPeriod"']){
 assert(editor.includes(text),'missing world editor control '+text);
}
assert(home.includes("shared/js/daycycle"),'client must use shared clock');
assert(game.includes("self.sprites[entity instanceof Mob ? 'rat'"),
    'sprites must have a visible monster fallback');
assert(css.includes('body.game.started.bq-night #background'));
assert(!css.includes('body.game.started.bq-night #entities'),
    'night shading must not make monsters less visible');
console.log('Day/night clock, local mob cap, safe visible sprites and world editor settings passed.');
