/* Fit the game frame to the browser viewport while retaining legacy HUD positions.
 * CSS scales the frame; app.setMouseCoordinates maps pointer events to canvas pixels.
 */
(function() {
    'use strict';

    function fitGameViewport() {
        var container = document.getElementById('container');
        if(!container || !document.body.classList.contains('game')) { return; }
        var width = container.offsetWidth,
            height = container.offsetHeight;
        if(!width || !height) { return; }

        var usableWidth = Math.max(1, window.innerWidth - 8),
            usableHeight = Math.max(1, window.innerHeight - 8),
            scale = Math.min(usableWidth / width, usableHeight / height);

        container.style.setProperty('--bq-viewport-scale',
            String(Math.max(0.1, scale)));
    }

    function ready() {
        fitGameViewport();
        window.addEventListener('resize', fitGameViewport);
        new MutationObserver(fitGameViewport)
            .observe(document.body, {attributes: true, attributeFilter: ['class']});
    }

    if(document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ready);
    } else {
        ready();
    }
})();
