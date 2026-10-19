
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

        // Keep the character centered by tracking its current pixel position,
        // not an old 15x7-page boundary. Clamp the viewport to map edges so
        // its background never scrolls into empty, off-map space.
        getCenteredPosition: function(entity) {
            var ts = (this.renderer && this.renderer.tilesize) || 16,
                map = this.renderer && this.renderer.game && this.renderer.game.map,
                px = Number.isFinite(entity.x) ? entity.x : entity.gridX * ts,
                py = Number.isFinite(entity.y) ? entity.y : entity.gridY * ts,
                x = px + ts / 2 - this.gridW * ts / 2,
                y = py + ts / 2 - this.gridH * ts / 2;
            if(map && Number.isFinite(map.width) && Number.isFinite(map.height) &&
               map.width > 0 && map.height > 0) {
                x = Math.max(0, Math.min(x, Math.max(0, (map.width - this.gridW) * ts)));
                y = Math.max(0, Math.min(y, Math.max(0, (map.height - this.gridH) * ts)));
            }
            return {x: Math.round(x), y: Math.round(y)};
        },

        lookAt: function(entity) {
            var position = this.getCenteredPosition(entity);
            this.setPosition(position.x, position.y);
        },

        forEachVisiblePosition: function(callback, extra) {
            var extra = extra || 0;
            for(var y=this.gridY-extra, maxY=this.gridY+this.gridH+(extra*2); y < maxY; y += 1) {
                for(var x=this.gridX-extra, maxX=this.gridX+this.gridW+(extra*2); x < maxX; x += 1) {
                    callback(x, y);
                }
            }
        },
        
        isVisible: function(entity) {
            return this.isVisiblePosition(entity.gridX, entity.gridY);
        },
        
        isVisiblePosition: function(x, y) {
            if(y >= this.gridY && y < this.gridY + this.gridH
            && x >= this.gridX && x < this.gridX + this.gridW) {
                return true;
            } else {
                return false;
            }
        },
    
        focusEntity: function(entity) {
            this.lookAt(entity);
        }
    });

    return Camera;
});
