'use strict';

var fs = require('fs'),
    path = require('path'),
    crypto = require('crypto'),
    ReferenceValidator = require('./story-reference-validator'),
    WorldPublishTransaction = require('./world-publish-transaction'),
    Types = require('../../shared/js/gametypes');

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

function readPngDimensions(filepath) {
    var buffer;
    try { buffer = fs.readFileSync(filepath); }
    catch(error) { return null; }
    if(buffer.length < 24 ||
        buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47 ||
        buffer[4] !== 0x0d || buffer[5] !== 0x0a || buffer[6] !== 0x1a || buffer[7] !== 0x0a ||
        buffer.toString('ascii', 12, 16) !== 'IHDR') { return null; }
    var width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
    if(!width || !height || width > 32768 || height > 32768) { return null; }
    return {width: width, height: height};
}

function maxBaseTileId(baseClient) {
    var max = -1;
    if(!baseClient || !Array.isArray(baseClient.data)) { return max; }
    baseClient.data.forEach(function(value) {
        value = Number(value);
        if(Number.isInteger(value) && value >= 0 && value > max) { max = value; }
    });
    return max;
}

function buildTileCatalog(baseClient, tilesetPath, tilesetUrl) {
    var tileSize = int(baseClient && baseClient.tilesize, 1, 512, 16),
        dimensions = tilesetPath ? readPngDimensions(tilesetPath) : null,
        columns = 0,
        rows = 0,
        count = 0,
        fallbackMax = maxBaseTileId(baseClient);
    if(dimensions && dimensions.width % tileSize === 0 && dimensions.height % tileSize === 0) {
        columns = dimensions.width / tileSize;
        rows = dimensions.height / tileSize;
        count = columns * rows;
    }
    if(count <= 0) { count = fallbackMax + 1; }
    return {
        url: text(tilesetUrl || '/img/1/tilesheet.png', 240),
        tileSize: tileSize,
        width: dimensions ? dimensions.width : 0,
        height: dimensions ? dimensions.height : 0,
        columns: columns,
        rows: rows,
        count: Math.max(0, count),
        maxTileId: Math.max(-1, count - 1),
        measured: Boolean(dimensions && columns && rows)
    };
}

function normalizeTileValue(value, fallback, maxTileId) {
    var n = Number(value), safeFallback = Number(fallback), max = Number(maxTileId);
    if(!Number.isInteger(max) || max < -1) { max = -1; }
    if(Number.isInteger(n) && n >= -1 && n <= max) { return n; }
    if(Number.isInteger(safeFallback) && safeFallback >= -1 && safeFallback <= max) { return safeFallback; }
    return -1;
}

function normalizeTileData(input, fallback, expectedLength, maxTileId) {
    var source = Array.isArray(input) ? input : [],
        base = Array.isArray(fallback) ? fallback : [],
        length = int(expectedLength, 0, 10000000, 0),
        data = new Array(length),
        i;
    for(i = 0; i < length; i += 1) {
        data[i] = normalizeTileValue(source[i], base[i], maxTileId);
    }
    return data;
}

function normalizeBrain(brain, fallbackPreset) {
    brain = brain || {};
    var presets = ['villager','merchant','guard','passive','aggressive','coward','territorial','companion'],
        modes = ['wander','patrol','follow'],
        preset = presets.indexOf(brain.preset) >= 0 ? brain.preset : fallbackPreset,
        mode = modes.indexOf(brain.mode) >= 0 ? brain.mode : (preset === 'guard' ? 'patrol' : (preset === 'companion' ? 'follow' : 'wander')),
        moveChance = Number(brain.moveChance),
        fleeBelowHp = Number(brain.fleeBelowHp),
        patrol = Array.isArray(brain.patrol) ? brain.patrol.slice(0,32).map(function(point) {
            return {x:int(point && point.x,1,1000,1),y:int(point && point.y,1,1000,1)};
        }) : [];
    if(!Number.isFinite(moveChance)) { moveChance = 0.6; }
    if(!Number.isFinite(fleeBelowHp)) { fleeBelowHp = preset === 'coward' ? 0.4 : 0; }
    return {
        enabled: brain.enabled !== false, preset:preset, mode:mode,
        thinkMs:int(brain.thinkMs,400,10000,1200), vision:int(brain.vision,1,50,7),
        wanderRadius:int(brain.wanderRadius,1,50,6), moveChance:Math.max(0,Math.min(1,moveChance)),
        fleeFromMobs:typeof brain.fleeFromMobs === 'boolean' ? brain.fleeFromMobs : ['villager','merchant','companion'].indexOf(preset) >= 0, fleeBelowHp:Math.max(0,Math.min(0.95,fleeBelowHp)),
        aggressive:typeof brain.aggressive === 'boolean' ? brain.aggressive : ['aggressive','coward','territorial'].indexOf(preset) >= 0, leash:int(brain.leash,2,100,10),
        followDistance:int(brain.followDistance,1,10,2), patrol:patrol
    };
}

