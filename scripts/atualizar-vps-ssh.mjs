#!/usr/bin/env node
/**
 * BrowserQuest-Revived: SSH updater for legacy aaPanel ZIP installations.
 * Download the official GitHub main snapshot, stage changed project files,
 * back up each modified target, then atomically replace code without deleting
 * private runtime configuration or published world content.
 *
 * Usage from the BrowserQuest root:
 *   node atualizar-vps-ssh.mjs --check
 *   node atualizar-vps-ssh.mjs --apply
 * Options:
 *   --archive /absolute/path/source.zip  Use a local snapshot (for offline tests).
 *
 * This script intentionally does NOT run npm or restart production services.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

const SOURCE = 'https://codeload.github.com/SrTristeSad/BrowserQuest-Revived/zip/refs/heads/main';
const root = path.resolve(process.cwd());
const args = process.argv.slice(2);
const isApply = args.includes('--apply');
const isCheck = args.includes('--check');
const archiveOption = args.indexOf('--archive');
const localArchive = archiveOption >= 0 ? args[archiveOption + 1] : null;
if ((isApply === isCheck) || (archiveOption >= 0 && (!localArchive || !path.isAbsolute(localArchive))) ||
    args.some((arg, index) => !['--check','--apply','--archive'].includes(arg) && index !== archiveOption + 1)) {
    console.error('Uso: node atualizar-vps-ssh.mjs --check | --apply [--archive /caminho/absoluto.zip]');
    process.exit(2);
}
function fail(message) {throw new Error(message);}
function safeParts(relative) {
    return !relative.startsWith('/') && !relative.includes('\\') && !relative.includes('\0') &&
        relative.split('/').every(item => item && item !== '.' && item !== '..');
}
function include(relative) {
    if(!safeParts(relative)) return false;
    if(['app.js','package.json','package-lock.json','.nvmrc'].includes(relative)) return true;
    if(relative.startsWith('client/')) {
        if(relative === 'client/index.html') return true;
        if(/^client\/(?:js|css|sprites)\/.+\.(?:js|json|css|html|mjs)$/.test(relative)) return true;
        return false;
    }
    if(relative.startsWith('server/')) {
        if(/^server\/(?:admin|js|story|auth|persistence|storage|lifecycle|setup)\/.+\.(?:js|mjs|json|css|html)$/.test(relative)) {
            return !/(?:^|\/)(?:config_local|secrets|credentials)(?:\.|\/)/i.test(relative);
        }
        return /^server\/(?:bootstrap|lifecycle)\.js$/.test(relative);
    }
    return /^(?:shared\/js|scripts|test)\/.+\.(?:js|mjs|css|html|json)$/.test(relative);
}
function safeDestination(relative) {
    if(!include(relative)) fail('Arquivo não permitido: ' + relative);
    let current = root;
    for(const part of relative.split('/')) {
        current = path.join(current, part);
        try {
            if(fs.lstatSync(current).isSymbolicLink()) {
                fail('Link simbólico bloqueado: ' + current);
            }
        }catch(error) {
            if(error.code !== 'ENOENT') throw error;
        }
    }
    if(fs.existsSync(current) && !fs.lstatSync(current).isFile()) {
        fail('Destino não é arquivo: ' + current);
    }
    return current;
}
function walk(directory, relative, files) {
    for(const entry of fs.readdirSync(directory, {withFileTypes:true})) {
        const next = relative ? relative + '/' + entry.name : entry.name;
        if(!safeParts(next)) fail('Caminho inválido no pacote: ' + next);
        if(entry.isSymbolicLink()) fail('Pacote com link simbólico rejeitado: ' + next);
        if(entry.isDirectory()) walk(path.join(directory, entry.name), next, files);
        else if(entry.isFile() && include(next)) files.push(next);
    }
}
function checksum(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function shell(bin, argv, opts = {}) {
    return execFileSync(bin, argv, {encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:4*1024*1024,...opts});
}
let temporary;
try {
    if(fs.lstatSync(root).isSymbolicLink()) fail('Raiz do projeto é um link simbólico.');
    if(!fs.existsSync(path.join(root,'client/index.html')) ||
        !fs.existsSync(path.join(root,'package.json')) ||
        !fs.existsSync(path.join(root,'app.js'))) {
        fail('Execute dentro da instalação BrowserQuest-Revived (contendo app.js, package.json e client/index.html).');
    }
    if(process.getuid && process.getuid() === 0) {
        console.log('[Aviso] Executando como root; arquivos novos podem pertencer ao root.');
    }
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-ssh-updater-'));
    const zip = path.join(temporary,'source.zip');
    if(localArchive) fs.copyFileSync(localArchive,zip);
    else {
        console.log('Baixando snapshot oficial do GitHub/main...');
        shell('curl',['-fLSs','--retry','2','--connect-timeout','20','--max-time','180','--output',zip,SOURCE]);
    }
    const archiveInfo = fs.statSync(zip);
    if(archiveInfo.size > 32*1024*1024 || archiveInfo.size < 100) fail('Arquivo ZIP muito grande, vazio ou inválido.');
    const listing = shell('unzip',['-Z','-1',zip]);
    const entries = listing.trim().split(/\r?\n/);
    if(entries.length>3000 || entries.some(e => !safeParts(e.replace(/\/$/,'')))) fail('Entradas perigosas no ZIP.');
    const extracted = path.join(temporary,'extracted');
    fs.mkdirSync(extracted);
    shell('unzip',['-q',zip,'-d',extracted],{timeout:120000});
    const dirs=fs.readdirSync(extracted,{withFileTypes:true}).filter(d=>d.isDirectory());
    if(dirs.length!==1) fail('Pacote sem diretório raiz único.');
    const sourceRoot=path.join(extracted,dirs[0].name);
    if(!fs.existsSync(path.join(sourceRoot,'client/index.html')) ||
        !fs.existsSync(path.join(sourceRoot,'package-lock.json'))) fail('ZIP não contém instalação BrowserQuest válida.');
    const files=[];
    walk(sourceRoot,'',files);
    files.sort();
    let total=0;
    const changes=[];
    for(const relative of files) {
        const target=safeDestination(relative);
        const newer=fs.readFileSync(path.join(sourceRoot,relative));
        const older=fs.existsSync(target)?fs.readFileSync(target):null;
        if(older && older.equals(newer)) continue;
        if(relative.endsWith('.js')) {
            try { new vm.Script(newer.toString('utf8'), {filename:relative}); }
            catch(error) { fail('JavaScript inválido no pacote: '+relative+' '+error.message); }
        }
        total+=newer.length;
        if(total>16*1024*1024) fail('Limite de atualização de 16 MiB excedido.');
        changes.push({relative,target,newer,older});
    }
    console.log('Arquivos diferentes: '+changes.length+' | dados novos: '+(total/1024/1024).toFixed(2)+' MiB');
    for(const c of changes) console.log('  '+(c.older?'ALTERAR ':'CRIAR   ')+c.relative);
    if(isCheck) {
        console.log('\nModo de conferência: nenhum arquivo foi modificado.');
        process.exitCode=0;
    } else if(!changes.length) {
        console.log('Código já atualizado. Nenhum arquivo alterado.');
    } else {
        const backupRoot=path.join(root,'var','ssh-update-backups');
        fs.mkdirSync(backupRoot,{recursive:true,mode:0o700});
        if(fs.lstatSync(backupRoot).isSymbolicLink()) fail('Pasta de backups é um link simbólico.');
        const backupId=new Date().toISOString().replace(/[.:]/g,'-')+'-'+crypto.randomBytes(4).toString('hex');
        const backup=path.join(backupRoot,backupId);
        fs.mkdirSync(backup,{mode:0o700});
        const completed=[];
        try {
            // Back up ALL old files first to avoid half-backed-up deployments.
            for(const c of changes) {
                if(c.older===null) continue;
                const saved=path.join(backup,c.relative);
                fs.mkdirSync(path.dirname(saved),{recursive:true});
                fs.writeFileSync(saved,c.older,{mode:0o600});
            }
            fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),source:localArchive||SOURCE,changed:changes.map(c=>({file:c.relative,created:!c.older,before:c.older&&checksum(c.older),after:checksum(c.newer)}))},null,2));
            for(const c of changes) {
                const target=safeDestination(c.relative);
                const mode=c.older?fs.statSync(target).mode&0o777:0o644;
                fs.mkdirSync(path.dirname(target),{recursive:true});
                const tmp=target+'.bq-incoming-'+backupId;
                completed.push({c,tmp,mode});
                fs.writeFileSync(tmp,c.newer,{mode});
                fs.renameSync(tmp,target);
            }
            console.log('\nCódigo aplicado. Backup local: '+backup);
            console.log('IMPORTANTE: dependências npm e reinício do Node.js não foram executados.');
        }catch(error){
            for(const {c,tmp,mode} of completed.reverse()) {
                try {
                    if(c.older) fs.writeFileSync(c.target,c.older,{mode});
                    else fs.rmSync(c.target,{force:true});
                    fs.rmSync(tmp,{force:true});
                }catch(restore){console.error('Falha ao reverter '+c.relative+': '+restore.message);}
            }
            throw error;
        }
    }
}catch(error){
    console.error('\nERRO: '+error.message);
    process.exitCode=1;
}finally {
    if(temporary) fs.rmSync(temporary,{recursive:true,force:true});
}
