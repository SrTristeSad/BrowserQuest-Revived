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
  const block = `        match = pathname.match(/^\\/admin\\/api\\/accounts\\/([0-9]+)\\/ban$/);\n        if(match && request.method === 'POST') {\n            session = await requireAdmin(request, response, true);\n            if(!session) { return; }\n            if(!playerAuth || typeof playerAuth.destroySessionsByUserId !== 'function') {\n                json(response, 503, {error: 'Gerenciamento de sessões de jogadores indisponível.'});\n                return;\n            }\n            try { body = await readJson(request); }\n            catch(error) { json(response, 400, {error: 'JSON inválido.'}); return; }\n\n            var banAccountId = Number(match[1]),\n                banResult = await services.postgres.query(\"SELECT id, username, status FROM users WHERE id=$1 AND role='player' LIMIT 1\", [banAccountId]);\n            if(banResult.rowCount !== 1) {\n                json(response, 404, {error: 'Conta de jogador não encontrada.'});\n                return;\n            }\n\n            var banAccount = banResult.rows[0],\n                banReason = String(body.reason || '').trim().replace(/\\s+/g, ' ').slice(0, 120) || 'Conta banida pelo administrador.',\n                banPreviousStatus = banAccount.status,\n                banned = (await services.postgres.query(\"UPDATE users SET status='banned', updated_at=NOW() WHERE id=$1 AND role='player' RETURNING id, username, status\", [banAccount.id])).rows[0],\n                bannedSessions = await playerAuth.destroySessionsByUserId(banAccount.id),\n                banControls = controlRuntime(),\n                bannedConnections = banControls && typeof banControls.kickByUserId === 'function' ? banControls.kickByUserId(banAccount.id, banReason) : 0;\n\n            await audit(session, 'account.ban', banAccount.username, {\n                userId: Number(banAccount.id),\n                previousStatus: banPreviousStatus,\n                reason: banReason,\n                sessionsRevoked: bannedSessions,\n                connectionsClosed: bannedConnections\n            }, request);\n            json(response, 200, {\n                ok: true,\n                account: {id: Number(banned.id), username: banned.username, status: banned.status},\n                sessionsRevoked: bannedSessions,\n                connectionsClosed: bannedConnections\n            });\n            return;\n        }\n\n`;
  source = replaceOnce(source, anchor, block + anchor, 'ban account route');
  fs.writeFileSync(path, source);
}

console.log('Ban account microtask patch applied.');
