/* Small pixel-perfect art adapter for the existing BrowserQuest map.
 * Both PNGs contain ONLY in-game crops from the user-approved Sunnyside pack.
 * Never replace the original full tilesheet: its tile IDs are map metadata.
 */
(function(root) {
    'use strict';
    if(!root) return;
    function model(renderer) {
        return renderer && renderer.game && renderer.game.map;
    }
    function repaint(renderer) {
        if(typeof renderer.invalidateTerrainCache === 'function')
            renderer.invalidateTerrainCache();
        var map = model(renderer);
        if(map && map.isLoaded && renderer.background &&
           typeof renderer.renderStaticCanvases === 'function')
            renderer.renderStaticCanvases();
    }
    function load(renderer, property, src) {
        if(typeof root.Image !== 'function') return;
        var img = new root.Image();
        img.onload = function() {
            renderer[property] = img;
            repaint(renderer);
        };
        img.onerror = function() {
            // Missing optional art must never erase old grass, water or homes.
            renderer[property] = null;
        };
        img.src = src;
    }
    function paint(renderer, ctx, image, sx, sy, tileIndex, gridWidth) {
        if(!image || !ctx || typeof ctx.drawImage !== 'function') return false;
        var x = tileIndex % gridWidth, y = Math.floor(tileIndex / gridWidth),
            px = renderer.tilesize || 16, scale = renderer.scale || 1;
        ctx.drawImage(image, sx * 16, sy * 16, 16, 16,
                      x * px * scale, y * px * scale, px * scale, px * scale);
        return true;
    }
    root.BrowserQuestSunnysideArt = {
        attach: function(renderer) {
            if(!renderer || renderer._sunnysideAttached) return;
            renderer._sunnysideAttached = true;
            load(renderer, '_sunnysideTerrain', 'img/sunnyside/terrain-interior.png?v=20261020');
            load(renderer, '_sunnysideFurniture', 'img/sunnyside/house-furniture.png?v=20261020');
        },
        paintTile: function(renderer, ctx, oldTileId, tileIndex, gridWidth) {
            var layout = root.BrowserQuestSunnysideLayout,
                m = model(renderer),
                replacement = layout && layout.replacements[oldTileId + 1];
            if(!replacement || !renderer._sunnysideTerrain) return false;
            if(replacement.houseOnly &&
               (!layout.active(m) || !layout.inHouse(tileIndex % gridWidth,
                    Math.floor(tileIndex / gridWidth)))) return false;
            return paint(renderer, ctx, renderer._sunnysideTerrain,
                         replacement.x, replacement.y, tileIndex, gridWidth);
        },
        decorate: function(renderer, ctx, tileIndex, gridWidth) {
            var layout = root.BrowserQuestSunnysideLayout,
                m = model(renderer);
            if(!layout || !layout.active(m)) return false;
            var x = tileIndex % gridWidth, y = Math.floor(tileIndex / gridWidth),
                furniture = layout.furnitureAt(x,y);
            if(!furniture) return false;
            if(furniture.kind === 'carpet')
                return paint(renderer, ctx, renderer._sunnysideTerrain,
                             1, 1, tileIndex, gridWidth);
            return paint(renderer, ctx, renderer._sunnysideFurniture,
                         furniture.spriteX, 0, tileIndex, gridWidth);
        }
    };
})(typeof window !== 'undefined' ? window : null);
