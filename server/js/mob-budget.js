'use strict';

// Cap actual enemies in a local tile neighbourhood, not merely the number
// configured in one rectangular spawn area. Never spawn on top of a player,
// into an already occupied mob tile or onto an invisible/blocked map tile.
const DEFAULT_NEARBY_MAX = 10;
const MAX_NEARBY_MAX = 24;
const RADIUS = 14;
const PLAYER_DISTANCE = 6;
function normalizeLimit(value) {
    return Number.isInteger(value) && value>=1 && value<=MAX_NEARBY_MAX ? value : DEFAULT_NEARBY_MAX;
}
function canSpawn(world,x,y) {
    if(!world || !world.isValidPosition(x,y)) return false;
    if(world.map && world.map.isProtectedSpawnTile && world.map.isProtectedSpawnTile(x,y)) return false;
    const limit=normalizeLimit(world.map && world.map.maxNearbyMobs);
    let nearby=0, occupied=false, nearPlayer=false;
    const mobs=world.mobs||{}, players=world.players||{};
    Object.keys(mobs).forEach(id=>{
        const mob=mobs[id];
        if(!mob||mob.isDead)return;
        const dx=Math.abs(mob.x-x),dy=Math.abs(mob.y-y);
        if(!dx&&!dy) occupied=true;
        if(Math.max(dx,dy)<=RADIUS) nearby++;
    });
    Object.keys(players).forEach(id=>{
        const player=players[id];
        if(player&&!player.isDead&&Math.max(Math.abs(player.x-x),Math.abs(player.y-y))<PLAYER_DISTANCE){
            nearPlayer=true;
        }
    });
    return !occupied && !nearPlayer && nearby<limit;
}
module.exports={DEFAULT_NEARBY_MAX,MAX_NEARBY_MAX,RADIUS,PLAYER_DISTANCE,normalizeLimit,canSpawn};
