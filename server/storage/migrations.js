'use strict';

var pg = require('pg'),
    Infrastructure = require('./infrastructure');

var migrations = [
    {
        id: '001_foundation',
        sql: [
            "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
            "CREATE TABLE IF NOT EXISTS users (id BIGSERIAL PRIMARY KEY, username VARCHAR(32) NOT NULL UNIQUE, display_name VARCHAR(64) NOT NULL, password_hash TEXT NOT NULL, role VARCHAR(16) NOT NULL DEFAULT 'player', status VARCHAR(16) NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_login_at TIMESTAMPTZ NULL, CHECK (role IN ('player','moderator','admin','owner')), CHECK (status IN ('active','suspended','banned')))",
            "CREATE TABLE IF NOT EXISTS characters (id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name VARCHAR(64) NOT NULL, weapon_kind INTEGER NULL, armor_kind INTEGER NULL, image TEXT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
            "CREATE UNIQUE INDEX IF NOT EXISTS characters_one_per_user_v1 ON characters(user_id)",
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
            "CREATE TABLE IF NOT EXISTS admin_audit_log (id BIGSERIAL PRIMARY KEY, actor_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, target TEXT NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, ip INET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
            "CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx ON admin_audit_log(created_at DESC)"
        ]
    }
];

async function runMigrations(postgresConfig) {
    var pool = new pg.Pool(Infrastructure.postgresPoolOptions(postgresConfig)), client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");

        for(var i = 0; i < migrations.length; i += 1) {
            var migration = migrations[i], existing = await client.query('SELECT 1 FROM schema_migrations WHERE id = $1', [migration.id]);
            if(existing.rowCount) { continue; }
            for(var j = 0; j < migration.sql.length; j += 1) {
                await client.query(migration.sql[j]);
            }
            await client.query('INSERT INTO schema_migrations(id) VALUES($1)', [migration.id]);
        }
        await client.query('COMMIT');
        return {ok: true, applied: migrations.map(function(item) { return item.id; })};
    } catch(error) {
        if(client) {
            try { await client.query('ROLLBACK'); } catch(ignore) {}
        }
        throw error;
    } finally {
        if(client) { client.release(); }
        await pool.end();
    }
}

async function upsertOwner(postgresConfig, owner) {
    var pool = new pg.Pool(Infrastructure.postgresPoolOptions(postgresConfig));
    try {
        var result = await pool.query(
            "INSERT INTO users(username, display_name, password_hash, role, status) VALUES($1,$2,$3,'owner','active') ON CONFLICT(username) DO UPDATE SET display_name=EXCLUDED.display_name, password_hash=EXCLUDED.password_hash, role='owner', status='active', updated_at=NOW() RETURNING id, username, role",
            [owner.username.toLowerCase(), owner.username, owner.passwordHash]
        );
        await pool.query(
            "INSERT INTO settings(key, value) VALUES('access_mode', $1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()",
            [JSON.stringify(owner.accessMode || 'mixed')]
        );
        return result.rows[0];
    } finally {
        await pool.end();
    }
}

exports.migrations = migrations;
exports.runMigrations = runMigrations;
exports.upsertOwner = upsertOwner;
