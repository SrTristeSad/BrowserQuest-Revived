/* Deterministic world clock: server and client use the same UTC epoch,
 * avoiding a new WebSocket message type. Minutes are real-time minutes.
 * No feature relies on the browser's timezone. */
(function(root, factory) {
    if(typeof define === 'function' && define.amd) {
        define(factory);
    } else if(typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.BQDayCycle = factory();
    }
}(this, function() {
    'use strict';
    var DEFAULTS = {enabled:true, dayMinutes:20, nightMinutes:10};
    function normalize(value) {
        var config = value && typeof value === 'object' ? value : {};
        return {
            enabled: config.enabled !== false,
            dayMinutes: Number.isInteger(config.dayMinutes) && config.dayMinutes >= 5 && config.dayMinutes <= 60 ? config.dayMinutes : DEFAULTS.dayMinutes,
            nightMinutes: Number.isInteger(config.nightMinutes) && config.nightMinutes >= 5 && config.nightMinutes <= 30 ? config.nightMinutes : DEFAULTS.nightMinutes
        };
    }
    function phase(when, value) {
        var config = normalize(value), elapsed;
        if(!config.enabled) { return 'day'; }
        var dayMs = config.dayMinutes * 60000,
            nightMs = config.nightMinutes * 60000,
            total = dayMs + nightMs;
        elapsed = ((Number(when) || 0) % total + total) % total;
        if(elapsed >= dayMs) { return elapsed >= total - 60000 ? 'dawn' : 'night'; }
        return elapsed >= dayMs - 60000 ? 'dusk' : 'day';
    }
    function isPeriodActive(period, when, config) {
        if(!period || period === 'always') return true;
        var current = phase(when, config);
        return period === 'night' ? current === 'night' : current !== 'night';
    }
    return {normalize:normalize, phase:phase, isPeriodActive:isPeriodActive};
}));
