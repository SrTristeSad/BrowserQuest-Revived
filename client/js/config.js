/* Production clients connect to the same origin by default.
 * No deployed, private or generated config_build.json is required.
 * Both HTTP and WebSocket traffic use the site's existing reverse proxy.
 */
define(function() {
    var port = window.location.port ?
        parseInt(window.location.port, 10) :
        (window.location.protocol === 'https:' ? 443 : 80);
    var endpoint = {
        host: window.location.hostname,
        port: port,
        dispatcher: false
    };
    return {
        dev: endpoint,
        build: endpoint
    };
});