function tileToPosition(tile, width) {
    var zero = Number(tile) - 1;
    return {x: (zero % width) + 1, y: Math.floor(zero / width)};
}
function positionToTile(x, y, width) { return (y * width) + x; }

function buildEditableMap(base, baseClient, maxTileId) {
    var entities = [], tileCount = base.width * base.height,
        baseTileData = baseClient && Array.isArray(baseClient.data) ? baseClient.data : [];
    Object.keys(base.staticEntities || {}).forEach(function(tile) {
        var pos = tileToPosition(tile, base.width);
        entities.push({id:'base_' + tile,x:pos.x,y:pos.y,kind:String(base.staticEntities[tile]),profileType:'',profileId:'',source:'base'});
    });
    return {
        width: base.width,
        height: base.height,
        data: normalizeTileData(baseTileData, baseTileData, tileCount, maxTileId),
        collisions: Array.isArray(base.collisions) ? base.collisions.slice() : [],
        doors: clone(base.doors || []),
        checkpoints: clone(base.checkpoints || []),
        chestAreas: clone(base.chestAreas || []),
        staticChests: clone(base.staticChests || []),
        roamingAreas: clone(base.roamingAreas || []),
        entities: entities
    };
}

function validateRawWorld(raw, width, height, maxTileId) {
    var errors = [], map = raw && raw.map, total = width * height;
    function add(path, message) { errors.push({path:path,message:message}); }
    if(!map || typeof map !== 'object' || Array.isArray(map)) {
        add('map','Mapa ausente ou inválido.');
    } else {
        if(map.width != null && map.width !== width || map.height != null && map.height !== height) {
            add('map.width/height','Dimensões incompatíveis com o mapa original.');
        }
        if(map.data != null) {
            if(!Array.isArray(map.data)) {
                add('map.data','Grade de tiles inválida.');
            } else if(map.data.length === total) {
                var i = map.data.findIndex(function(tile) {
                    return !Number.isSafeInteger(tile) || tile < -1 || tile > maxTileId;
                });
                if(i !== -1) { add('map.data['+i+']','Tile fora do catálogo do tileset.'); }
            }
            // Legacy short grids are migrated/padded by normalizeTileData.
        }
        if(map.collisions != null && (!Array.isArray(map.collisions) ||
           map.collisions.some(function(v){return !Number.isSafeInteger(v)||v<0||v>=total;}))) {
            add('map.collisions','Colisões devem ser índices inteiros válidos.');
        }
        if(map.checkpoints != null && (!Array.isArray(map.checkpoints) ||
           normalizeCheckpointAreas(map.checkpoints,width,height).length !== map.checkpoints.length)) {
            add('map.checkpoints','Checkpoint duplicado ou fora dos limites.');
        }
        if(map.entities != null && (!Array.isArray(map.entities) ||
           map.entities.some(function(e) {
               return !e || !Number.isSafeInteger(e.x)||!Number.isSafeInteger(e.y)||
                 e.x < 1||e.y < 1||e.x >= width||e.y >= height;
           }))) { add('map.entities','Entidade com posição fora do mapa.'); }
    }
    return {ok:errors.length === 0,errors:errors};
}
function requireRawWorld(raw,width,height,maxTileId) {
    var report=validateRawWorld(raw,width,height,maxTileId);
    if(!report.ok) {
        var error=new Error('Validação do mundo falhou: '+report.errors.slice(0,5).map(function(e){return e.path+' — '+e.message;}).join(' | '));
        error.code='WORLD_MAP_VALIDATION';error.statusCode=422;error.details=report.errors;throw error;
    }
}

