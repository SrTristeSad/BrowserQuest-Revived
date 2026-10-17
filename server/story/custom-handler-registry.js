'use strict';

var HANDLER_KINDS = Object.freeze(['objective', 'reward']),
    RESERVED_IDS = Object.freeze(['__proto__', 'constructor', 'prototype']),
    PRIVATE = new WeakMap();

function normalizeKind(value) {
    var kind = String(value == null ? '' : value).trim();
    return HANDLER_KINDS.indexOf(kind) >= 0 ? kind : null;
}

function parseHandlerId(value) {
    if(typeof value !== 'string') { return null; }
    var id = value.trim();
    if(!id || id.length > 120 || !/^[A-Za-z0-9_-]+$/.test(id)) { return null; }
    if(RESERVED_IDS.indexOf(id.toLowerCase()) >= 0) { return null; }
    return id;
}

function buildState(definitions) {
    definitions = definitions == null ? {} : definitions;
    if(!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) {
        throw new Error('Custom handler definitions must be an object.');
    }

    Object.keys(definitions).forEach(function(kind) {
        if(!normalizeKind(kind)) {
            throw new Error('Unknown custom handler kind: ' + kind);
        }
    });

    var state = {
        objective: new Map(),
        reward: new Map()
    };

    HANDLER_KINDS.forEach(function(kind) {
        var group = definitions[kind];
        if(group == null) { return; }
        if(!group || typeof group !== 'object' || Array.isArray(group)) {
            throw new Error('Custom handler group must be an object: ' + kind);
        }

        Object.keys(group).forEach(function(rawId) {
            var id = parseHandlerId(rawId),
                handler = group[rawId];
            if(!id || id !== rawId) {
                throw new Error('Invalid custom handler id: ' + rawId);
            }
            if(typeof handler !== 'function') {
                throw new Error('Custom handler must be a function: ' + kind + '/' + id);
            }
            state[kind].set(id, handler);
        });
    });

    return state;
}

function CustomHandlerRegistry(definitions) {
    PRIVATE.set(this, buildState(definitions));
    Object.freeze(this);
}

CustomHandlerRegistry.prototype.resolve = function(kind, id) {
    var normalizedKind = normalizeKind(kind),
        normalizedId = parseHandlerId(id),
        state = PRIVATE.get(this);
    if(!normalizedKind || !normalizedId || !state) { return null; }
    return state[normalizedKind].get(normalizedId) || null;
};

CustomHandlerRegistry.prototype.has = function(kind, id) {
    return this.resolve(kind, id) !== null;
};

CustomHandlerRegistry.prototype.list = function(kind) {
    var normalizedKind = normalizeKind(kind),
        state = PRIVATE.get(this);
    if(!normalizedKind || !state) { return []; }
    return Array.from(state[normalizedKind].keys()).sort();
};

CustomHandlerRegistry.prototype.snapshot = function() {
    return {
        objective: this.list('objective'),
        reward: this.list('reward')
    };
};

exports.CustomHandlerRegistry = CustomHandlerRegistry;
exports.HANDLER_KINDS = HANDLER_KINDS;
exports.parseHandlerId = parseHandlerId;
exports.normalizeKind = normalizeKind;
