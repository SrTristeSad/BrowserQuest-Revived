/* BrowserQuest/Sunnyside opt-in visual mapping and the first existing house.
 * IDs below refer to BrowserQuest's 1-based Tiled map tile values.
 * The original map, doors, saves and its large spritesheet are unchanged.
 */
(function(root, factory) {
    'use strict';
    var layout = factory();
    if(typeof module === 'object' && module.exports) module.exports = layout;
    if(root) root.BrowserQuestSunnysideLayout = layout;
})(typeof window !== 'undefined' ? window : null, function() {
    'use strict';
    var house = {
        id: 'village-house-01',
        outside: {x: 51, y: 205, tx: 154, ty: 143},
        inside: {x: 154, y: 143, tx: 51, ty: 205},
        bounds: {left: 150, right: 158, top: 135, bottom: 142},
        furniture: [
            {x: 152, y: 138, kind: 'bed', solid: true, spriteX: 0},
            {x: 156, y: 139, kind: 'cabinet', solid: true, spriteX: 1},
            {x: 154, y: 140, kind: 'carpet', solid: false}
        ]
    };
    // Background color IDs determined from original four-tile ground groups.
    // Do not replace cliffs, buildings, tall tiles or their collision data.
    var grass = [15, 16, 35, 36, 155, 156, 175, 176],
        water = [179, 180, 199, 200],
        houseFloor = [1487, 1488, 1507, 1508],
        replacements = Object.create(null);
    grass.forEach(function(id) { replacements[id] = {x:0,y:0}; });
    water.forEach(function(id) { replacements[id] = {x:1,y:0}; });
    houseFloor.forEach(function(id) { replacements[id] = {x:0,y:1,houseOnly:true}; });
    function matchesDoor(doors, d, width) {
        if(Array.isArray(doors)) return doors.some(function(v) {
            return v.x === d.x && v.y === d.y && v.tx === d.tx && v.ty === d.ty;
        });
        if(!doors) return false;
        var link = doors[d.y * width + d.x + 1];
        return !!link && link.x === d.tx && link.y === d.ty;
    }
    function active(map) {
        return !!map && map.width === 172 && map.height === 314 &&
            matchesDoor(map.doors, house.outside, map.width) &&
            matchesDoor(map.doors, house.inside, map.width);
    }
    function inHouse(x, y) {
        return x >= house.bounds.left && x <= house.bounds.right &&
               y >= house.bounds.top && y <= house.bounds.bottom;
    }
    function furnitureAt(x, y) {
        for(var i=0;i<house.furniture.length;i+=1) {
            if(house.furniture[i].x === x && house.furniture[i].y === y)
                return house.furniture[i];
        }
        return null;
    }
    function solidCells(map) {
        return active(map) ? house.furniture.filter(function(f){return f.solid;}) : [];
    }
    return {
        house:house, replacements:replacements,
        active:active, inHouse:inHouse, furnitureAt:furnitureAt,
        solidCells:solidCells
    };
});
