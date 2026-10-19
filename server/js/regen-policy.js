'use strict';

// Gradual out-of-combat healing. The old world loop restored ~4% of max HP
// every two seconds, even under enemy fire, making weak enemies ineffective.
const DAMAGE_RECOVERY_DELAY_MS = 10000;
const REGEN_INTERVAL_MS = 6000;
const REGEN_PERCENT = 0.01;
const MAX_REGEN_PER_TICK = 3;

function noteDamage(character, at) {
    if(!character) { return; }
    const time = Number.isFinite(at) ? at : Date.now();
    character.lastDamagedAt = time;
    character.lastRegenAt = time;
}

function getRegenAmount(character, now) {
    const time = Number.isFinite(now) ? now : Date.now();
    if(!character || character.isDead ||
        !Number.isFinite(character.hitPoints) ||
        !Number.isFinite(character.maxHitPoints) ||
        character.maxHitPoints <= 0 ||
        character.hitPoints <= 0 ||
        character.hitPoints >= character.maxHitPoints) {
        return 0;
    }
    // Characters cannot regenerate while an actual fight is active.
    if(character.hasTarget && character.hasTarget()) { return 0; }
    if(character.attackers && Object.keys(character.attackers).length) { return 0; }
    if(time - (character.lastDamagedAt || 0) < DAMAGE_RECOVERY_DELAY_MS ||
       time - (character.lastRegenAt || 0) < REGEN_INTERVAL_MS) {
        return 0;
    }
    const amount = Math.max(1, Math.min(MAX_REGEN_PER_TICK,
        Math.floor(character.maxHitPoints * REGEN_PERCENT)));
    return Math.min(amount, character.maxHitPoints - character.hitPoints);
}

function recover(character, now) {
    const amount = getRegenAmount(character, now);
    if(!amount) { return 0; }
    character.regenHealthBy(amount);
    character.lastRegenAt = Number.isFinite(now) ? now : Date.now();
    return amount;
}

module.exports = {
    noteDamage, getRegenAmount, recover,
    DAMAGE_RECOVERY_DELAY_MS, REGEN_INTERVAL_MS,
    MAX_REGEN_PER_TICK
};
