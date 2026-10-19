'use strict';

// A beginner-safe region is the union of the initial (s === 1) checkpoint
// rectangles, expanded by the configured number of map tiles. Other
// checkpoints and mob territory remain unchanged.
// Smaller default retains a genuinely mob-free entry area but does not erase
// the original rat patrols. Published/editor-configured radii are respected.
const DEFAULT_RADIUS = 2;
const MAX_RADIUS = 20;
function normalizeRadius(value) {
    if(value === undefined || value === null) return DEFAULT_RADIUS;
    if(!Number.isInteger(value) || value < 0 || value > MAX_RADIUS) return DEFAULT_RADIUS;
    return value;
}
function isSafeStartingTile(checkpoints, x, y, radius) {
    const distance = normalizeRadius(radius);
    if(distance === 0 || !Number.isInteger(x) || !Number.isInteger(y)) return false;
    return (checkpoints || []).some(cp =>
        cp && cp.s === 1 &&
        Number.isInteger(cp.x) && Number.isInteger(cp.y) &&
        Number.isInteger(cp.w) && Number.isInteger(cp.h) &&
        x >= cp.x-distance && x < cp.x+cp.w+distance &&
        y >= cp.y-distance && y < cp.y+cp.h+distance);
}
module.exports = {DEFAULT_RADIUS, MAX_RADIUS, normalizeRadius, isSafeStartingTile};
