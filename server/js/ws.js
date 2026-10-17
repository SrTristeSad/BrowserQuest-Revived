'use strict';

var cls = require('./lib/class'),
    url = require('url'),
    http = require('http'),
    fs = require('fs'),
    path = require('path'),
    WebSocket = require('ws'),
    WebSocketServer = WebSocket.WebSocketServer,
    Utils = require('./utils'),
    _ = require('underscore'),
    WS = {};

module.exports = WS;

var projectRoot = path.resolve(__dirname, '../..'),
    clientRoot = path.join(projectRoot, 'client'),
    sharedRoot = path.join(projectRoot, 'shared'),
    publishedClientRoot = process.env.BROWSERQUEST_CONFIG_DIR || path.join(projectRoot, 'var', 'config');

function logger() {
    return global.log || console;
}

function mimeType(filepath) {
    var extension = path.extname(filepath).toLowerCase(),
        types = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.txt': 'text/plain; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.mp3': 'audio/mpeg',
            '.ogg': 'audio/ogg',
            '.wav': 'audio/wav',
            '.m4a': 'audio/mp4',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf'
        };

    return types[extension] || 'application/octet-stream';
}

function sendText(response, statusCode, text, contentType) {
    response.writeHead(statusCode, {
        'Content-Type': contentType || 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    });
    response.end(text);
}

function resolveStaticFile(requestPath) {
    var root,
        relative,
        resolved,
        published;

    if(requestPath === '/maps/world_client.json') {
        published = path.join(publishedClientRoot, 'world_client_published.json');
        if(fs.existsSync(published)) {
            return published;
        }
    }
    if(requestPath === '/maps/world_client.js') {
        published = path.join(publishedClientRoot, 'world_client_published.js');
        if(fs.existsSync(published)) {
            return published;
        }
    }

    if(requestPath.indexOf('/shared/') === 0) {
        root = sharedRoot;
        relative = requestPath.slice('/shared/'.length);
    } else {
        root = clientRoot;
        relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    }

    if(relative === '') {
        relative = 'index.html';
    }

    resolved = path.resolve(root, relative);
    if(resolved !== root && resolved.indexOf(root + path.sep) !== 0) {
        return null;
    }

    return resolved;
}

function serveStatic(request, response, requestPath) {
    var filepath = resolveStaticFile(requestPath);

    if(!filepath) {
        sendText(response, 403, 'Forbidden');
        return;
    }

    fs.stat(filepath, function(statError, stats) {
        if(statError) {
            sendText(response, 404, 'Not found');
            return;
        }

        if(stats.isDirectory()) {
            filepath = path.join(filepath, 'index.html');
        }

        fs.readFile(filepath, function(readError, content) {
            var cacheControl;

            if(readError) {
                sendText(response, readError.code === 'ENOENT' ? 404 : 500, 'Not found');
                return;
            }

            cacheControl = /\.(?:html|json)$/i.test(filepath) ? 'no-store' : 'public, max-age=300';
            response.writeHead(200, {
                'Content-Type': mimeType(filepath),
                'Content-Length': content.length,
                'Cache-Control': cacheControl,
                'X-Content-Type-Options': 'nosniff'
            });

            if(request.method === 'HEAD') {
                response.end();
            } else {
                response.end(content);
            }
        });
    });
}

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

WS.MultiVersionWebsocketServer = Server.extend({
    _connections: {},
    _counter: 0,

    init: function(port, options) {
        var self = this;

        options = options || {};
        this._super(port);
        this._connections = {};
        this._counter = 0;
        this.host = options.host || '127.0.0.1';
        this.serveClient = options.serveClient !== false;
        this.httpHandler = typeof options.httpHandler === 'function' ? options.httpHandler : null;

        this._httpServer = http.createServer(function(request, response) {
            var requestPath;

            try {
                requestPath = decodeURIComponent(url.parse(request.url).pathname || '/');
            } catch(error) {
                sendText(response, 400, 'Bad request');
                return;
            }

            if(self.httpHandler && self.httpHandler(request, response)) {
                return;
            }

            if(requestPath === '/status' && self.status_callback) {
                sendText(response, 200, self.status_callback(), 'application/json; charset=utf-8');
                return;
            }

            if(requestPath === '/health') {
                sendText(response, 200, JSON.stringify({status: 'ok'}), 'application/json; charset=utf-8');
                return;
            }

            if(requestPath === '/ready') {
                sendText(response, self.status_callback ? 200 : 503, JSON.stringify({
                    status: self.status_callback ? 'ready' : 'starting'
                }), 'application/json; charset=utf-8');
                return;
            }

            if(self.serveClient && (request.method === 'GET' || request.method === 'HEAD')) {
                serveStatic(request, response, requestPath);
                return;
            }

            sendText(response, 404, 'Not found');
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

        this._httpServer.listen(port, this.host, function() {
            logger().info('Server is listening on http://' + self.host + ':' + port);
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