function chestItemCatalog() {
    var out = [];
    Types.forEachKind(function(kind, name) {
        if(Number.isSafeInteger(kind) && Types.isItem(kind)) { out.push({id:kind,name:name}); }
    });
    return out.sort(function(a,b){return a.id-b.id;});
}
var CHEST_ITEM_CATALOG = chestItemCatalog();
var CHEST_ITEM_IDS = new Set(CHEST_ITEM_CATALOG.map(function(entry){return entry.id;}));
function validChestItems(items) {
    return Array.isArray(items) && items.length >= 1 && items.length <= 20 &&
           items.every(function(v){return Number.isSafeInteger(v) && CHEST_ITEM_IDS.has(v);});
}
function normalizeStaticChests(list,width,height) {
    if(!Array.isArray(list)) { return []; }
    var used = new Set(),out = [];
    list.slice(0,5000).forEach(function(chest) {
        if(!chest || typeof chest !== 'object' || Array.isArray(chest) ||
           !Number.isSafeInteger(chest.x) || !Number.isSafeInteger(chest.y) ||
           chest.x < 1 || chest.x >= width || chest.y < 1 || chest.y >= height ||
           !validChestItems(chest.i)) { return; }
        var key = chest.x + ':' + chest.y;
        if(used.has(key)) { return; }
        used.add(key); out.push({x:chest.x,y:chest.y,i:chest.i.slice()});
    });
    return out;
}
function normalizeChestAreas(list,width,height) {
    if(!Array.isArray(list)) { return []; }
    var used = new Set(),out = [];
    list.slice(0,1000).forEach(function(area) {
        if(!area || typeof area !== 'object' || Array.isArray(area) ||
           ![area.x,area.y,area.w,area.h,area.tx,area.ty].every(Number.isSafeInteger) ||
           area.x < 1 || area.y < 1 || area.w < 1 || area.h < 1 ||
           area.x + area.w >= width || area.y + area.h >= height ||
           area.tx < 1 || area.tx >= width || area.ty < 1 || area.ty >= height ||
           !validChestItems(area.i)) { return; }
        var key = area.x + ':' + area.y + ':' + area.w + ':' + area.h;
        if(used.has(key)) { return; }
        used.add(key);out.push({x:area.x,y:area.y,w:area.w,h:area.h,i:area.i.slice(),tx:area.tx,ty:area.ty});
    });
    return out;
}
function requireValidChests(map,width,height) {
    if(!map) { return; }
    var stat=map.staticChests,areas=map.chestAreas;
    if(stat != null && (!Array.isArray(stat) || stat.length > 5000 ||
       normalizeStaticChests(stat,width,height).length !== stat.length) ||
       areas != null && (!Array.isArray(areas) || areas.length > 1000 ||
       normalizeChestAreas(areas,width,height).length !== areas.length)) {
        var error = new Error('Baús inválidos: confira posição, região, destino e IDs numéricos de itens.');
        error.code='WORLD_CHEST_VALIDATION';error.statusCode=422;throw error;
    }
}

function normalizeDoorLinks(list, width, height) {
    if(!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) { return []; }
    var used = new Set(), result = [];
    if(!Array.isArray(list)) { return result; }
    list.slice(0, 1000).forEach(function(door) {
        if(!door || typeof door !== 'object' || Array.isArray(door)) { return; }
        if(![door.x, door.y, door.tx, door.ty, door.p].every(Number.isSafeInteger)) { return; }
        if(door.x < 0 || door.y < 0 || door.tx < 0 || door.ty < 0 ||
           door.x >= width || door.tx >= width || door.y >= height || door.ty >= height ||
           door.p !== 0 && door.p !== 1 || !['u','d','l','r'].includes(door.to) ||
           door.x === door.tx && door.y === door.ty) { return; }
        var key = door.x + ':' + door.y,
            hasCamera = Object.prototype.hasOwnProperty.call(door, 'tcx') ||
                        Object.prototype.hasOwnProperty.call(door, 'tcy');
        if(used.has(key)) { return; }
        if(hasCamera && (!Number.isSafeInteger(door.tcx) || !Number.isSafeInteger(door.tcy) ||
            door.tcx < 0 || door.tcy < 0 || door.tcx >= width || door.tcy >= height)) { return; }
        used.add(key);
        var clean = {x:door.x,y:door.y,p:door.p,to:door.to,tx:door.tx,ty:door.ty};
        if(hasCamera) { clean.tcx=door.tcx; clean.tcy=door.tcy; }
        result.push(clean);
    });
    return result;
}

