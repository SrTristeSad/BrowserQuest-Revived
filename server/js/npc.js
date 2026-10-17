module.exports = Npc = Entity.extend({
    init: function(id, kind, x, y, editorData) {
        this._super(id, "npc", kind, x, y);
        this.editorData = editorData || null;
    },

    getState: function() {
        var state = this._getBaseState();
        if(this.editorData) {
            state.push(this.editorData);
        }
        return state;
    }
});
