
var cls = require('./lib/class'),
    _ = require('underscore'),
    Utils = require('./utils'),
    Types = require("../../shared/js/gametypes");

module.exports = Checkpoint = cls.Class.extend({
    init: function(id, x, y, width, height) {
        this.id = id;
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    },

    containsPosition: function(x, y) {
        return _.isNumber(x)
            && _.isNumber(y)
            && x >= this.x
            && y >= this.y
            && x < this.x + this.width
            && y < this.y + this.height;
    },

    getVisitLocationId: function() {
        var checkpointId = String(this.id == null ? '' : this.id).trim();
        return checkpointId ? 'checkpoint:' + checkpointId : '';
    },
    
    getRandomPosition: function() {
        var pos = {};
        
        pos.x = this.x + Utils.randomInt(0, this.width - 1);
        pos.y = this.y + Utils.randomInt(0, this.height - 1);
        return pos;
    }
});