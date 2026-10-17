import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Anchor not found: ' + label);
  const next = source.replace(before, after);
  if (next === source) throw new Error('Replacement failed: ' + label);
  return next;
}

const path = 'server/admin/http.js';
let source = fs.readFileSync(path, 'utf8');

const accountHelperEnd = `    function controlRuntime() {\n`;
const auditHelpers = `    function sanitizeAuditMetadata(value) {\n        if(Array.isArray(value)) {\n            return value.map(sanitizeAuditMetadata);\n        }\n        if(!value || typeof value !== 'object') { return value; }\n        var clean = {};\n        Object.keys(value).forEach(function(key) {\n            if(/password|token|secret|cookie|authorization/i.test(key)) { return; }\n            clean[key] = sanitizeAuditMetadata(value[key]);\n        });\n        return clean;\n    }\n\n    async function listAuditEntries(limit, before) {\n        if(!services || !services.postgres) { return {entries: [], nextBefore: null}; }\n        limit = Math.max(1, Math.min(100, Number(limit) || 50));\n        before = before && /^[0-9]+$/.test(String(before)) ? Number(before) : null;\n        var result = await services.postgres.query(\n            \"SELECT l.id, l.actor_user_id, u.username AS actor_username, u.role AS actor_role, l.action, l.target, l.metadata, l.created_at FROM admin_audit_log l LEFT JOIN users u ON u.id=l.actor_user_id WHERE ($1::bigint IS NULL OR l.id < $1::bigint) ORDER BY l.id DESC LIMIT $2\",\n            [before, limit]\n        ), entries = result.rows.map(function(row) {\n            return {\n                id: Number(row.id),\n                actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id),\n                actorUsername: row.actor_username || null,\n                actorRole: row.actor_role || null,\n                action: row.action,\n                target: row.target || null,\n                metadata: sanitizeAuditMetadata(row.metadata || {}),\n                createdAt: row.created_at\n            };\n        });\n        return {\n            entries: entries,\n            nextBefore: entries.length === limit ? entries[entries.length - 1].id : null\n        };\n    }\n\n`;
source = replaceOnce(source, accountHelperEnd, auditHelpers + accountHelperEnd, 'audit history helpers');

const routeAnchor = `        if(pathname === '/admin/api/players' && request.method === 'GET') {\n`;
const route = `        if(pathname === '/admin/api/audit' && request.method === 'GET') {\n            if(!await requireAdmin(request, response, true)) { return; }\n            var auditLimit = 50, auditBefore = null;\n            try {\n                var auditUrl = new URL(request.url, 'http://admin.local');\n                auditLimit = auditUrl.searchParams.get('limit') || 50;\n                auditBefore = auditUrl.searchParams.get('before');\n            } catch(ignoreAuditUrl) {}\n            json(response, 200, await listAuditEntries(auditLimit, auditBefore));\n            return;\n        }\n\n`;
source = replaceOnce(source, routeAnchor, route + routeAnchor, 'audit history route');

fs.writeFileSync(path, source);
console.log('Audit history backend patch applied.');