function requireValidDoorLinks(list, width, height) {
    if(list == null) { return; }
    if(!Array.isArray(list) || list.length > 1000 ||
       normalizeDoorLinks(list, width, height).length !== list.length) {
        var error = new Error('Portas/teleportes inválidos: verifique origem única, destino, orientação, portal e câmera.');
        error.code = 'WORLD_DOOR_VALIDATION';
        error.statusCode = 422;
        throw error;
    }
}

function normalizeCheckpointAreas(list, width, height) {
    if(!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) { return []; }
    var seen = new Set(), out = [];
    if(!Array.isArray(list)) { return out; }
    list.slice(0, 1000).forEach(function(cp) {
        if(!cp || typeof cp !== 'object' || Array.isArray(cp)) { return; }
        var values = [cp.id, cp.x, cp.y, cp.w, cp.h];
        if(!values.every(Number.isSafeInteger)) { return; }
        if(cp.id < 1 || seen.has(cp.id) || cp.x < 0 || cp.y < 0 ||
           cp.w < 1 || cp.h < 1 || cp.x + cp.w > width || cp.y + cp.h > height) { return; }
        if(cp.s != null && cp.s !== 0 && cp.s !== 1) { return; }
        seen.add(cp.id);
        out.push({id:cp.id, x:cp.x, y:cp.y, w:cp.w, h:cp.h, s:cp.s === 1 ? 1 : 0});
    });
    return out;
}

function requireStartingCheckpoint(state, base) {
    if(Array.isArray(base.checkpoints) && base.checkpoints.some(function(cp){return cp && cp.s === 1;}) &&
       !state.map.checkpoints.some(function(cp){return cp.s === 1;})) {
        var error = new Error('O mundo precisa manter pelo menos um checkpoint inicial.');
        error.code = 'WORLD_START_CHECKPOINT_REQUIRED';
        error.statusCode = 422;
        throw error;
    }
}

