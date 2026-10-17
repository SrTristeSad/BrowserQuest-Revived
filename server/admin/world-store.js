'use strict';

var fs = require('fs'),
    path = require('path'),
    crypto = require('crypto');

var NPC_KINDS = ['guard','king','octocat','villagegirl','villager','priest','scientist','agent','rick','nyan','sorcerer','beachnpc','forestnpc','desertnpc','lavanpc','coder'];
var MOB_KINDS = ['rat','skeleton','goblin','ogre','spectre','crab','bat','wizard','eye','snake','skeleton2','boss','deathknight'];

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function readJson(filepath) { return JSON.parse(fs.readFileSync(filepath, 'utf8')); }

function atomicWriteText(filepath, content) {
    var dir = path.dirname(filepath),
        temp = filepath + '.tmp-' + process.pid + '-' + Date.now();
    fs.mkdirSync(dir, {recursive: true, mode: 0o700});
    fs.writeFileSync(temp, content, {mode: 0o600});
    fs.renameSync(temp, filepath);
    fs.chmodSync(filepath, 0o600);
}

function atomicWrite(filepath, value) {
    atomicWriteText(filepath, JSON.stringify(value, null, 2) + '\n');
}

function id(prefix) { return prefix + '_' + crypto.randomBytes(6).toString('hex'); }
function int(value, min, max, fallback) {
    var n = Number(value);
    if(!Number.isInteger(n)) { return fallback; }
    return Math.min(max, Math.max(min, n));
}
function text(value, max) { return String(value == null ? '' : value).trim().slice(0, max); }
function bool(value) { return value !== false; }

function tileToPosition(tile, width) {
    var zero = Number(tile) - 1;
    return {x: (zero % width) + 1, y: Math.floor(zero / width)};
}

function positionToTile(x, y, width) { return (y * width) + x; }

function buildEditableMap(base) {
    var entities = [];
    Object.keys(base.staticEntities || {}).forEach(function(tile) {
        var pos = tileToPosition(tile, base.width);
        entities.push({id:'base_' + tile,x:pos.x,y:pos.y,kind:String(base.staticEntities[tile]),profileType:'',profileId:'',source:'base'});
    });
    return {
        width: base.width,
        height: base.height,
        collisions: Array.isArray(base.collisions) ? base.collisions.slice() : [],
        doors: clone(base.doors || []),
        checkpoints: clone(base.checkpoints || []),
        chestAreas: clone(base.chestAreas || []),
        staticChests: clone(base.staticChests || []),
        roamingAreas: clone(base.roamingAreas || []),
        entities: entities
    };
}

function normalizeDrops(list) {
    if(!Array.isArray(list)) { return []; }
    return list.slice(0, 20).map(function(drop) {
        return {kind:text(drop.kind,40),chance:int(drop.chance,0,100,0)};
    }).filter(function(drop) { return drop.kind && drop.chance > 0; });
}

function normalizeNpc(profile) {
    profile = profile || {};
    return {
        id: text(profile.id,80) || id('npc'),
        name: text(profile.name,80) || 'Novo NPC',
        baseKind: NPC_KINDS.indexOf(profile.baseKind) >= 0 ? profile.baseKind : 'villager',
        enabled: bool(profile.enabled),
        dialogue: Array.isArray(profile.dialogue) ? profile.dialogue.slice(0,50).map(function(line){return text(line,500);}).filter(Boolean) : [],
        storyId: text(profile.storyId,80),
        missionId: text(profile.missionId,80),
        completionMissionId: text(profile.completionMissionId,80)
    };
}

function normalizeMob(profile) {
    profile = profile || {};
    return {
        id: text(profile.id,80) || id('mob'),
        name: text(profile.name,80) || 'Novo Mob',
        baseKind: MOB_KINDS.indexOf(profile.baseKind) >= 0 ? profile.baseKind : 'rat',
        enabled: bool(profile.enabled),
        hitPoints: int(profile.hitPoints,1,1000000,50),
        armorLevel: int(profile.armorLevel,0,1000,1),
        weaponLevel: int(profile.weaponLevel,0,1000,1),
        respawnMs: int(profile.respawnMs,1000,3600000,30000),
        aggroDistance: int(profile.aggroDistance,1,200,50),
        drops: normalizeDrops(profile.drops)
    };
}

