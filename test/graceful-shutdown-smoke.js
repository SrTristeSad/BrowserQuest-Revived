'use strict';

var assert = require('assert'),
    GracefulShutdown = require('../server/lifecycle/graceful-shutdown');

async function main() {
    var order = [], exitCode = null,
        handler = GracefulShutdown.createGracefulShutdown({
            characterStore: {
                flushAll: async function() {
                    order.push('flush');
                }
            },
            services: {
                close: async function() {
                    order.push('close');
                }
            },
            logger: {log: function(){}, error: function(){}},
            timeoutMs: 500,
            exit: function(code) {
                order.push('exit');
                exitCode = code;
            }
        });

    await handler('SIGTERM');
    assert.deepStrictEqual(order, ['flush', 'close', 'exit']);
    assert.strictEqual(exitCode, 0);

    // A repeated signal must not start a second flush/close sequence.
    await handler('SIGINT');
    assert.deepStrictEqual(order, ['flush', 'close', 'exit']);

    var failureOrder = [], failureExit = null,
        failing = GracefulShutdown.createGracefulShutdown({
            characterStore: {
                flushAll: async function() {
                    failureOrder.push('flush');
                    throw new Error('database unavailable');
                }
            },
            services: {
                close: async function() {
                    failureOrder.push('close');
                }
            },
            logger: {log: function(){}, error: function(){}},
            timeoutMs: 500,
            exit: function(code) {
                failureOrder.push('exit');
                failureExit = code;
            }
        });

    await failing('SIGTERM');
    assert.deepStrictEqual(failureOrder, ['flush', 'close', 'exit']);
    assert.strictEqual(failureExit, 1);

    console.log('Graceful shutdown smoke tests passed.');
}

main().catch(function(error) {
    console.error(error);
    process.exit(1);
});
