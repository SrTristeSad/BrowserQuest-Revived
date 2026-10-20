
define(function() {

    var Camera = Class.extend({
        init: function(renderer) {
            this.renderer = renderer;
            this.x = 0;
            this.y = 0;
            this.gridX = 0;
            this.gridY = 0;
            this.offset = 0.5;
            this.rescale();
        },
    
        rescale: function() {
            var factor = this.renderer.mobile ? 1 : 2;
        
            var grid = this.renderer.getCameraGrid ? this.renderer.getCameraGrid() : null;
            this.gridW = grid ? grid.width : 15 * factor;
            this.gridH = grid ? grid.height : 7 * factor;
        
            log.debug("---------");
            log.debug("Factor:"+factor);
            log.debug("W:"+this.gridW + " H:" + this.gridH);
        },

        setPosition: function(x, y) {
            this.x = x;
            this.y = y;
    
            this.gridX = Math.floor( x / 16 );
            this.gridY = Math.floor( y / 16 );
        },

        setGridPosition: function(x, y) {
            this.gridX = x;
            this.gridY = y;
        
            this.x = this.gridX * 16;
            this.y = this.gridY * 16;
        },

        // A fixed-on-player camera: the center is the player's rendered tile
        // center at all world positions, including near map boundaries.
        getCenteredPosition: function(entity) {
            var ts = (this.renderer && this.renderer.tilesize) || 16,
                px = Number.isFinite(entity.x) ? entity.x : entity.gridX * ts,
                py = Number.isFinite(entity.y) ? entity.y : entity.gridY * ts;
            return {
                x: Math.round(px + ts / 2 - this.gridW * ts / 2),
                y: Math.round(py + ts / 2 - this.gridH * ts / 2)
            };
        },

        lookAt: function(entity) {
            var position = this.getCenteredPosition(entity);
            this.setPosition(position.x, position.y);
        },

        // Include the partially visible row and column during smooth
        // pixel scrolling. Using gridX + gridW omits the right/bottom edge
        // whenever the camera is not aligned to a tile.
        getVisibleTileBounds: function(extra) {
            var ts = (this.renderer && this.renderer.tilesize) || 16,
                margin = Math.max(0, Math.floor(Number(extra) || 0));
            return {
                left: Math.floor(this.x / ts) - margin,
                top: Math.floor(this.y / ts) - margin,
                right: Math.ceil((this.x + this.gridW * ts) / ts) + margin,
                bottom: Math.ceil((this.y + this.gridH * ts) / ts) + margin
            };
        },

        forEachVisiblePosition: function(callback, extra) {
            var bounds = this.getVisibleTileBounds(extra);
            for(var y = bounds.top; y < bounds.bottom; y += 1) {
                for(var x = bounds.left; x < bounds.right; x += 1) {
                    callback(x, y);
                }
            }
        },
        
        isVisible: function(entity) {
            return this.isVisiblePosition(entity.gridX, entity.gridY);
        },
        
        isVisiblePosition: function(x, y) {
            var bounds = this.getVisibleTileBounds(0);
            return x >= bounds.left && x < bounds.right &&
                   y >= bounds.top && y < bounds.bottom;
        },
    
        focusEntity: function(entity) {
            this.lookAt(entity);
        }
    });

    return Camera;
});
