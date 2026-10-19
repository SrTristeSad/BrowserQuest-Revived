'use strict';

/* Owner-only, opt-in code updater. Never unpacks ZIP files into the webroot.
 * ZIP entries are extracted individually into memory, after a strict allowlist.
 * The app's database, configuration, imported assets and map drafts are excluded.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const vm = require('vm');
const child = require('child_process');

const MAX_ARCHIVE = 20 * 1024 * 1024;
const MAX_FILE = 2 * 1024 * 1024;
const MAX_TOTAL = 16 * 1024 * 1024;
const MAX_CHANGED = 400;
const SOURCE = 'https://codeload.github.com/SrTristeSad/BrowserQuest-Revived/zip/refs/heads/main';

function problem(message, status) {
    const error = new Error(message);
    error.statusCode = status || 400;
    return error;
}
function sha(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}
function allowed(name) {
    return name === 'app.js' || name === 'client/index.html' ||
        /^(?:client\/(?:js|css)\/|server\/(?:admin|js|story|auth|persistence|storage|lifecycle|setup)\/|shared\/js\/|scripts\/|test\/)[a-zA-Z0-9_.\/-]+\.(?:js|mjs|css|html)$/.test(name);
}
function safeName(name) {
    return name && !name.startsWith('/') && !name.includes('\\') &&
        !name.includes('\0') && !name.match(/[\r\n]/) &&
        name.split('/').every(part => part && part !== '.' && part !== '..');
}
function archiveEntries(zipPath) {
    let output;
    try {
        output = child.execFileSync('unzip', ['-Z', '-1', zipPath], {
            encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024
        });
    } catch(error) {
        throw problem('ZIP inválido ou utilitário unzip indisponível.', 422);
    }
    const entries = output.trim().split('\n').filter(Boolean);
    if(entries.length > 3000 || entries.some(name => !safeName(name.replace(/\/$/, '')))) {
        throw problem('ZIP com nomes de arquivos perigosos ou muitos arquivos.', 422);
    }
    return entries;
}
function zipEntry(zipPath, entry) {
    try {
        return child.execFileSync('unzip', ['-p', zipPath, entry], {
            timeout: 10000, maxBuffer: MAX_FILE + 1
        });
    } catch(error) {
        throw problem('Não foi possível ler arquivo do ZIP: ' + entry, 422);
    }
}
function checkTarget(root, relative) {
    if(!allowed(relative) || !safeName(relative)) {
        throw problem('Arquivo fora da lista permitida.', 422);
    }
    let cursor = root;
    const parts = relative.split('/');
    for(const part of parts.slice(0, -1)) {
        cursor = path.join(cursor, part);
        if(fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
            throw problem('Caminho simbólico bloqueado: ' + relative, 422);
        }
    }
    const full = path.join(root, relative);
    if(fs.existsSync(full) && (fs.lstatSync(full).isSymbolicLink() ||
        !fs.lstatSync(full).isFile())) {
        throw problem('Destino inválido: ' + relative, 422);
    }
    return full;
}
function analyze(root, zipPath, withData) {
    const entries = archiveEntries(zipPath);
    const index = entries.filter(entry => entry.endsWith('client/index.html'));
    if(index.length !== 1) { throw problem('ZIP precisa conter uma instalação BrowserQuest válida.', 422); }
    const prefix = index[0].slice(0, -'client/index.html'.length);
    const changed = [];
    const seen = new Set();
    let total = 0;
    for(const entry of entries) {
        if(!entry.startsWith(prefix)) { continue; }
        const relative = entry.slice(prefix.length);
        if(!allowed(relative)) { continue; }
        if(seen.has(relative)) { throw problem('Arquivo duplicado no ZIP: ' + relative, 422); }
        seen.add(relative);
        const target = checkTarget(root, relative);
        const contents = zipEntry(zipPath, entry);
        if(contents.length > MAX_FILE || contents.includes(0)) {
            throw problem('Arquivo inválido ou excessivamente grande: ' + relative, 422);
        }
        total += contents.length;
        if(total > MAX_TOTAL) { throw problem('Pacote excede o limite de código.', 422); }
        if(relative.endsWith('.js')) {
            try { new vm.Script(contents.toString('utf8'), {filename: relative}); }
            catch(error) { throw problem('JavaScript inválido em ' + relative, 422); }
        }
        const previous = fs.existsSync(target) ? fs.readFileSync(target) : null;
        if(previous && previous.equals(contents)) { continue; }
        changed.push({
            path: relative, kind: previous ? 'modified' : 'created',
            previousHash: previous ? sha(previous) : null, hash: sha(contents),
            size: contents.length, ...(withData ? {data: contents} : {})
        });
        if(changed.length > MAX_CHANGED) { throw problem('Muitos arquivos alterados.', 422); }
    }
    if(!changed.length) { throw problem('Nenhum arquivo de código diferente foi encontrado.', 422); }
    return changed;
}
function fetchOfficial() {
    return new Promise((resolve, reject) => {
        const request = https.get(SOURCE, {
            timeout: 18000, headers: {'User-Agent': 'BrowserQuest-Revived-Updater'}
        }, response => {
            if(response.statusCode !== 200) {
                response.resume();
                return reject(problem('GitHub não retornou um pacote válido.', 502));
            }
            const chunks = [];
            let size = 0;
            response.on('data', chunk => {
                size += chunk.length;
                if(size > MAX_ARCHIVE) {
                    request.destroy(problem('Pacote do GitHub muito grande.', 413));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        });
        request.on('timeout', () => request.destroy(problem('GitHub demorou para responder.', 504)));
        request.on('error', reject);
    });
}
class UpdateManager {
    constructor(root, configDir) {
        this.root = path.resolve(root);
        this.base = path.join(configDir, 'code-updates');
        fs.mkdirSync(this.base, {recursive: true, mode: 0o700});
    }
    enabled() {
        return process.env.BROWSERQUEST_UPDATES_ENABLED === '1';
    }
    statePath() { return path.join(this.base, 'pending.json'); }
    archivePath() { return path.join(this.base, 'pending.zip'); }
    status() {
        let stage = null;
        try { stage = JSON.parse(fs.readFileSync(this.statePath(), 'utf8')); }
        catch(ignore) {}
        return {
            enabled: this.enabled(),
            gitSource: 'SrTristeSad/BrowserQuest-Revived · main',
            requiresUtility: 'unzip',
            staged: stage ? {
                id: stage.id, source: stage.source, createdAt: stage.createdAt,
                changes: stage.changes
            } : null
        };
    }
    async stageFromGit() {
        return this.stage(await fetchOfficial(), 'GitHub/main');
    }
    stage(buffer, source) {
        if(!this.enabled()) { throw problem('Atualizações desativadas nesta instalação.', 403); }
        if(!Buffer.isBuffer(buffer) || buffer.length < 100 || buffer.length > MAX_ARCHIVE) {
            throw problem('O ZIP deve ter no máximo 20 MB.', 413);
        }
        const id = crypto.randomBytes(12).toString('hex');
        const temporary = path.join(this.base, 'incoming-' + id + '.zip');
        fs.writeFileSync(temporary, buffer, {mode: 0o600});
        try {
            const changes = analyze(this.root, temporary, false).map(x => ({
                path: x.path, kind: x.kind, hash: x.hash, previousHash: x.previousHash,
                size: x.size
            }));
            const state = {
                id, source, createdAt: new Date().toISOString(),
                archiveHash: sha(buffer), changes
            };
            // Keep staged archive/state in the private config directory only.
            fs.renameSync(temporary, this.archivePath());
            fs.writeFileSync(this.statePath(), JSON.stringify(state), {mode: 0o600});
            return this.status().staged;
        } finally {
            try { fs.unlinkSync(temporary); } catch(ignore) {}
        }
    }
    apply(id) {
        if(!this.enabled()) { throw problem('Atualizações desativadas nesta instalação.', 403); }
        const state = JSON.parse(fs.readFileSync(this.statePath(), 'utf8'));
        if(!state || state.id !== id || !/^[a-f0-9]{24}$/.test(id)) {
            throw problem('Pacote desatualizado; prepare novamente.', 409);
        }
        const archive = this.archivePath();
        if(sha(fs.readFileSync(archive)) !== state.archiveHash) {
            throw problem('ZIP alterado desde a preparação.', 409);
        }
        const changes = analyze(this.root, archive, true);
        if(changes.length !== state.changes.length ||
            changes.some((change, i) => change.path !== state.changes[i].path ||
                change.hash !== state.changes[i].hash ||
                change.previousHash !== state.changes[i].previousHash)) {
            throw problem('Arquivos locais mudaram; prepare uma nova atualização.', 409);
        }

        const backup = path.join(this.base, 'backup-' + id);
        fs.mkdirSync(backup, {recursive: false, mode: 0o700});
        const applied = [];
        try {
            // Verify all destination directory permissions before touching the installation.
            for(const change of changes) {
                const target = checkTarget(this.root, change.path);
                const dir = path.dirname(target);
                let parent = dir;
                while(!fs.existsSync(parent) && parent !== this.root) {
                    parent = path.dirname(parent);
                }
                fs.accessSync(parent, fs.constants.W_OK);
            }
            for(const change of changes) {
                const target = checkTarget(this.root, change.path);
                const previous = fs.existsSync(target) ? fs.readFileSync(target) : null;
                const saved = path.join(backup, change.path);
                fs.mkdirSync(path.dirname(saved), {recursive: true, mode: 0o700});
                if(previous) { fs.writeFileSync(saved, previous, {mode: 0o600}); }
                const mode = previous ? (fs.statSync(target).mode & 0o777) : 0o644;
                fs.mkdirSync(path.dirname(target), {recursive: true});
                const tmp = target + '.bqupdate-' + id;
                // Mark as applied before rename, so a failure can also remove a temporary file.
                applied.push({target, tmp, previous, mode});
                fs.writeFileSync(tmp, change.data, {mode});
                fs.renameSync(tmp, target);
            }
        } catch(error) {
            for(const item of applied.reverse()) {
                try {
                    if(item.previous) { fs.writeFileSync(item.target, item.previous, {mode: item.mode}); }
                    else { fs.rmSync(item.target, {force: true}); }
                    fs.rmSync(item.tmp, {force: true});
                } catch(restoreError) {
                    console.error('[BrowserQuest] Falha no rollback:', restoreError.message);
                }
            }
            throw problem('Não foi possível aplicar; tentativa de restauração concluída. ' + error.message, 500);
        }
        fs.unlinkSync(this.statePath());
        fs.unlinkSync(archive);
        return {ok: true, changed: changes.length, backupId: id, restartRequired: true,
            warning: 'Reinicie o Node.js no aaPanel. Dependências e migrações não são aplicadas automaticamente.'};
    }
}
module.exports = {UpdateManager, allowed, safeName, analyze};
