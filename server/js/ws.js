'use strict';

var cls = require('./lib/class'),
    url = require('url'),
    http = require('http'),
    WebSocket = require('ws'),
    WebSocketServer = WebSocket.WebSocketServer,
    Utils = require('./utils'),
    _ = require('underscore'),
    WS = {};

module.exports = WS;

function logger() {
    return global.log || console;
}

/**
 * Abstract server and connection classes.
 */
var Server = cls.Class.extend({
    init: function(port) {
        this.port = port;
    },

    onConnect: function(callback) {
        this.connection_callback = callback;
    },

    onError: function(callback) {
        this.error_callback = callback;
    },

    broadcast: function() {
        throw new Error('Not implemented');
    },

    forEachConnection: function(callback) {
        _.each(this._connections, callback);
    },

    addConnection: function(connection) {
        this._connections[connection.id] = connection;
    },

    removeConnection: function(id) {
        delete this._connections[id];
    },

    getConnection: function(id) {
        return this._connections[id];
    }
});

var Connection = cls.Class.extend({
    init: function(id, connection, server, request) {
        this._connection = connection;
        this._server = server;
        this._request = request;
        this.id = id;
        this.remoteAddress = request && request.socket ? request.socket.remoteAddress : undefined;
    },

    onClose: function(callback) {
        this.close_callback = callback;
    },

    listen: function(callback) {
        this.listen_callback = callback;
    },

    broadcast: function() {
        throw new Error('Not implemented');
    },

    send: function() {
        throw new Error('Not implemented');
    },

    sendUTF8: function() {
        throw new Error('Not implemented');
    },

    close: function(reason) {
        logger().info('Closing connection to ' + (this.remoteAddress || 'unknown') + '. Error: ' + reason);
        if(this._connection.readyState === WebSocket.OPEN || this._connection.readyState === WebSocket.CONNECTING) {
            this._connection.close(1008, String(reason || 'Connection closed').slice(0, 123));
        }
    }
});

/**
 * BrowserQuest websocket server.
 *
 * The original implementation supported obsolete Hixie and early HyBi drafts
 * through two abandoned websocket packages. Modern browsers all use RFC 6455,
 * so one maintained implementation is enough now.
 */
WS.MultiVersionWebsocketServer = Server.extend({
    _connections: {},
    _counter: 0,

    init: function(port) {
        var self = this;

        this._super(port);
        this._connections = {};
        this._counter = 0;

        this._httpServer = http.createServer(function(request, response) {
            var path = url.parse(request.url).pathname;

            if(path === '/status' && self.status_callback) {
                response.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Cache-Control': 'no-store'
                });
                response.end(self.status_callback());
                return;
            }

            response.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
            response.end('Not found');
        });

        this._webSocketServer = new WebSocketServer({
            server: this._httpServer,
            maxPayload: 1024 * 1024,
            perMessageDeflate: false
        });

        this._webSocketServer.on('connection', function(connection, request) {
            var client = new WS.WebSocketConnection(self._createId(), connection, self, request);

            self.addConnection(client);
            if(self.connection_callback) {
                self.connection_callback(client);
            }
        });

        this._webSocketServer.on('error', function(error) {
            if(self.error_callback) {
                self.error_callback(error);
            } else {
                logger().error(error);
            }
        });

        this._httpServer.on('error', function(error) {
            if(self.error_callback) {
                self.error_callback(error);
            } else {
                logger().error(error);
            }
        });

        this._httpServer.listen(port, function() {
            logger().info('Server is listening on port ' + port);
        });
    },

    _createId: function() {
        return '5' + Utils.random(99) + '' + (this._counter++);
    },

    broadcast: function(message) {
        this.forEachConnection(function(connection) {
            connection.send(message);
        });
    },

    onRequestStatus: function(status_callback) {
        this.status_callback = status_callback;
    }
});

WS.WebSocketConnection = Connection.extend({
    init: function(id, connection, server, request) {
        var self = this;

        this._super(id, connection, server, request);

        this._connection.on('message', function(data, isBinary) {
            if(!self.listen_callback) {
                return;
            }

            if(isBinary) {
                self.close('Binary websocket messages are not supported.');
                return;
            }

            try {
                self.listen_callback(JSON.parse(data.toString('utf8')));
            } catch(error) {
                if(error instanceof SyntaxError) {
                    self.close('Received message was not valid JSON.');
                } else {
                    throw error;
                }
            }
        });

        this._connection.on('close', function() {
            if(self.close_callback) {
                self.close_callback();
            }
            self._server.removeConnection(self.id);
        });

        this._connection.on('error', function(error) {
            if(self._server.error_callback) {
                self._server.error_callback(error);
            } else {
                logger().error(error);
            }
        });
    },

    send: function(message) {
        this.sendUTF8(JSON.stringify(message));
    },

    sendUTF8: function(data) {
        if(this._connection.readyState === WebSocket.OPEN) {
            this._connection.send(data);
        }
    }
});