function normalizeEntity(entity, map, npcIds, mobIds) {
    entity = entity || {};
    var profileType = entity.profileType === 'npc' || entity.profileType === 'mob' ? entity.profileType : '',
        profileId = text(entity.profileId,80),
        kind = text(entity.kind,40);
    if(profileType === 'npc' && !npcIds[profileId]) { profileType=''; profileId=''; }
    if(profileType === 'mob' && !mobIds[profileId]) { profileType=''; profileId=''; }
    if(profileType === '' && NPC_KINDS.indexOf(kind) < 0 && MOB_KINDS.indexOf(kind) < 0) { kind='villager'; }
    return {
        id:text(entity.id,100)||id('entity'),
        x:int(entity.x,1,Math.max(1,map.width-1),1),
        y:int(entity.y,1,Math.max(1,map.height-1),1),
        kind:kind,
        profileType:profileType,
        profileId:profileId,
        source:entity.source === 'base' ? 'base' : 'editor'
    };
}

function normalizeArea(area, map, mobIds) {
    area = area || {};
    var profileId=text(area.profileId,80), type=text(area.type,40);
    if(profileId && !mobIds[profileId]) { profileId=''; }
    if(!profileId && MOB_KINDS.indexOf(type) < 0) { type='rat'; }
    return {
        id:int(area.id,1,999999,Math.floor(Math.random()*900000)+100000),
        x:int(area.x,1,Math.max(1,map.width-2),1),
        y:int(area.y,1,Math.max(1,map.height-2),1),
        width:int(area.width||area.w,1,Math.max(1,map.width),5),
        height:int(area.height||area.h,1,Math.max(1,map.height),5),
        nb:int(area.nb,1,500,3),
        type:type,
        profileId:profileId
    };
}

function WorldStore(options) {
    options = options || {};
    this.baseMapPath = options.baseMapPath;
    this.baseClientMapPath = options.baseClientMapPath;
    this.statePath = options.statePath;
    this.publishedMapPath = options.publishedMapPath;
    this.publishedClientJsonPath = options.publishedClientJsonPath;
    this.publishedClientJsPath = options.publishedClientJsPath;
    this.versionsDir = options.versionsDir;
    this.base = readJson(this.baseMapPath);
    this.baseClient = this.baseClientMapPath ? readJson(this.baseClientMapPath) : null;
}

WorldStore.prototype.createInitialState = function() {
    return {schemaVersion:1,revision:1,status:'draft',updatedAt:new Date().toISOString(),publishedAt:null,map:buildEditableMap(this.base),npcs:[],mobs:[]};
};

WorldStore.prototype.load = function() {
    var state;
    try { state=readJson(this.statePath); }
    catch(error) { state=this.createInitialState(); atomicWrite(this.statePath,state); }
    return this.normalize(state);
};

WorldStore.prototype.normalize = function(state) {
    state=state||{};
    var map=state.map||{},
        npcs=Array.isArray(state.npcs)?state.npcs.slice(0,500).map(normalizeNpc):[],
        mobs=Array.isArray(state.mobs)?state.mobs.slice(0,500).map(normalizeMob):[],
        npcIds={},mobIds={},baseWidth=this.base.width,baseHeight=this.base.height;
    npcs.forEach(function(p){npcIds[p.id]=true;});
    mobs.forEach(function(p){mobIds[p.id]=true;});

    // Tile painting is intentionally constrained to the original dimensions so the
    // original visual tile layer stays aligned with server collision/pathing data.
    map.width=baseWidth;
    map.height=baseHeight;
    map.collisions=Array.isArray(map.collisions)?Array.from(new Set(map.collisions.map(Number).filter(function(v){return Number.isInteger(v)&&v>=0&&v<baseWidth*baseHeight;}))).sort(function(a,b){return a-b;}):[];
    map.doors=Array.isArray(map.doors)?map.doors.slice(0,1000):[];
    map.checkpoints=Array.isArray(map.checkpoints)?map.checkpoints.slice(0,1000):[];
    map.chestAreas=Array.isArray(map.chestAreas)?map.chestAreas.slice(0,1000):[];
    map.staticChests=Array.isArray(map.staticChests)?map.staticChests.slice(0,5000):[];
    map.entities=Array.isArray(map.entities)?map.entities.slice(0,10000).map(function(e){return normalizeEntity(e,map,npcIds,mobIds);}):[];
    map.roamingAreas=Array.isArray(map.roamingAreas)?map.roamingAreas.slice(0,2000).map(function(a){return normalizeArea(a,map,mobIds);}):[];

    return {schemaVersion:1,revision:int(state.revision,1,Number.MAX_SAFE_INTEGER,1),status:state.status==='published'?'published':'draft',updatedAt:state.updatedAt||new Date().toISOString(),publishedAt:state.publishedAt||null,map:map,npcs:npcs,mobs:mobs,catalogs:{npcKinds:NPC_KINDS.slice(),mobKinds:MOB_KINDS.slice()}};
};

