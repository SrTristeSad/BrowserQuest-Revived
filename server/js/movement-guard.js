'use strict';
const STEP_MS = 120;
const MAX_CREDIT_MS = STEP_MS * 4;
function acceptStep(world, player, x, y, now = Date.now()) {
    if(!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !world.isValidPosition(x,y)) return false;
    const distance = Math.abs(x-player.x)+Math.abs(y-player.y);
    if(distance === 0) return true;
    if(distance !== 1) return false;
    // The client marks living mobs, NPCs and chests as occupied tiles.
    // The server must reject the same footprint before consuming a
    // movement credit, otherwise both sides disagree about collisions.
    if(typeof world.isPlayerTileBlocked === 'function' &&
       world.isPlayerTileBlocked(x, y, player.id)) return false;
    const elapsed = Math.max(0, now - (player.lastStepAt ?? now));
    const credit = Math.min(MAX_CREDIT_MS, (player.stepCreditMs ?? STEP_MS) + elapsed);
    if(credit < STEP_MS) return false;
    player.lastStepAt = now;
    player.stepCreditMs = credit - STEP_MS;
    return true;
}
module.exports = {acceptStep,STEP_MS,MAX_CREDIT_MS};
