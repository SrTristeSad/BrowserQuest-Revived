import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Anchor not found: ' + label);
  const next = source.replace(before, after);
  if (next === source) throw new Error('Replacement failed: ' + label);
  return next;
}

const path = 'server/admin/http.js';
let source = fs.readFileSync(path, 'utf8');
const anchor = "        if(pathname === '/admin/api/settings/access' && request.method === 'GET') {\n";
const block = `        match = pathname.match(/^\\/admin\\/api\\/accounts\\/([0-9]+)\\/reactivate$/);\n        if(match && request.method === 'POST') {\n            session = await requireAdmin(request, response, true);\n            if(!session) { return; }\n            try { body = await readJson(request); }\n            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }\n\n            var reactivateAccountId = Number(match[1]),\n                reactivateResult = await services.postgres.query(\"SELECT id, username, status FROM users WHERE id=$1 AND role='player' LIMIT 1\", [reactivateAccountId]);\n            if(reactivateResult.rowCount !== 1) {\n                json(response, 404, {error: 'Conta de jogador não encontrada.'});\n                return;\n            }\n\n            var reactivateAccount = reactivateResult.rows[0],\n                reactivateReason = String(body.reason || '').trim().replace(/\\s+/g, ' ').slice(0, 120) || 'Conta reativada pelo administrador.',\n                reactivatePreviousStatus = reactivateAccount.status,\n                reactivated = (await services.postgres.query(\"UPDATE users SET status='active', updated_at=NOW() WHERE id=$1 AND role='player' RETURNING id, username, status\", [reactivateAccount.id])).rows[0];\n\n            await audit(session, 'account.reactivate', reactivateAccount.username, {\n                userId: Number(reactivateAccount.id),\n                previousStatus: reactivatePreviousStatus,\n                reason: reactivateReason\n            }, request);\n            json(response, 200, {\n                ok: true,\n                account: {id: Number(reactivated.id), username: reactivated.username, status: reactivated.status}\n            });\n            return;\n        }\n\n`;
source = replaceOnce(source, anchor, block + anchor, 'reactivate account route');
fs.writeFileSync(path, source);
console.log('Reactivate account microtask patch applied.');
