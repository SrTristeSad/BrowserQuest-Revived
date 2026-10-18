'use strict';

var fs = require('fs'),
    path = require('path'),
    crypto = require('crypto');

function replaceAtomic(dest, content) {
    var tmp = dest + '.world-stage-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
    fs.mkdirSync(path.dirname(dest), {recursive:true, mode:0o700});
    try {
        fs.writeFileSync(tmp, content, {mode:0o600});
        fs.renameSync(tmp, dest);
    } finally {
        if(fs.existsSync(tmp)) { fs.unlinkSync(tmp); }
    }
}

function recover(versionsDir) {
    if(!versionsDir) { return false; }
    var journal = path.join(versionsDir, 'publish-recovery.json');
    if(!fs.existsSync(journal)) { return false; }
    var state = JSON.parse(fs.readFileSync(journal, 'utf8'));
    if(!state || !Array.isArray(state.files) || typeof state.releaseId !== 'string' ||
       !/^[a-zA-Z0-9_-]+$/.test(state.releaseId)) {
        throw new Error('Diário de recuperação do mundo inválido.');
    }
    var dir = path.join(versionsDir, 'releases', state.releaseId);
    state.files.forEach(function(file) {
        if(!file || typeof file.dest !== 'string' || !path.isAbsolute(file.dest) ||
           !/^[0-9]+\.backup$/.test(file.backup)) {
            throw new Error('Entrada inválida no diário de recuperação do mundo.');
        }
        if(file.existed) {
            var backup = path.join(dir, file.backup);
            if(!fs.existsSync(backup)) { throw new Error('Backup necessário para recuperação do mundo não encontrado.'); }
            replaceAtomic(file.dest, fs.readFileSync(backup));
        } else if(fs.existsSync(file.dest)) { fs.unlinkSync(file.dest); }
    });
    fs.unlinkSync(journal);
    return true;
}

function publish(entries, versionsDir, options) {
    options = options || {};
    if(!versionsDir || !Array.isArray(entries) || !entries.length) {
        throw new Error('Pacote de publicação inválido.');
    }
    recover(versionsDir);
    var id = new Date().toISOString().replace(/[^0-9A-Za-z]/g, '-') + '-' + crypto.randomBytes(4).toString('hex'),
        dir = path.join(versionsDir, 'releases', id),
        journal = path.join(versionsDir, 'publish-recovery.json'),
        records = [],
        staged = [],
        prepared = false;
    fs.mkdirSync(dir, {recursive:true, mode:0o700});
    try {
        entries.forEach(function(entry, i) {
            if(!entry || typeof entry.dest !== 'string' || !path.isAbsolute(entry.dest) ||
               !(Buffer.isBuffer(entry.content) || typeof entry.content === 'string')) {
                throw new Error('Arquivo de publicação inválido.');
            }
            var backup = i + '.backup',
                existed = fs.existsSync(entry.dest),
                temp = entry.dest + '.world-stage-' + id;
            fs.mkdirSync(path.dirname(entry.dest), {recursive:true, mode:0o700});
            if(existed) { fs.copyFileSync(entry.dest, path.join(dir, backup)); }
            fs.writeFileSync(temp, entry.content, {mode:0o600});
            staged.push(temp);
            records.push({dest:entry.dest,backup:backup,existed:existed});
        });
        replaceAtomic(journal, JSON.stringify({releaseId:id,files:records}) + '\n');
        prepared = true;
        entries.forEach(function(entry, i) {
            fs.renameSync(staged[i], entry.dest);
            if(typeof options.afterReplace === 'function') { options.afterReplace(i, entry.dest); }
        });
        // Journal deletion is the commit boundary: recovery always restores all previous files.
        fs.writeFileSync(path.join(dir,'manifest.json'), JSON.stringify({
            id:id,createdAt:new Date().toISOString(),files:records,revision:options.revision||null
        },null,2)+'\n',{mode:0o600});
        fs.unlinkSync(journal);
        return {id:id};
    } catch(error) {
        if(prepared) {
            try { recover(versionsDir); }
            catch(recoveryError) {
                error.recoveryError = recoveryError;
            }
        }
        throw error;
    } finally {
        staged.forEach(function(temp) {
            if(fs.existsSync(temp)) { fs.unlinkSync(temp); }
        });
    }
}

function list(versionsDir) {
    if(!versionsDir) { return []; }
    recover(versionsDir);
    var dir = path.join(versionsDir, 'releases');
    if(!fs.existsSync(dir)) { return []; }
    return fs.readdirSync(dir).sort().reverse().slice(0,100).flatMap(function(id) {
        if(!/^[a-zA-Z0-9_-]+$/.test(id)) { return []; }
        var file = path.join(dir,id,'manifest.json');
        if(!fs.existsSync(file)) { return []; }
        try {
            var m = JSON.parse(fs.readFileSync(file,'utf8'));
            return [{id:id,createdAt:m.createdAt,revision:m.revision,restorable:m.files.some(function(f) {
                return f.existed && f.dest && /world_server|server\.json/.test(path.basename(f.dest));
            })}];
        } catch(ignore) { return []; }
    });
}

module.exports = {publish:publish,recover:recover,list:list};