WorldStore.prototype.save = function(input) {
    var previous=this.load(),state=this.normalize(input);
    state.revision=previous.revision+1;
    state.status='draft';
    state.updatedAt=new Date().toISOString();
    state.publishedAt=previous.publishedAt||null;
    atomicWrite(this.statePath,state);
    return state;
};

WorldStore.prototype.reset = function() {
    var state=this.createInitialState();
    atomicWrite(this.statePath,state);
    return this.normalize(state);
};

WorldStore.prototype.buildServerMap = function(state) {
    state=this.normalize(state||this.load());
    var map=state.map,published=clone(this.base),staticEntities={},editorMetadata={},npcById={},mobById={};
    state.npcs.forEach(function(p){npcById[p.id]=p;});
    state.mobs.forEach(function(p){mobById[p.id]=p;});

    map.entities.forEach(function(entity){
        var tile=positionToTile(entity.x,entity.y,map.width),kind=entity.kind,metadata;
        if(entity.profileType==='npc'&&npcById[entity.profileId]){kind=npcById[entity.profileId].baseKind;metadata={type:'npc',profileId:entity.profileId};}
        else if(entity.profileType==='mob'&&mobById[entity.profileId]){kind=mobById[entity.profileId].baseKind;metadata={type:'mob',profileId:entity.profileId};}
        staticEntities[String(tile)]=kind;
        if(metadata){editorMetadata[String(tile)]=metadata;}
    });

    published.width=map.width;
    published.height=map.height;
    published.collisions=map.collisions.slice();
    published.doors=clone(map.doors);
    published.checkpoints=clone(map.checkpoints);
    published.chestAreas=clone(map.chestAreas);
    published.staticChests=clone(map.staticChests);
    published.staticEntities=staticEntities;
    published.roamingAreas=map.roamingAreas.map(function(area){
        var out=clone(area);
        if(out.profileId&&mobById[out.profileId]){out.type=mobById[out.profileId].baseKind;}
        return out;
    });
    published.editorMetadata=editorMetadata;
    published.editorProfiles={npcs:npcById,mobs:mobById};
    published.editorRevision=state.revision;
    return published;
};

WorldStore.prototype.buildClientMap = function(state) {
    if(!this.baseClient) { return null; }
    state=this.normalize(state||this.load());
    var client=clone(this.baseClient);
    client.width=this.baseClient.width;
    client.height=this.baseClient.height;
    client.collisions=state.map.collisions.slice();
    client.doors=clone(state.map.doors);
    client.checkpoints=clone(state.map.checkpoints);
    client.editorRevision=state.revision;
    return client;
};

WorldStore.prototype.publish = function() {
    var state=this.load(),publishedMap=this.buildServerMap(state),publishedClient=this.buildClientMap(state),stamp=new Date().toISOString().replace(/[:.]/g,'-'),snapshot;
    fs.mkdirSync(this.versionsDir,{recursive:true,mode:0o700});
    if(fs.existsSync(this.publishedMapPath)){
        snapshot=path.join(this.versionsDir,'world-'+stamp+'.json');
        fs.copyFileSync(this.publishedMapPath,snapshot);
        fs.chmodSync(snapshot,0o600);
    }
    atomicWrite(this.publishedMapPath,publishedMap);
    if(publishedClient&&this.publishedClientJsonPath&&this.publishedClientJsPath){
        atomicWrite(this.publishedClientJsonPath,publishedClient);
        atomicWriteText(this.publishedClientJsPath,'var mapData = '+JSON.stringify(publishedClient)+';\n');
    }
    state.status='published';
    state.publishedAt=new Date().toISOString();
    state.updatedAt=state.publishedAt;
    atomicWrite(this.statePath,state);
    return {ok:true,revision:state.revision,publishedAt:state.publishedAt,restartRequired:true,publishedMapPath:this.publishedMapPath,clientMapSynchronized:!!publishedClient};
};

WorldStore.prototype.getPublishedPath=function(){return fs.existsSync(this.publishedMapPath)?this.publishedMapPath:null;};

exports.WorldStore=WorldStore;
exports.NPC_KINDS=NPC_KINDS;
exports.MOB_KINDS=MOB_KINDS;
