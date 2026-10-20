'use strict';

/** Server-side validation for legacy client HURT messages. A client-provided
 * mob ID by itself is NOT evidence of a valid enemy attack.
 */
const MAX_HIT_DISTANCE = 1; // Orthogonal melee only; match client animation and navigation.
const MIN_HIT_INTERVAL_MS = 800; // Match legacy mob attack animation; server ticks cannot stack.

function canMobDamagePlayer(world, mob, player, now) {
    if(!world || !world.mobs || !world.entities || !mob || !player ||
       mob.type !== 'mob' || mob.isDead || !Number.isFinite(mob.hitPoints) ||
       mob.hitPoints <= 0 || player.type !== 'player' || player.isDead ||
       !Number.isFinite(player.hitPoints) || player.hitPoints <= 0) {
        return false;
    }
    // The exact entity must still exist in this world, not only its ID.
    if(world.mobs[mob.id] !== mob || world.entities[mob.id] !== mob) {
        return false;
    }
    if(mob.target !== player.id || !player.attackers || player.attackers[mob.id] !== mob) {
        return false;
    }
    // Avoid hits from mobs which this player's server-side subscription no
    // longer contains (e.g. stale group links after a roam or map edit).
    // A missing groups object is allowed only for isolated unit fixtures.
    if(world.groups && player.group && world.groups[player.group] &&
       world.groups[player.group].entities &&
       world.groups[player.group].entities[mob.id] !== mob) {
        return false;
    }
    // A mob standing inside an impassable tile cannot deal contact damage.
    if(world.map && typeof world.map.isColliding === 'function' &&
       (world.map.isColliding(mob.x, mob.y) ||
        world.map.isColliding(player.x, player.y))) {
        return false;
    }
    // A valid server attack must reach the player in real map coordinates.
    if(![mob.x,mob.y,player.x,player.y].every(Number.isFinite) ||
       Math.abs(mob.x - player.x) + Math.abs(mob.y - player.y) !== MAX_HIT_DISTANCE) {
        return false;
    }
    if(world.map && world.map.isProtectedSpawnTile &&
       world.map.isProtectedSpawnTile(player.x, player.y)) {
        return false;
    }
    const timestamp = Number.isFinite(now) ? now : Date.now();
    if(timestamp < (player.spawnProtectedUntil || 0)) {
        return false;
    }
    // Prevent duplicate/stale HURT messages from creating impossible damage.
    const times = player.lastMobHurtTimes;
    if(times && Number.isFinite(times[mob.id]) && timestamp - times[mob.id] < MIN_HIT_INTERVAL_MS) {
        return false;
    }
    return true;
}

module.exports = {canMobDamagePlayer, MAX_HIT_DISTANCE, MIN_HIT_INTERVAL_MS};
