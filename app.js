'use strict';

process.umask(0o077);

require('./server/bootstrap').start().catch(function(error) {
    console.error('[BrowserQuest] Falha fatal ao iniciar:', error);
    process.exitCode = 1;
});