function normalizeDrops(list) {
    if(!Array.isArray(list)) { return []; }
    return list.slice(0, 20).map(function(drop) { return {kind:text(drop.kind,40),chance:int(drop.chance,0,100,0)}; })
        .filter(function(drop) { return drop.kind && drop.chance > 0; });
}
function normalizeNpc(profile) {
    profile = profile || {};
    return {
        id: text(profile.id,80) || id('npc'), name: text(profile.name,80) || 'Novo NPC',
        baseKind: NPC_KINDS.indexOf(profile.baseKind) >= 0 ? profile.baseKind : 'villager', enabled: bool(profile.enabled),
        dialogue: Array.isArray(profile.dialogue) ? profile.dialogue.slice(0,50).map(function(line){return text(line,500);}).filter(Boolean) : [],
        storyId: text(profile.storyId,80), missionId: text(profile.missionId,80), completionMissionId: text(profile.completionMissionId,80),
        brain: normalizeBrain(profile.brain, (profile.baseKind === 'guard' || profile.baseKind === 'king') ? 'guard' : 'villager')
    };
}
function normalizeMob(profile) {
    profile = profile || {};
    return {
        id: text(profile.id,80) || id('mob'), name: text(profile.name,80) || 'Novo Mob',
        baseKind: MOB_KINDS.indexOf(profile.baseKind) >= 0 ? profile.baseKind : 'rat', enabled: bool(profile.enabled),
        hitPoints: int(profile.hitPoints,1,1000000,50), armorLevel: int(profile.armorLevel,0,1000,1),
        weaponLevel: int(profile.weaponLevel,0,1000,1), respawnMs: int(profile.respawnMs,1000,3600000,30000),
        aggroDistance: int(profile.aggroDistance,1,200,50), drops: normalizeDrops(profile.drops), brain: normalizeBrain(profile.brain, 'aggressive')
    };
}
var STATIC_ITEM_KINDS = new Set(CHEST_ITEM_CATALOG.map(function(entry){return entry.name;}));
function requireValidStaticItems(map, width, height) {
    if(!map || map.entities == null) { return; }
    if(!Array.isArray(map.entities)) { throw staticItemError(); }
    var items = map.entities, locations = new Set(), chestLocations = new Set(),
        blocked = new Set(Array.isArray(map.collisions) ? map.collisions : []),
        itemIds = new Set();
    (Array.isArray(map.staticChests) ? map.staticChests : []).forEach(function(chest) {
        if(chest && Number.isSafeInteger(chest.x) && Number.isSafeInteger(chest.y)) {
            chestLocations.add(chest.x + ':' + chest.y);
        }
    });
    items.forEach(function(entity) {
        if(!entity || typeof entity !== 'object') { return; }
        if(Number.isSafeInteger(entity.x) && Number.isSafeInteger(entity.y)) {
            locations.add(entity.x + ':' + entity.y);
        }
    });
    items.forEach(function(entity) {
        if(!entity || typeof entity !== 'object' || Array.isArray(entity)) { return; }
        if(entity.profileType !== 'item' && !STATIC_ITEM_KINDS.has(entity.kind)) { return; }
        var key = entity.x + ':' + entity.y;
        if(!STATIC_ITEM_KINDS.has(entity.kind) ||
           (entity.profileType !== '' && entity.profileType !== 'item' && entity.profileType != null) ||
           (entity.profileId != null && entity.profileId !== '') ||
           typeof entity.id !== 'string' || !entity.id || entity.id.length > 100 ||
           itemIds.has(entity.id) || !Number.isSafeInteger(entity.x) || !Number.isSafeInteger(entity.y) ||
           entity.x < 1 || entity.y < 1 || entity.x >= width || entity.y >= height ||
           chestLocations.has(key) || blocked.has(entity.y * width + entity.x) ||
           items.some(function(other) { return other !== entity && other &&
               other.x === entity.x && other.y === entity.y; })) {
            throw staticItemError();
        }
        itemIds.add(entity.id);
    });
}
function staticItemError() {
    var error = new Error('Item estático inválido: confira tipo, posição, colisão e sobreposição.');
    error.code = 'WORLD_STATIC_ITEM_VALIDATION';
    error.statusCode = 422;
    return error;
}
function normalizeEntity(entity, map, npcIds, mobIds) {
    entity = entity || {};
    var profileType = entity.profileType === 'npc' || entity.profileType === 'mob' || entity.profileType === 'item' ? entity.profileType : '',
        profileId = text(entity.profileId,80), kind = text(entity.kind,40);
    if(profileType === 'npc' && !npcIds[profileId]) { profileType=''; profileId=''; }
    if(profileType === 'mob' && !mobIds[profileId]) { profileType=''; profileId=''; }
    if(profileType === 'item') { profileId=''; }
    if(profileType === '' && NPC_KINDS.indexOf(kind) < 0 && MOB_KINDS.indexOf(kind) < 0 && !STATIC_ITEM_KINDS.has(kind)) { kind='villager'; }
    return {id:text(entity.id,100)||id('entity'),x:int(entity.x,1,Math.max(1,map.width-1),1),y:int(entity.y,1,Math.max(1,map.height-1),1),kind:kind,profileType:profileType,profileId:profileId,source:entity.source === 'base' ? 'base' : 'editor'};
}
function normalizeMobAreas(list, width, height, mobProfiles) {
    if(!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 3 || height < 3) { return []; }
    var seen = new Set(), result = [], byId = Object.create(null);
    (Array.isArray(mobProfiles) ? mobProfiles : []).forEach(function(profile) {
        if(profile && typeof profile.id === 'string' && MOB_KINDS.includes(profile.baseKind)) {
            byId[profile.id] = profile.baseKind;
        }
    });
    if(!Array.isArray(list)) { return result; }
    list.slice(0, 2000).forEach(function(area) {
        if(!area || typeof area !== 'object' || Array.isArray(area)) { return; }
        var areaWidth = area.width === undefined ? area.w : area.width,
            areaHeight = area.height === undefined ? area.h : area.height,
            id = area.id, x = area.x, y = area.y, nb = area.nb,
            profileId = area.profileId == null ? '' : area.profileId,
            kind = area.type;
        if(![id, x, y, areaWidth, areaHeight, nb].every(Number.isSafeInteger) ||
           id < 0 || id > 999999 || seen.has(id) || x < 1 || y < 1 ||
           areaWidth < 1 || areaHeight < 1 || x + areaWidth >= width ||
           y + areaHeight >= height || nb < 1 || nb > 500 ||
           typeof profileId !== 'string' || profileId.length > 80 ||
           (profileId && !Object.prototype.hasOwnProperty.call(byId, profileId)) ||
           !MOB_KINDS.includes(kind) || (profileId && byId[profileId] !== kind)) { return; }
        seen.add(id);
        result.push({id:id, x:x, y:y, width:areaWidth, height:areaHeight, nb:nb,
                     type:kind, profileId:profileId});
    });
    return result;
}

