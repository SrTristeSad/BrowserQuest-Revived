'use strict';

var assert = require('assert'),
    fs = require('fs'),
    path = require('path');

var source = fs.readFileSync(path.join(__dirname, '..', 'server', 'admin', 'public', 'world-editor.html'), 'utf8');

assert(source.includes('id="tilesetPalette"'), 'World Editor should expose a visual tileset palette');
assert(source.includes('value="tile">Lápis de terreno'), 'World Editor should expose the terrain pencil');
assert(source.includes('value="erase">Borracha de terreno'), 'World Editor should expose the terrain eraser');
assert(source.includes('16 px/tile · nativo'), 'World Editor should expose native-size terrain preview');
assert(source.includes('state.map.data[i]=next'), 'terrain painting must edit the draft tile array locally');
assert(source.includes("const next=erase?-1:selectedTile"), 'eraser should write the legacy empty tile marker');
assert(source.includes('ctx.imageSmoothingEnabled=false'), 'terrain preview should preserve pixel-art rendering');
assert(source.includes('pctx.imageSmoothingEnabled=false'), 'tileset palette should preserve pixel-art rendering');
assert(source.includes('id>=0&&id<cat.count'), 'palette selection must stay inside the server-provided catalog');
assert(source.includes("tilesetImage.src=cat.url"), 'tileset image should come from the server-provided safe catalog URL');

var paintStart = source.indexOf('function paintCell('),
    paintEnd = source.indexOf('function nearestEntity', paintStart),
    paintSource = source.slice(paintStart, paintEnd);
assert(paintStart >= 0 && paintEnd > paintStart, 'paintCell should exist');
assert(!paintSource.includes('api('), 'painting a tile must not issue a network request per cell');
assert(!paintSource.includes('fetch('), 'painting a tile must remain local until draft save');

var saveStart = source.indexOf('function save(){');
assert(saveStart >= 0 && source.slice(saveStart, saveStart + 300).includes("/admin/api/world"), 'draft save should keep using the existing World Editor API');

console.log('World Editor visual tileset palette and local painting UI smoke test passed.');
