'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const {UpdateManager, allowed, safeName} = require('../server/admin/update-manager');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-updater-'));
const installation = path.join(temp, 'installation');
const archiveRoot = path.join(temp, 'project');
const configDir = path.join(installation, 'var', 'config');
const oldFlag = process.env.BROWSERQUEST_UPDATES_ENABLED;
const file = (root, relative, data) => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), {recursive: true});
    fs.writeFileSync(full, data);
};
try {
    file(installation, 'client/index.html', '<h1>Old game</h1>');
    file(installation, 'client/js/engine.js', 'window.engine = 1;\n');
    file(configDir, 'browserquest.json', '{"private":"keep-me"}');
    file(archiveRoot, 'client/index.html', '<h1>New game</h1>');
    file(archiveRoot, 'client/js/engine.js', 'window.engine = 2;\n');
    file(archiveRoot, 'server/admin/public/updates.html', '<h1>New updates page</h1>');
    file(archiveRoot, 'var/config/browserquest.json', '{"private":"overwrite-attempt"}');
    file(archiveRoot, '.env', 'PRIVATE=leak');
    const zipFile = path.join(temp, 'update.zip');
    cp.execFileSync('zip', ['-q', '-r', zipFile, 'project'], {cwd: temp});
    const zip = fs.readFileSync(zipFile);
    const updater = new UpdateManager(installation, configDir);
    process.env.BROWSERQUEST_UPDATES_ENABLED = '';
    assert.equal(updater.status().enabled, false, 'remote updates must be opt-in');
    assert.throws(() => updater.stage(zip, 'test'), /desativadas/);

    assert(!allowed('var/config/browserquest.json'));
    assert(!allowed('.env'));
    assert(!safeName('../evil.js'));
    assert(!safeName('/absolute.js'));
    assert(!safeName('good/../../evil.js'));
    assert(allowed('client/js/engine.js'));

    process.env.BROWSERQUEST_UPDATES_ENABLED = '1';
    const staged = updater.stage(zip, 'test');
    assert.equal(staged.changes.length, 3);
    assert.equal(staged.changes.some(x => x.path.includes('var/')), false);
    assert.equal(updater.status().staged.id, staged.id);
    assert.equal(fs.readFileSync(path.join(installation, 'client/js/engine.js'),'utf8'),
        'window.engine = 1;\n', 'staging must never change live code');

    // Any source edit between review and apply must reject the old review.
    file(installation, 'client/js/engine.js', 'window.engine = 3;\n');
    assert.throws(() => updater.apply(staged.id), /mudaram/i);
    file(installation, 'client/js/engine.js', 'window.engine = 1;\n');

    const reviewed = updater.stage(zip, 'test');
    const result = updater.apply(reviewed.id);
    assert.equal(result.restartRequired, true);
    assert.equal(result.changed, 3);
    assert.equal(updater.status().staged, null);
    assert.equal(fs.readFileSync(path.join(installation, 'client/js/engine.js'),'utf8'),
        'window.engine = 2;\n');
    assert.equal(fs.readFileSync(path.join(configDir, 'browserquest.json'),'utf8'),
        '{"private":"keep-me"}', 'installation secrets must be preserved');
    assert.equal(fs.existsSync(path.join(installation, '.env')), false);
    assert.equal(fs.readFileSync(path.join(configDir, 'code-updates',
        'backup-'+result.backupId, 'client/js/engine.js'),'utf8'),
        'window.engine = 1;\n', 'original code must be backed up');
    console.log('Admin updater ZIP stage, drift checks, protected data and backup smoke passed.');
} finally {
    if(oldFlag === undefined) { delete process.env.BROWSERQUEST_UPDATES_ENABLED; }
    else { process.env.BROWSERQUEST_UPDATES_ENABLED = oldFlag; }
    fs.rmSync(temp, {recursive: true, force: true});
}
