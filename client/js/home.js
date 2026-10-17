
define(['lib/class', 'lib/underscore.min', 'lib/stacktrace', 'util'], function() {
    var css = document.createElement('link'),
        script = document.createElement('script');

    css.rel = 'stylesheet';
    css.href = 'css/auth.css';
    document.head.appendChild(css);

    script.src = 'js/auth-ui.js';
    script.onload = function() {
        require(["main"]);
    };
    script.onerror = function() {
        log.error('Could not load player authentication UI. Falling back to the classic client.');
        require(["main"]);
    };
    document.head.appendChild(script);
});