
define(['lib/class', 'lib/underscore.min', 'lib/stacktrace', 'util',
        '../../shared/js/gametypes'], function() {
    var css = document.createElement('link'),
        script = document.createElement('script');

    css.rel = 'stylesheet';
    css.href = 'css/auth.css';
    document.head.appendChild(css);

    function startClassicClient() {
        require(['storyui'], function() {
            require(['main']);
        });
    }

    script.src = 'js/auth-ui.js';
    script.onload = function() {
        // The classic BrowserQuest UI reads/clears the character field during startup.
        // Wait for the account policy/session lookup first so account-only mode and
        // an authenticated character cannot race against the legacy initialization.
        Promise.resolve(window.BQAuthReady).catch(function(error) {
            log.error('Player authentication initialization failed: ' + (error && error.message ? error.message : error));
        }).then(startClassicClient);
    };
    script.onerror = function() {
        log.error('Could not load player authentication UI. Falling back to the classic client.');
        startClassicClient();
    };
    document.head.appendChild(script);
});