function requireValidMobAreas(list, width, height, profiles) {
    if(list == null) { return; }
    if(!Array.isArray(list) || list.length > 2000 ||
       normalizeMobAreas(list, width, height, profiles).length !== list.length) {
        var error = new Error('Áreas de mobs inválidas: confira IDs, limites, quantidade, tipo e perfil de mob.');
        error.code = 'WORLD_MOB_AREA_VALIDATION';
        error.statusCode = 422;
        throw error;
    }
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
    WorldPublishTransaction.recover(this.versionsDir);
    this.storiesPath = options.storiesPath || path.join(path.dirname(this.statePath), 'stories.json');
    this.tilesetPath = options.tilesetPath || (this.baseClientMapPath ? path.join(path.dirname(this.baseClientMapPath), '..', 'img', '1', 'tilesheet.png') : null);
    this.tilesetUrl = options.tilesetUrl || '/img/1/tilesheet.png';
    this.base = readJson(this.baseMapPath);
    this.baseClient = this.baseClientMapPath ? readJson(this.baseClientMapPath) : null;
    this.tileCatalog = buildTileCatalog(this.baseClient, this.tilesetPath, this.tilesetUrl);
}
WorldStore.prototype.createInitialState = function() {
    return {schemaVersion:1,revision:1,status:'draft',updatedAt:new Date().toISOString(),publishedAt:null,map:buildEditableMap(this.base,this.baseClient,this.tileCatalog.maxTileId),npcs:[],mobs:[]};
};
WorldStore.prototype.load = function() {
    var state;
    try { state=readJson(this.statePath); }
    catch(error) { state=this.createInitialState(); atomicWrite(this.statePath,state); }
    return this.normalize(state);
};
WorldStore.prototype._publishedStories = function() {
    try {
        var data=readJson(this.storiesPath);
        return Array.isArray(data.stories) ? data.stories.filter(function(story){return story&&story.status==='published';}) : [];
    } catch(error) { return []; }
};
WorldStore.prototype.normalize = function(state) {
    state=state||{};
    var map=state.map||{}, npcs=Array.isArray(state.npcs)?state.npcs.slice(0,500).map(normalizeNpc):[],
        mobs=Array.isArray(state.mobs)?state.mobs.slice(0,500).map(normalizeMob):[], npcIds={},mobIds={},
        baseWidth=this.base.width,baseHeight=this.base.height,
        baseTileData=this.baseClient&&Array.isArray(this.baseClient.data)?this.baseClient.data:[],
        tiles={url:this.tileCatalog.url,tileSize:this.tileCatalog.tileSize,width:this.tileCatalog.width,height:this.tileCatalog.height,columns:this.tileCatalog.columns,rows:this.tileCatalog.rows,count:this.tileCatalog.count,measured:this.tileCatalog.measured};
    npcs.forEach(function(p){npcIds[p.id]=true;}); mobs.forEach(function(p){mobIds[p.id]=true;});
    map.width=baseWidth; map.height=baseHeight;
    map.data=normalizeTileData(map.data,baseTileData,baseWidth*baseHeight,this.tileCatalog.maxTileId);
    map.collisions=Array.isArray(map.collisions)?Array.from(new Set(map.collisions.map(Number).filter(function(v){return Number.isInteger(v)&&v>=0&&v<baseWidth*baseHeight;}))).sort(function(a,b){return a-b;}):[];
    map.doors=normalizeDoorLinks(map.doors,baseWidth,baseHeight);
    map.checkpoints=normalizeCheckpointAreas(map.checkpoints,baseWidth,baseHeight);
    map.chestAreas=normalizeChestAreas(map.chestAreas,baseWidth,baseHeight);
    map.staticChests=normalizeStaticChests(map.staticChests,baseWidth,baseHeight);
    map.entities=Array.isArray(map.entities)?map.entities.slice(0,10000).map(function(e){return normalizeEntity(e,map,npcIds,mobIds);}):[];
    map.roamingAreas=normalizeMobAreas(map.roamingAreas,baseWidth,baseHeight,mobs);
    return {schemaVersion:1,revision:int(state.revision,1,Number.MAX_SAFE_INTEGER,1),status:state.status==='published'?'published':'draft',updatedAt:state.updatedAt||new Date().toISOString(),publishedAt:state.publishedAt||null,map:map,npcs:npcs,mobs:mobs,catalogs:{npcKinds:NPC_KINDS.slice(),mobKinds:MOB_KINDS.slice(),chestItems:CHEST_ITEM_CATALOG.map(function(e){return {id:e.id,name:e.name};}),tiles:tiles}};
};
WorldStore.prototype.save = function(input) {
    var previous=this.load(),state;
    requireRawWorld(input,this.base.width,this.base.height,this.tileCatalog.maxTileId);
    requireValidStaticItems(input && input.map,this.base.width,this.base.height);
    requireValidChests(input && input.map,this.base.width,this.base.height);
    requireValidMobAreas(input && input.map && input.map.roamingAreas, this.base.width, this.base.height, input && input.mobs);
    requireValidDoorLinks(input && input.map && input.map.doors,this.base.width,this.base.height);
    state=this.normalize(input);
    requireStartingCheckpoint(state,this.base);
    state.revision=previous.revision+1; state.status='draft'; state.updatedAt=new Date().toISOString(); state.publishedAt=previous.publishedAt||null;
    atomicWrite(this.statePath,state); return state;
};
WorldStore.prototype.reset = function() { var state=this.createInitialState(); atomicWrite(this.statePath,state); return this.normalize(state); };
WorldStore.prototype.buildServerMap = function(state) {
    state=this.normalize(state||this.load());
    var map=state.map,published=clone(this.base),staticEntities={},editorMetadata={},npcById={},mobById={};
    state.npcs.forEach(function(p){npcById[p.id]=p;}); state.mobs.forEach(function(p){mobById[p.id]=p;});
    map.entities.forEach(function(entity){
        var tile=positionToTile(entity.x,entity.y,map.width),kind=entity.kind,metadata;
        if(entity.profileType==='npc'&&npcById[entity.profileId]){kind=npcById[entity.profileId].baseKind;metadata={type:'npc',profileId:entity.profileId};}
        else if(entity.profileType==='mob'&&mobById[entity.profileId]){kind=mobById[entity.profileId].baseKind;metadata={type:'mob',profileId:entity.profileId};}
        staticEntities[String(tile)]=kind; if(metadata){editorMetadata[String(tile)]=metadata;}
    });
    published.width=map.width; published.height=map.height; published.collisions=map.collisions.slice(); published.doors=clone(map.doors);
    published.checkpoints=clone(map.checkpoints); published.chestAreas=clone(map.chestAreas); published.staticChests=clone(map.staticChests); published.staticEntities=staticEntities;
    published.roamingAreas=map.roamingAreas.map(function(area){var out=clone(area);if(out.profileId&&mobById[out.profileId]){out.type=mobById[out.profileId].baseKind;}return out;});
    published.editorMetadata=editorMetadata; published.editorProfiles={npcs:npcById,mobs:mobById}; published.editorRevision=state.revision;
    return published;
};
WorldStore.prototype.buildClientMap = function(state) {
    if(!this.baseClient) { return null; }
    state=this.normalize(state||this.load());
    var client=clone(this.baseClient);
    client.width=state.map.width; client.height=state.map.height; client.data=state.map.data.slice(); client.collisions=state.map.collisions.slice();
    client.doors=clone(state.map.doors); client.checkpoints=clone(state.map.checkpoints); client.editorRevision=state.revision;
    return client;
};
WorldStore.prototype.validateDraft = function() {
    var raw=readJson(this.statePath),state=this.normalize(clone(raw));
    return validateRawWorld(raw,this.base.width,this.base.height,this.tileCatalog.maxTileId);
};
WorldStore.prototype.publish = function() {
    var rawDraft=readJson(this.statePath),
        state=this.normalize(clone(rawDraft)),
        validation=ReferenceValidator.validateWorldStoryReferences(state,this._publishedStories()),
        error,publishedMap,publishedClient,entries,stamp,result;
    requireRawWorld(rawDraft,this.base.width,this.base.height,this.tileCatalog.maxTileId);
    requireValidStaticItems(rawDraft.map,this.base.width,this.base.height);
    requireValidChests(rawDraft.map,this.base.width,this.base.height);
    requireValidMobAreas(rawDraft.map && rawDraft.map.roamingAreas,this.base.width,this.base.height,rawDraft.mobs);
    requireValidDoorLinks(rawDraft.map && rawDraft.map.doors,this.base.width,this.base.height);
    requireStartingCheckpoint(state,this.base);
    if(!validation.ok) {
        error=new Error('Referências de história inválidas no mundo: '+validation.errors.slice(0,6).map(function(item){return item.path+' — '+item.message;}).join(' | '));
        error.code='WORLD_STORY_REFERENCE_VALIDATION';error.details=validation.errors;error.statusCode=422;throw error;
    }
    publishedMap=this.buildServerMap(state);
    publishedClient=this.buildClientMap(state);
    stamp=new Date().toISOString();
    state.status='published';state.publishedAt=stamp;state.updatedAt=stamp;
    entries=[{dest:this.publishedMapPath,content:JSON.stringify(publishedMap,null,2)+'\n'}];
    if(publishedClient && this.publishedClientJsonPath && this.publishedClientJsPath) {
        entries.push({dest:this.publishedClientJsonPath,content:JSON.stringify(publishedClient,null,2)+'\n'});
        entries.push({dest:this.publishedClientJsPath,content:'var mapData = '+JSON.stringify(publishedClient)+';\n'});
    }
    entries.push({dest:this.statePath,content:JSON.stringify(state,null,2)+'\n'});
    result=WorldPublishTransaction.publish(entries,this.versionsDir,{revision:state.revision});
    return {ok:true,revision:state.revision,publishedAt:stamp,versionId:result.id,
        restartRequired:true,publishedMapPath:this.publishedMapPath,clientMapSynchronized:!!publishedClient};
};
WorldStore.prototype.listVersions = function() { return WorldPublishTransaction.list(this.versionsDir); };

WorldStore.prototype.getPublishedPath=function(){return fs.existsSync(this.publishedMapPath)?this.publishedMapPath:null;};

exports.WorldStore=WorldStore;
exports.NPC_KINDS=NPC_KINDS;
exports.MOB_KINDS=MOB_KINDS;
exports.normalizeTileData=normalizeTileData;
exports.buildTileCatalog=buildTileCatalog;
exports.readPngDimensions=readPngDimensions;
exports.normalizeCheckpointAreas=normalizeCheckpointAreas;
exports.normalizeDoorLinks=normalizeDoorLinks;
exports.normalizeMobAreas=normalizeMobAreas;
exports.requireValidMobAreas=requireValidMobAreas;
exports.chestItemCatalog=chestItemCatalog;
exports.normalizeStaticChests=normalizeStaticChests;
exports.normalizeChestAreas=normalizeChestAreas;
exports.requireValidChests=requireValidChests;
exports.requireValidStaticItems=requireValidStaticItems;
exports.requireValidDoorLinks=requireValidDoorLinks;
exports.validateRawWorld=validateRawWorld;
