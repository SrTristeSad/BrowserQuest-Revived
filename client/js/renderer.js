
define(['camera', 'item', 'character', 'player', 'timer'], 
function(Camera, Item, Character, Player, Timer) {

    var Renderer = Class.extend({
        init: function(game, canvas, background, foreground) {
            this.game = game;
            this.context = (canvas && canvas.getContext) ? canvas.getContext("2d") : null;
            this.background = (background && background.getContext) ? background.getContext("2d") : null;
            this.foreground = (foreground && foreground.getContext) ? foreground.getContext("2d") : null;
        
            this.canvas = canvas;
            this.backcanvas = background;
            this.forecanvas = foreground;

            this.initFPS();
            this.tilesize = 16;
        
            // Prefer the standard Canvas2D API. Older browsers may expose only a
            // vendor-prefixed smoothing control; both paths support crisp 1x art.
            this.upscaledRendering = typeof this.context.imageSmoothingEnabled === "boolean" ||
                typeof this.context.mozImageSmoothingEnabled === "boolean" ||
                typeof this.context.webkitImageSmoothingEnabled === "boolean" ||
                typeof this.context.msImageSmoothingEnabled === "boolean";
            this.supportsSilhouettes = this.upscaledRendering;
        
            this.rescale(this.getScaleFactor());
        
            this.lastTime = new Date();
            this.frameCount = 0;
            this.maxFPS = this.FPS;
            this.realFPS = 0;
            this.isDebugInfoVisible = false;
        
            this.animatedTileCount = 0;
            this.highTileCount = 0;
        
            this.fixFlickeringTimer = new Timer(100);
        },
    
        getWidth: function() {
            return this.canvas.width;
        },
    
        getHeight: function() {
            return this.canvas.height;
        },
    
        setTileset: function(tileset) {
            if(this.tileset !== tileset) {
                this.tileset = tileset;
                this.invalidateTerrainCache();
            }
        },

        // Terrain is immutable between published map loads. Keep only a small
        // least-recently-used window of rendered 8x8-tile regions in memory.
        invalidateTerrainCache: function() {
            this.terrainChunks = Object.create(null);
            this.terrainChunkOrder = [];
            this.terrainCacheMap = null;
            this.terrainCacheData = null;
            this.terrainCacheTileset = null;
            this.terrainCacheScale = null;
        },
    
        getScaleFactor: function() {
            var w = window.innerWidth,
                h = window.innerHeight,
                scale;
        
            this.mobile = false;
            this.tablet = Detect.isTablet(w);

            if(w <= 1000) {
                scale = 2;
                this.mobile = true;
            }
            else if(w <= 1500 || h <= 870) {
                scale = 2;
            }
            else {
                scale = 3;
            }
        
            return scale;
        },
    
        // Adapt the field of view to the display, bounded by the existing
        // adjacent-group subscription (28 x 12 tiles per server group).
        getCameraGrid: function() {
            var width = Math.max(1, window.innerWidth || 960),
                height = Math.max(1, (window.visualViewport ? window.visualViewport.height : window.innerHeight) || 540),
                aspect = width / Math.max(1, height - 52),
                gridW = 30,
                gridH = Math.round(gridW / aspect);
            if(gridH > 22) {
                gridH = 22;
                gridW = Math.round(gridH * aspect);
            }
            return {width: Math.max(14, Math.min(30, gridW)),
                    height: Math.max(10, Math.min(22, gridH))};
        },

        // Modern Canvas2D uses imageSmoothingEnabled; legacy prefixed flags
        // are maintained for compatibility with older BrowserQuest browsers.
        disableContextSmoothing: function(ctx) {
            if(!ctx) { return; }
            ctx.imageSmoothingEnabled = false;
            ctx.mozImageSmoothingEnabled = false;
            ctx.webkitImageSmoothingEnabled = false;
            ctx.msImageSmoothingEnabled = false;
        },

        disableSmoothing: function() {
            var self = this;
            [this.context, this.background, this.foreground].forEach(function(ctx) {
                self.disableContextSmoothing(ctx);
            });
        },

        rescale: function(factor) {
            this.scale = this.getScaleFactor();
            this.invalidateTerrainCache();

            this.createCamera();
        
            // Setting a canvas width/height resets the 2D context state.
            this.disableSmoothing();
        
            this.initFont();
            this.initFPS();
        
            if(!this.upscaledRendering && this.game.map && this.game.map.tilesets) {
                this.setTileset(this.game.map.tilesets[this.scale - 1]);
            }
            if(this.game.renderer) {
                this.game.setSpriteScale(this.scale);
            }
        },

        createCamera: function() {
            this.camera = new Camera(this);
            this.camera.rescale();
        
            this.canvas.width = this.camera.gridW * this.tilesize * this.scale;
            this.canvas.height = this.camera.gridH * this.tilesize * this.scale;
            log.debug("#entities set to "+this.canvas.width+" x "+this.canvas.height);
        
            this.backcanvas.width = this.canvas.width;
            this.backcanvas.height = this.canvas.height;
            log.debug("#background set to "+this.backcanvas.width+" x "+this.backcanvas.height);
        
            this.forecanvas.width = this.canvas.width;
            this.forecanvas.height = this.canvas.height;
            log.debug("#foreground set to "+this.forecanvas.width+" x "+this.forecanvas.height);

            // Match the DOM frame to the actual canvas, rather than a legacy
            // media-query height. fitGameViewport handles the final CSS scale.
            if(typeof document !== 'undefined' && document.getElementById) {
                var frame = document.getElementById('container'),
                    stage = document.getElementById('canvas'),
                    border = document.getElementById('canvasborder');
                if(frame && stage) {
                    frame.style.width = (this.canvas.width + this.scale * 10) + 'px';
                    stage.style.height = this.canvas.height + 'px';
                    if(border) { border.style.padding = (this.scale * 5) + 'px'; }
                    if(frame.style.setProperty) {
                        frame.style.setProperty('--bq-playercount-display', this.canvas.width < 700 ? 'none' : 'block');
                    }
                    var bubbles = document.getElementById('bubbles');
                    if(bubbles) {
                        bubbles.style.width = this.canvas.width + 'px';
                        bubbles.style.height = this.canvas.height + 'px';
                        bubbles.style.top = -this.canvas.height + 'px';
                        bubbles.style.marginBottom = -this.canvas.height + 'px';
                    }
                }
            }
            if(typeof window !== 'undefined' && window.fitGameViewport) { window.fitGameViewport(); }

            [this.canvas, this.backcanvas, this.forecanvas].forEach(function(canvas) {
                canvas.style.imageRendering = 'pixelated';
            });
        },
    
        initFPS: function() {
            this.FPS = this.mobile ? 50 : 50;
        },
    
        initFont: function() {
            var fontsize;
        
            switch(this.scale) {
                case 1:
                    fontsize = 10; break;
                case 2:
                    fontsize = Detect.isWindows() ? 10 : 13; break;
                case 3:
                    fontsize = 20;
            }
            this.setFontSize(fontsize);
        },
    
        setFontSize: function(size) {
            var font = size+"px GraphicPixel";
        
            this.context.font = font;
            this.background.font = font;
        },

        drawText: function(text, x, y, centered, color, strokeColor) {
            var ctx = this.context;
            
            var strokeSize;
        
            switch(this.scale) {
                case 1:
                    strokeSize = 3; break;
                case 2:
                    strokeSize = 3; break;
                case 3:
                    strokeSize = 5;
            }
            
            if(text && x && y) {
                ctx.save();
                if(centered) {
                    ctx.textAlign = "center";
                }
                ctx.strokeStyle = strokeColor || "#373737";
                ctx.lineWidth = strokeSize;
                ctx.strokeText(text, x, y);
                ctx.fillStyle = color || "white";
                ctx.fillText(text, x, y);
                ctx.restore();
            }
        },
    
        drawCellRect: function(x, y, color) {
            this.context.save();
            this.context.lineWidth = 2*this.scale;
            this.context.strokeStyle = color;
            this.context.translate(x+2, y+2);
            this.context.strokeRect(0, 0, (this.tilesize * this.scale) - 4, (this.tilesize * this.scale) - 4);
            this.context.restore();
        },

        drawCellHighlight: function(x, y, color) {
            var s = this.scale,
                ts = this.tilesize,
                tx = x * ts * s,
                ty = y * ts * s;
        
            this.drawCellRect(tx, ty, color);
        },
    
        drawTargetCell: function() {
            var mouse = this.game.getMouseGridPosition();
        
            if(this.game.targetCellVisible && !(mouse.x === this.game.selectedX && mouse.y === this.game.selectedY)) {
                this.drawCellHighlight(mouse.x, mouse.y, this.game.targetColor);
            }
        },
    
        drawAttackTargetCell: function() {
            var mouse = this.game.getMouseGridPosition(),
                entity = this.game.getEntityAt(mouse.x, mouse.y),
                s = this.scale;
        
            if(entity) {
                this.drawCellRect(entity.x * s, entity.y * s, "rgba(255, 0, 0, 0.5)");
            }
        },
    
        drawOccupiedCells: function() {
            var positions = this.game.entityGrid;
        
            if(positions) {
                for(var i=0; i < positions.length; i += 1) {
                    for(var j=0; j < positions[i].length; j += 1) {
                        if(!_.isNull(positions[i][j])) {
                            this.drawCellHighlight(i, j, "rgba(50, 50, 255, 0.5)");
                        }
                    }
                }
            }
        },
    
        drawPathingCells: function() {
            var grid = this.game.pathingGrid;
        
            if(grid && this.game.debugPathing) {
                for(var y=0; y < grid.length; y += 1) {
                    for(var x=0; x < grid[y].length; x += 1) {
                        if(grid[y][x] === 1 && this.game.camera.isVisiblePosition(x, y)) {
                            this.drawCellHighlight(x, y, "rgba(50, 50, 255, 0.5)");
                        }
                    }
                }
            }
        },

        drawSelectedCell: function() {
            var sprite = this.game.cursors["target"],
                anim = this.game.targetAnimation,
                os = this.upscaledRendering ? 1 : this.scale,
                ds = this.upscaledRendering ? this.scale : 1;
        
            if(this.game.selectedCellVisible) {
                if(this.mobile || this.tablet) {
                    if(this.game.drawTarget) {
                        var x = this.game.selectedX,
                            y = this.game.selectedY;
                        
                        this.drawCellHighlight(this.game.selectedX, this.game.selectedY, "rgb(51, 255, 0)");
                        this.lastTargetPos = { x: x,
                                               y: y };
                        this.game.drawTarget = false;
                    }
                } else {
                    if(sprite && anim) {
                        var	frame = anim.currentFrame,
                            s = this.scale,
                            x = frame.x * os,
                            y = frame.y * os,
                            w = sprite.width * os,
                            h = sprite.height * os,
                            ts = 16,
                            dx = this.game.selectedX * ts * s,
                            dy = this.game.selectedY * ts * s,
                            dw = w * ds,
                            dh = h * ds;

                        this.context.save();
                        this.context.translate(dx, dy);
                        this.context.drawImage(sprite.image, x, y, w, h, 0, 0, dw, dh);
                        this.context.restore();
                    }
                }
            }
        },
    
        clearScaledRect: function(ctx, x, y, w, h) {
            var s = this.scale;
        
            ctx.clearRect(x * s, y * s, w * s, h * s);
        },

        drawCursor: function() {
            var mx = this.game.mouse.x,
                my = this.game.mouse.y,
                s = this.scale,
                os = this.upscaledRendering ? 1 : this.scale;
        
            this.context.save();
            if(this.game.currentCursor && this.game.currentCursor.isLoaded) {
                this.context.drawImage(this.game.currentCursor.image, 0, 0, 14 * os, 14 * os, mx, my, 14*s, 14*s);
            }
            this.context.restore();
        },

        drawScaledImage: function(ctx, image, x, y, w, h, dx, dy) {
            var s = this.upscaledRendering ? 1 : this.scale;
            _.each(arguments, function(arg) {
                if(_.isUndefined(arg) || _.isNaN(arg) || _.isNull(arg) || arg < 0) {
                    log.error("x:"+x+" y:"+y+" w:"+w+" h:"+h+" dx:"+dx+" dy:"+dy, true);
                    throw Error("A problem occured when trying to draw on the canvas");
                }
            });
        
            ctx.drawImage(image,
                          x * s,
                          y * s,
                          w * s,
                          h * s,
                          dx * this.scale,
                          dy * this.scale,
                          w * this.scale,
                          h * this.scale);
        },

        drawTile: function(ctx, tileid, tileset, setW, gridW, cellid) {
            var s = this.upscaledRendering ? 1 : this.scale;
            if(tileid !== -1) { // -1 when tile is empty in Tiled. Don't attempt to draw it.
                this.drawScaledImage(ctx,
                                     tileset,
                                     getX(tileid + 1, (setW / s)) * this.tilesize,
                                     Math.floor(tileid / (setW / s)) * this.tilesize,
                                     this.tilesize,
                                     this.tilesize,
                                     getX(cellid + 1, gridW) * this.tilesize,
                                     Math.floor(cellid / gridW) * this.tilesize);
            }
        },
    
        clearTile: function(ctx, gridW, cellid) {
            var s = this.scale,
                ts = this.tilesize,
                x = getX(cellid + 1, gridW) * ts * s,
                y = Math.floor(cellid / gridW) * ts * s,
                w = ts * s,
                h = w;
        
            ctx.clearRect(x, y, h, w);
        },

        drawEntity: function(entity) {
            var sprite = entity.sprite,
                shadow = this.game.shadows["small"],
                anim = entity.currentAnimation,
                os = this.upscaledRendering ? 1 : this.scale,
                ds = this.upscaledRendering ? this.scale : 1;
        
            if(anim && sprite) {
                var	frame = anim.currentFrame,
                    s = this.scale,
                    x = frame.x * os,
                    y = frame.y * os,
                    w = sprite.width * os,
                    h = sprite.height * os,
                    ox = sprite.offsetX * s,
                    oy = sprite.offsetY * s,
                    dx = entity.x * s,
                    dy = entity.y * s,
                    dw = w * ds,
                    dh = h * ds;
            
                if(entity.isFading) {
                    this.context.save();
                    this.context.globalAlpha = entity.fadingAlpha;
                }
            
                if(!this.mobile && !this.tablet) {
                    this.drawEntityName(entity);
                }
            
                this.context.save();
                if(entity.flipSpriteX) {
                    this.context.translate(dx + this.tilesize*s, dy);
                    this.context.scale(-1, 1);
                }
                else if(entity.flipSpriteY) {
                    this.context.translate(dx, dy + dh);
                    this.context.scale(1, -1);
                }
                else {
                    this.context.translate(dx, dy);
                }
            
                if(entity.isVisible()) {
                    if(entity.hasShadow()) {
                        this.context.drawImage(shadow.image, 0, 0, shadow.width * os, shadow.height * os,
                                               0,
                                               entity.shadowOffsetY * ds,
                                               shadow.width * os * ds, shadow.height * os * ds);
                    }
                
                    this.context.drawImage(sprite.image, x, y, w, h, ox, oy, dw, dh);

                    if(entity instanceof Item && entity.kind !== Types.Entities.CAKE) {
                        var sparks = this.game.sprites["sparks"],
                            anim = this.game.sparksAnimation,
                            frame = anim.currentFrame,
                            sx = sparks.width * frame.index * os,
                            sy = sparks.height * anim.row * os,
                            sw = sparks.width * os,
                            sh = sparks.width * os;

                        this.context.drawImage(sparks.image, sx, sy, sw, sh,
                                               sparks.offsetX * s,
                                               sparks.offsetY * s,
                                               sw * ds, sh * ds);
                    }
                }
            
                if(entity instanceof Character && !entity.isDead && entity.hasWeapon()) {
                    var weapon = this.game.sprites[entity.getWeaponName()];
        
                    if(weapon) {
                        var weaponAnimData = weapon.animationData[anim.name],
                            index = frame.index < weaponAnimData.length ? frame.index : frame.index % weaponAnimData.length;
                            wx = weapon.width * index * os,
                            wy = weapon.height * anim.row * os,
                            ww = weapon.width * os,
                            wh = weapon.height * os;

                        this.context.drawImage(weapon.image, wx, wy, ww, wh,
                                               weapon.offsetX * s,
                                               weapon.offsetY * s,
                                               ww * ds, wh * ds);
                    }
                }
            
                this.context.restore();
            
                if(entity.isFading) {
                    this.context.restore();
                }
            }
        },

        drawEntities: function(dirtyOnly) {
            var self = this;
        
            this.game.forEachVisibleEntityByDepth(function(entity) {
                if(entity.isLoaded) {
                    if(dirtyOnly) {
                        if(entity.isDirty) {
                            self.drawEntity(entity);
                            
                            entity.isDirty = false;
                            entity.oldDirtyRect = entity.dirtyRect;
                            entity.dirtyRect = null;
                        }
                    } else {
                        self.drawEntity(entity);
                    }
                }
            });
        },
        
        drawDirtyEntities: function() {
            this.drawEntities(true);
        },
        
        clearDirtyRect: function(r) {
            this.context.clearRect(r.x, r.y, r.w, r.h);
        },
    
        clearDirtyRects: function() {
            var self = this,
                count = 0;
            
            this.game.forEachVisibleEntityByDepth(function(entity) {
                if(entity.isDirty && entity.oldDirtyRect) {
                    self.clearDirtyRect(entity.oldDirtyRect);
                    count += 1;
                }
            });
            
            this.game.forEachAnimatedTile(function(tile) {
                if(tile.isDirty) {
                    self.clearDirtyRect(tile.dirtyRect);
                    count += 1;
                }
            });
            
            if(this.game.clearTarget && this.lastTargetPos) {
                var last = this.lastTargetPos;
                    rect = this.getTargetBoundingRect(last.x, last.y);
                
                this.clearDirtyRect(rect);
                this.game.clearTarget = false;
                count += 1;
            }
            
            if(count > 0) {
                //log.debug("count:"+count);
            }
        },
        
        getEntityBoundingRect: function(entity) {
            var rect = {},
                s = this.scale,
                spr;
                
            if(entity instanceof Player && entity.hasWeapon()) {
                var weapon = this.game.sprites[entity.getWeaponName()];
                spr = weapon;
            } else {
                spr = entity.sprite;
            }
    
            if(spr) {
                rect.x = (entity.x + spr.offsetX - this.camera.x) * s;
                rect.y = (entity.y + spr.offsetY - this.camera.y) * s;
                rect.w = spr.width * s;
                rect.h = spr.height * s;
                rect.left = rect.x;
                rect.right = rect.x + rect.w;
                rect.top = rect.y;
                rect.bottom = rect.y + rect.h;
            }
            return rect;
        },
        
        getTileBoundingRect: function(tile) {
            var rect = {},
                gridW = this.game.map.width,
                s = this.scale,
                ts = this.tilesize,
                cellid = tile.index;
            
            rect.x = ((getX(cellid + 1, gridW) * ts) - this.camera.x) * s;
            rect.y = ((Math.floor(cellid / gridW) * ts) - this.camera.y) * s;
            rect.w = ts * s;
            rect.h = ts * s;
            rect.left = rect.x;
            rect.right = rect.x + rect.w;
            rect.top = rect.y;
            rect.bottom = rect.y + rect.h;
            
            return rect;
        },
        
        getTargetBoundingRect: function(x, y) {
            var rect = {},
                s = this.scale,
                ts = this.tilesize,
                tx = x || this.game.selectedX,
                ty = y || this.game.selectedY;
            
            rect.x = ((tx * ts) - this.camera.x) * s;
            rect.y = ((ty * ts) - this.camera.y) * s;
            rect.w = ts * s;
            rect.h = ts * s;
            rect.left = rect.x;
            rect.right = rect.x + rect.w;
            rect.top = rect.y;
            rect.bottom = rect.y + rect.h;
            
            return rect;
        },
        
        isIntersecting: function(rect1, rect2) {
            return !((rect2.left > rect1.right) ||
                     (rect2.right < rect1.left) ||
                     (rect2.top > rect1.bottom) ||
                     (rect2.bottom < rect1.top));
        },
        
        drawEntityName: function(entity) {
            this.context.save();
            if(entity.name && entity instanceof Player) {
                var color = (entity.id === this.game.playerId) ? "#fcda5c" : "white";
                this.drawText(entity.name,
                              (entity.x + 8) * this.scale,
                              (entity.y + entity.nameOffsetY) * this.scale,
                              true,
                              color);
            }
            this.context.restore();
        },

        // Keep the original visible-tile painter as a fallback for contexts
        // where a secondary canvas cannot be created.
        drawTerrainUncached: function() {
            var self = this,
                m = this.game.map,
                tilesetwidth = this.tileset.width / m.tilesize;

            this.game.forEachVisibleTile(function(id, index) {
                if(!m.isHighTile(id) && !m.isAnimatedTile(id)) {
                    self.drawTile(self.background, id, self.tileset, tilesetwidth, m.width, index);
                }
            }, 1);
        },

        createTerrainChunk: function(m, chunkX, chunkY, tilesetwidth) {
            var canvas, ctx,
                size = 8,
                startX = chunkX * size,
                startY = chunkY * size,
                self = this;

            try {
                canvas = document.createElement('canvas');
                if(!canvas || !canvas.getContext) { return null; }
                canvas.width = size * this.tilesize * this.scale;
                canvas.height = size * this.tilesize * this.scale;
                ctx = canvas.getContext('2d');
            } catch(error) {
                return null;
            }
            if(!ctx) { return null; }
            this.disableContextSmoothing(ctx);

            // Existing map cells may contain multiple stacked tile IDs.
            // Preserve their order and leave high/animated tiles to their
            // original render passes (including collision/doors unchanged).
            ctx.save();
            ctx.translate(-startX * this.tilesize * this.scale,
                -startY * this.tilesize * this.scale);
            function paint(id, tileIndex) {
                var tile = Number(id) - 1;
                if(!isFinite(tile) || tile === -1 ||
                    m.isHighTile(tile) || m.isAnimatedTile(tile)) { return; }
                self.drawTile(ctx, tile, self.tileset, tilesetwidth, m.width, tileIndex);
            }
            for(var y = startY; y < Math.min(m.height, startY + size); y += 1) {
                for(var x = startX; x < Math.min(m.width, startX + size); x += 1) {
                    var index = y * m.width + x,
                        cell = m.data[index];
                    if(Array.isArray(cell)) {
                        cell.forEach(function(id) { paint(id, index); });
                    } else {
                        paint(cell, index);
                    }
                }
            }
            ctx.restore();
            return canvas;
        },

        getTerrainChunk: function(m, chunkX, chunkY, tilesetwidth) {
            var key = chunkX + ':' + chunkY,
                chunk = this.terrainChunks[key],
                order = this.terrainChunkOrder;
            if(chunk) {
                order.splice(order.indexOf(key), 1);
                order.push(key);
                return chunk;
            }
            chunk = this.createTerrainChunk(m, chunkX, chunkY, tilesetwidth);
            if(!chunk) { return null; }
            this.terrainChunks[key] = chunk;
            order.push(key);
            // 24 regions of 8x8 cells: bounded memory on phones/desktop.
            if(order.length > 24) {
                delete this.terrainChunks[order.shift()];
            }
            return chunk;
        },

        drawTerrain: function() {
            var m = this.game.map;
            // A not-yet-loaded map has no terrain to draw.
            if(!m || !m.isLoaded || !this.tileset) { return; }
            if(typeof document === 'undefined' || !document.createElement) {
                this.drawTerrainUncached();
                return;
            }
            if(this.terrainCacheMap !== m || this.terrainCacheData !== m.data ||
                this.terrainCacheTileset !== this.tileset ||
                this.terrainCacheScale !== this.scale) {
                this.invalidateTerrainCache();
                this.terrainCacheMap = m;
                this.terrainCacheData = m.data;
                this.terrainCacheTileset = this.tileset;
                this.terrainCacheScale = this.scale;
            }

            var size = 8,
                camera = this.camera,
                firstX = Math.max(0, camera.gridX - 1),
                firstY = Math.max(0, camera.gridY - 1),
                lastX = Math.min(m.width - 1, camera.gridX + camera.gridW),
                lastY = Math.min(m.height - 1, camera.gridY + camera.gridH),
                tilesetwidth = this.tileset.width / m.tilesize;

            for(var cy = Math.floor(firstY / size); cy <= Math.floor(lastY / size); cy += 1) {
                for(var cx = Math.floor(firstX / size); cx <= Math.floor(lastX / size); cx += 1) {
                    var chunk = this.getTerrainChunk(m, cx, cy, tilesetwidth);
                    if(!chunk) {
                        this.drawTerrainUncached();
                        return;
                    }
                    this.background.drawImage(chunk,
                        cx * size * this.tilesize * this.scale,
                        cy * size * this.tilesize * this.scale);
                }
            }
        },
    
        drawAnimatedTiles: function(dirtyOnly) {
            var self = this,
                m = this.game.map,
                tilesetwidth = this.tileset.width / m.tilesize;
        
            this.animatedTileCount = 0;
            this.game.forEachAnimatedTile(function (tile) {
                if(dirtyOnly) {
                    if(tile.isDirty) {
                        self.drawTile(self.context, tile.id, self.tileset, tilesetwidth, m.width, tile.index);
                        tile.isDirty = false;
                    }
                } else {
                    self.drawTile(self.context, tile.id, self.tileset, tilesetwidth, m.width, tile.index);
                    self.animatedTileCount += 1;
                }
            });
        },
        
        drawDirtyAnimatedTiles: function() {
            this.drawAnimatedTiles(true);
        },
    
        drawHighTiles: function(ctx) {
            var self = this,
                m = this.game.map,
                tilesetwidth = this.tileset.width / m.tilesize;
        
            this.highTileCount = 0;
            this.game.forEachVisibleTile(function (id, index) {
                if(m.isHighTile(id)) {
                    self.drawTile(ctx, id, self.tileset, tilesetwidth, m.width, index);
                    self.highTileCount += 1;
                }
            }, 1);
        },

        drawBackground: function(ctx, color) {
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        },

        drawFPS: function() {
            var nowTime = new Date(),
                diffTime = nowTime.getTime() - this.lastTime.getTime();

            if (diffTime >= 1000) {
                this.realFPS = this.frameCount;
                this.frameCount = 0;
                this.lastTime = nowTime;
            }
            this.frameCount++;
        
            //this.drawText("FPS: " + this.realFPS + " / " + this.maxFPS, 30, 30, false);
            this.drawText("FPS: " + this.realFPS, 30, 30, false);
        },
    
        drawDebugInfo: function() {
            if(this.isDebugInfoVisible) {
                this.drawFPS();
                this.drawText("A: " + this.animatedTileCount, 100, 30, false);
                this.drawText("H: " + this.highTileCount, 140, 30, false);
            }
        },
    
        drawCombatInfo: function() {
            var self = this;
        
            switch(this.scale) {
                case 2: this.setFontSize(20); break;
                case 3: this.setFontSize(30); break;
            }
            this.game.infoManager.forEachInfo(function(info) {
                self.context.save();
                self.context.globalAlpha = info.opacity;
                self.drawText(info.value, (info.x + 8) * self.scale, Math.floor(info.y * self.scale), true, info.fillColor, info.strokeColor);
                self.context.restore();
            });
            this.initFont();
        },
    
        setCameraView: function(ctx) {
            ctx.translate(-this.camera.x * this.scale, -this.camera.y * this.scale);
        },
    
        clearScreen: function(ctx) {
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        },
    
        getPlayerImage: function() {
            var canvas = document.createElement('canvas'),
    	        ctx = canvas.getContext('2d'),
    	        os = this.upscaledRendering ? 1 : this.scale,
    	        player = this.game.player,
    	        sprite = player.getArmorSprite(),
    	        spriteAnim = sprite.animationData["idle_down"],
    	        // character
    	        row = spriteAnim.row,
                w = sprite.width * os,
                h = sprite.height * os,
    	        y = row * h,
    	        // weapon
    	        weapon = this.game.sprites[this.game.player.getWeaponName()],
    	        ww = weapon.width * os,
    	        wh = weapon.height * os,
    	        wy = wh * row,
    	        offsetX = (weapon.offsetX - sprite.offsetX) * os,
    	        offsetY = (weapon.offsetY - sprite.offsetY) * os,
    	        // shadow
    	        shadow = this.game.shadows["small"],
    	        sw = shadow.width * os,
    	        sh = shadow.height * os,
    	        ox = -sprite.offsetX * os;
    	        oy = -sprite.offsetY * os;
	    
    	    canvas.width = w;
    	    canvas.height = h;
	    
    	    ctx.clearRect(0, 0, w, h);
    	    ctx.drawImage(shadow.image, 0, 0, sw, sh, ox, oy, sw, sh);
    	    ctx.drawImage(sprite.image, 0, y, w, h, 0, 0, w, h);
            ctx.drawImage(weapon.image, 0, wy, ww, wh, offsetX, offsetY, ww, wh);
        
            return canvas.toDataURL("image/png");
        },
    
        renderStaticCanvases: function() {
            // The camera can move into areas with transparent/missing terrain.
            // Always invalidate the old static layer before painting its view.
            this.clearScreen(this.background);
            // Centering on the player at the edge of the finite map can
            // expose off-map pixels. Give them a quiet natural backdrop
            // instead of black/transparent strips around the world.
            this.drawBackground(this.background, '#263c30');
            this.background.save();
                this.setCameraView(this.background);
                this.drawTerrain();
            this.background.restore();
        
            if(this.mobile || this.tablet) {
                this.clearScreen(this.foreground);
                this.foreground.save();
                    this.setCameraView(this.foreground);
                    this.drawHighTiles(this.foreground);
                this.foreground.restore();
            }
        },

        renderFrame: function() {
            if(this.mobile || this.tablet) {
                this.renderFrameMobile();
            }
            else {
                this.renderFrameDesktop();
            }
        },
    
        renderFrameDesktop: function() {
            this.clearScreen(this.context);
        
            this.context.save();
                this.setCameraView(this.context);
                this.drawAnimatedTiles();
            
                if(this.game.started) {
                    this.drawSelectedCell();
                    this.drawTargetCell();
                }

                //this.drawOccupiedCells();
                this.drawPathingCells();
                this.drawEntities();
                this.drawCombatInfo();
                this.drawHighTiles(this.context);
            this.context.restore();
        
            // Overlay UI elements
            this.drawCursor();
            this.drawDebugInfo();
        },
    
        renderFrameMobile: function() {
            if(this.cameraMoved) {
                // Dirty rectangles are not valid after the camera shifts.
                // Repaint all visible characters and animations exactly
                // once for this camera position, not just changed sprites.
                this.cameraMoved = false;
                this.clearScreen(this.context);
                this.context.save();
                    this.setCameraView(this.context);
                    this.drawAnimatedTiles();
                    this.drawSelectedCell();
                    this.drawEntities();
                    this.drawCombatInfo();
                this.context.restore();
                return;
            }
            this.clearDirtyRects();
            this.preventFlickeringBug();

            this.context.save();
                this.setCameraView(this.context);
                
                this.drawDirtyAnimatedTiles();
                this.drawSelectedCell();
                this.drawDirtyEntities();
            this.context.restore();
        },
        
        preventFlickeringBug: function() {
            if(this.fixFlickeringTimer.isOver(this.game.currentTime)) {
                this.background.fillRect(0, 0, 0, 0);
                this.context.fillRect(0, 0, 0, 0);
                this.foreground.fillRect(0, 0, 0, 0);
            }
        }
    });

    var getX = function(id, w) {
        if(id == 0) {
            return 0;
        }
        return (id % w == 0) ? w - 1 : (id % w) - 1;
    };
    
    return Renderer;
});
