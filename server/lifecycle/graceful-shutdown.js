'use strict';

function createGracefulShutdown(options) {
    options = options || {};
    var characterStore = options.characterStore || null,
        services = options.services || null,
        timeoutMs = Number(options.timeoutMs || 5000),
        exit = options.exit || function(code) { process.exit(code); },
        logger = options.logger || console,
        shuttingDown = false;

    return async function gracefulShutdown(signal) {
        var forceTimer, exitCode = 0;
        if(shuttingDown) { return; }
        shuttingDown = true;

        logger.log('[BrowserQuest] Encerramento solicitado (' + String(signal || 'shutdown') + '). Persistindo estado...');
        forceTimer = setTimeout(function() {
            logger.error('[BrowserQuest] Encerramento gracioso excedeu o limite de ' + timeoutMs + 'ms.');
            exit(1);
        }, timeoutMs);
        if(forceTimer && typeof forceTimer.unref === 'function') { forceTimer.unref(); }

        try {
            if(characterStore) {
                await characterStore.flushAll();
            }
            if(services) {
                await services.close();
            }
            logger.log('[BrowserQuest] Estado persistente salvo. Encerrando.');
        } catch(error) {
            exitCode = 1;
            logger.error('[BrowserQuest] Falha durante o encerramento gracioso: ' + (error && error.message ? error.message : error));
            if(services) {
                try { await services.close(); } catch(ignore) {}
            }
        } finally {
            clearTimeout(forceTimer);
            exit(exitCode);
        }
    };
}

function install(options) {
    var handler = createGracefulShutdown(options);
    process.once('SIGTERM', function() { handler('SIGTERM'); });
    process.once('SIGINT', function() { handler('SIGINT'); });
    return handler;
}

exports.createGracefulShutdown = createGracefulShutdown;
exports.install = install;
