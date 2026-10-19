/* Prevent obsolete BrowserQuest form fallbacks from navigating to /none.
 * The game handles chat and character creation with JavaScript. If the
 * classic client has not initialized yet, submitting must never navigate.
 */
(function () {
    'use strict';

    document.addEventListener('submit', function (event) {
        var form = event.target;

        if (!form || (form.id !== 'character-form' && form.id !== 'chat-form')) {
            return;
        }

        event.preventDefault();

        // Keypress handlers in main.js normally start the game. This is a
        // fallback for Enter triggering native submit before those handlers
        // are ready; use the same button and account-access policy.
        if (form.id === 'character-form') {
            var input = document.getElementById('nameinput'),
                button = document.querySelector('#createcharacter .play div');

            if (input && input.value && input.value.trim() && button) {
                button.click();
            }
        }
        // A chat form is not an HTTP form: game chat is sent by the
        // existing client key handlers, never via GET navigation.
    }, true);
}());
