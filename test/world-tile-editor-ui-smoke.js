'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path');

var source = fs.readFileSync(path.join(__dirname, '..', 'server', 'admin', 'public', 'world-editor.html'), 'utf8');

assert(source.includes('id="tilesetPalette"'), 'World Editor should expose a visual tileset palette');
assert(source.includes('value="tile">Lápis de terreno'), 'World Editor should expose the terrain pencil');
assert(source.includes('value="erase">Borracha de terreno'), 'World Editor should expose the terrain eraser');
assert(source.includes('value="rect">Selecionar terreno'), 'World Editor should expose rectangular terrain selection');
assert(source.includes('value="fill">Preencher área contígua'), 'World Editor should expose contiguous flood fill');
assert(source.includes('data-quick="rect">Retângulo'), 'toolbar should expose rectangle selection');
assert(source.includes('data-quick="fill">Preencher'), 'toolbar should expose flood fill');
assert(source.includes('id="paintTerrainSelection"'), 'terrain selection should offer batch painting');
assert(source.includes('id="eraseTerrainSelection"'), 'terrain selection should offer batch erasing');
assert(source.includes('id="blockTerrainSelection"'), 'terrain selection should offer batch collision add');
assert(source.includes('id="unblockTerrainSelection"'), 'terrain selection should offer batch collision removal');
assert(source.includes('Colisão: ${collision.blocked}/${collision.total} células bloqueadas'), 'selection should display collision coverage');
assert(source.includes('terrainTools.paintRectangle'), 'selection actions should use the validated terrain algorithm');
assert(source.includes('terrainTools.floodFill'), 'fill UI should use the bounded iterative algorithm');
assert(source.includes('terrainTools.applyCollisionRectangle'), 'collision UI should use the normalized batch algorithm');
assert(source.includes('terrainTools.normalizeCollisions'), 'draft collisions should be normalized');
assert(source.includes('16 px/tile · nativo'), 'World Editor should expose native-size terrain preview');
assert(source.includes('state.map.data[i]=next'), 'terrain pencil must edit the draft tile array locally');
assert(source.includes("const next=erase?-1:selectedTile"), 'eraser should write the legacy empty tile marker');
assert(source.includes('ctx.imageSmoothingEnabled=false'), 'terrain preview should preserve pixel-art rendering');
assert(source.includes('pctx.imageSmoothingEnabled=false'), 'tileset palette should preserve pixel-art rendering');
assert(source.includes('id>=0&&id<cat.count'), 'palette selection must stay inside the server-provided catalog');
assert(source.includes("tilesetImage.src=cat.url"), 'tileset image should come from the server-provided safe catalog URL');

var paintStart = source.indexOf('function paintCell('),
    paintEnd = source.indexOf('function applyTerrainSelection', paintStart),
    paintSource = source.slice(paintStart, paintEnd);
assert(paintStart >= 0 && paintEnd > paintStart, 'paintCell should exist');
assert(!paintSource.includes('api('), 'painting a tile must not issue a network request per cell');
assert(!paintSource.includes('fetch('), 'painting a tile must remain local until draft save');

var selectionStart = source.indexOf('function applyTerrainSelection('),
    selectionEnd = source.indexOf('function nearestEntity', selectionStart),
    selectionSource = source.slice(selectionStart, selectionEnd);
assert(selectionStart >= 0 && selectionEnd > selectionStart, 'terrain/collision selection application should exist');
assert(selectionSource.includes('function applyCollisionSelection('), 'collision selection helper should live beside terrain selection');
assert(!selectionSource.includes('api('), 'batch terrain/collision selection must remain local until draft save');
assert(!selectionSource.includes('fetch('), 'batch terrain/collision selection must not issue network requests');

var fillCall = source.indexOf('terrainTools.floodFill');
assert(fillCall >= 0, 'fill click handler should invoke the safe algorithm');
assert(!source.slice(fillCall, fillCall + 500).includes('api('), 'flood fill must remain local until draft save');
assert(!source.slice(fillCall, fillCall + 500).includes('fetch('), 'flood fill must not issue network requests');

var collisionClick = source.indexOf("if(tool==='collision')");
assert(collisionClick >= 0, 'single-cell collision brush should remain available');
assert(source.slice(collisionClick, collisionClick + 650).includes('terrainTools.applyCollisionRectangle'), 'single-cell collision brush should reuse normalized collision mutation');
assert(!source.slice(collisionClick, collisionClick + 650).includes('api('), 'single-cell collision editing must remain local until draft save');

assert(source.includes("if(selected.type==='terrain'){selected=null;showSelection();draw();return}"), 'deleting a terrain selection must only clear selection, never remove a mob area');

var saveStart = source.indexOf('function saveDraft(){');
assert(saveStart >= 0 && source.slice(saveStart, saveStart + 400).includes('normalizeDraftCollisions()'), 'draft save should normalize collisions first');
assert(source.slice(saveStart, saveStart + 400).includes('/admin/api/world'), 'draft save should keep using the existing World Editor API');
assert(source.includes('function save(){if(previewMode)return;saveDraft()'), 'Save action should delegate to the validated draft writer');

console.log('World Editor terrain, fill and collision selection UI smoke test passed.');
