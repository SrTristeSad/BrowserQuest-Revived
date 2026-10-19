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

        var usableWidth = Math.max(1, (window.visualViewport ? window.visualViewport.width : window.innerWidth) - 8),
            usableHeight = Math.max(1, (window.visualViewport ? window.visualViewport.height : window.innerHeight) - 8),
            scale = Math.min(usableWidth / width, usableHeight / height);

        container.style.setProperty('--bq-viewport-scale',
            String(Math.max(0.1, scale)));
    }

    window.fitGameViewport = fitGameViewport;

    function installFullscreenButton() {
        if(!document.createElement || !document.documentElement.requestFullscreen) { return; }
        var button = document.createElement('button');
        button.id = 'bq-fullscreen';
        button.type = 'button';
        button.textContent = 'Tela cheia';
        button.setAttribute('aria-label', 'Alternar tela cheia');
        button.addEventListener('click', function() {
            var operation = document.fullscreenElement ? document.exitFullscreen() :
                document.documentElement.requestFullscreen();
            if(operation && operation.catch) { operation.catch(function() {}); }
        });
        document.addEventListener('fullscreenchange', function() {
            button.textContent = document.fullscreenElement ? 'Sair da tela cheia' : 'Tela cheia';
            button.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
            fitGameViewport();
        });
        document.body.appendChild(button);
    }

    function ready() {
        installFullscreenButton();
        fitGameViewport();
        window.addEventListener('resize', fitGameViewport);
        window.addEventListener('fullscreenchange', fitGameViewport);
        if(window.visualViewport) { window.visualViewport.addEventListener('resize', fitGameViewport); }
        new MutationObserver(fitGameViewport)
            .observe(document.body, {attributes: true, attributeFilter: ['class']});
    }

    if(document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ready);
    } else {
        ready();
    }
})();
