import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Anchor not found: ' + label);
  const next = source.replace(before, after);
  if (next === source) throw new Error('Replacement failed: ' + label);
  return next;
}

{
  const path = 'server/admin/http.js';
  let source = fs.readFileSync(path, 'utf8');
  const anchor = `        if(pathname === '/admin/api/settings/access' && request.method === 'GET') {\n`;
  const block = `        match = pathname.match(/^\\/admin\\/api\\/accounts\\/([0-9]+)\\/suspend$/);\n        if(match && request.method === 'POST') {\n            session = await requireAdmin(request, response, true);\n            if(!session) { return; }\n            if(!playerAuth || typeof playerAuth.destroySessionsByUserId !== 'function') {\n                json(response, 503, {error: 'Gerenciamento de sessões de jogadores indisponível.'});\n                return;\n            }\n            try { body = await readJson(request); }\n            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }\n\n            var suspendAccountId = Number(match[1]),\n                suspendResult = await services.postgres.query(\"SELECT id, username, status FROM users WHERE id=$1 AND role='player' LIMIT 1\", [suspendAccountId]);\n            if(suspendResult.rowCount !== 1) {\n                json(response, 404, {error: 'Conta de jogador não encontrada.'});\n                return;\n            }\n\n            var suspendAccount = suspendResult.rows[0];\n            if(suspendAccount.status === 'banned') {\n                json(response, 409, {error: 'A conta está banida. Remova o ban antes de aplicar suspensão.'});\n                return;\n            }\n\n            var suspendReason = String(body.reason || '').trim().replace(/\\s+/g, ' ').slice(0, 120) || 'Conta suspensa pelo administrador.',\n                previousStatus = suspendAccount.status,\n                suspended = (await services.postgres.query(\"UPDATE users SET status='suspended', updated_at=NOW() WHERE id=$1 AND role='player' RETURNING id, username, status\", [suspendAccount.id])).rows[0],\n                suspendedSessions = await playerAuth.destroySessionsByUserId(suspendAccount.id),\n                suspendControls = controlRuntime(),\n                suspendedConnections = suspendControls && typeof suspendControls.kickByUserId === 'function' ? suspendControls.kickByUserId(suspendAccount.id, suspendReason) : 0;\n\n            await audit(session, 'account.suspend', suspendAccount.username, {\n                userId: Number(suspendAccount.id),\n                previousStatus: previousStatus,\n                reason: suspendReason,\n                sessionsRevoked: suspendedSessions,\n                connectionsClosed: suspendedConnections\n            }, request);\n            json(response, 200, {\n                ok: true,\n                account: {id: Number(suspended.id), username: suspended.username, status: suspended.status},\n                sessionsRevoked: suspendedSessions,\n                connectionsClosed: suspendedConnections\n            });\n            return;\n        }\n\n`;
  source = replaceOnce(source, anchor, block + anchor, 'suspend account route');
  fs.writeFileSync(path, source);
}

console.log('Suspend account microtask patch applied.');
