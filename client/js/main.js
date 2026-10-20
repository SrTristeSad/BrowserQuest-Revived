
define(['jquery', 'app', 'controls', '../../shared/js/daycycle'], function($, App, Controls, DayCycle) {
    var app, game;

    var initApp = function() {
        $(document).ready(function() {
        	app = new App();
            app.center();
        
            if(Detect.isWindows()) {
                // Workaround for graphical glitches on text
                $('body').addClass('windows');
            }
            
            if(Detect.isOpera()) {
                // Fix for no pointer events
                $('body').addClass('opera');
            }
        
            $('body').click(function(event) {
                if($('#parchment').hasClass('credits')) {
                    app.toggleCredits();
                }
                
                if($('#parchment').hasClass('about')) {
                    app.toggleAbout();
                }
            });
	
        	$('.barbutton').click(function() {
        	    $(this).toggleClass('active');
        	});
	
        	$('#chatbutton').click(function() {
        	    if($('#chatbutton').hasClass('active')) {
        	        app.showChat();
        	    } else {
                    app.hideChat();
        	    }
        	});
	
        	$('#helpbutton').click(function() {
                app.toggleAbout();
        	});
	
        	$('#achievementsbutton').click(function() {
                app.toggleAchievements();
                if(app.blinkInterval) {
                    clearInterval(app.blinkInterval);
                }
                $(this).removeClass('blink');
        	});
	
        	$('#instructions').click(function() {
                app.hideWindows();
        	});
        	
        	$('#playercount').click(function() {
        	    app.togglePopulationInfo();
        	});
        	
        	$('#population').click(function() {
        	    app.togglePopulationInfo();
        	});
	
        	$('.clickable').click(function(event) {
                event.stopPropagation();
        	});
	
        	$('#toggle-credits').click(function() {
        	    app.toggleCredits();
        	});
	
        	$('#create-new span').click(function() {
        	    app.animateParchment('loadcharacter', 'confirmation');
        	});
	
        	$('.delete').click(function() {
                app.storage.clear();
        	    app.animateParchment('confirmation', 'createcharacter');
        	});
	
        	$('#cancel span').click(function() {
        	    app.animateParchment('confirmation', 'loadcharacter');
        	});
        	
        	$('.ribbon').click(function() {
        	    app.toggleAbout();
        	});

            $('#nameinput').bind("keyup", function() {
                app.toggleButton();
            });
    
            $('#previous').click(function() {
                var $achievements = $('#achievements');
        
                if(app.currentPage === 1) {
                    return false;
                } else {
                    app.currentPage -= 1;
                    $achievements.removeClass().addClass('active page' + app.currentPage);
                }
            });
    
            $('#next').click(function() {
                var $achievements = $('#achievements'),
                    $lists = $('#lists'),
                    nbPages = $lists.children('ul').length;
        
                if(app.currentPage === nbPages) {
                    return false;
                } else {
                    app.currentPage += 1;
                    $achievements.removeClass().addClass('active page' + app.currentPage);
                }
            });

            $('#notifications div').bind(TRANSITIONEND, app.resetMessagesPosition.bind(app));
    
            $('.close').click(function() {
                app.hideWindows();
            });
        
            $('.twitter').click(function() {
                var url = $(this).attr('href');

               app.openPopup('twitter', url);
               return false;
            });

            $('.facebook').click(function() {
                var url = $(this).attr('href');

               app.openPopup('facebook', url);
               return false;
            });
        
            var data = app.storage.data;
    		if(data.hasAlreadyPlayed) {
    		    if(data.player.name && data.player.name !== "") {
		            $('#playername').html(data.player.name);
    		        $('#playerimage').attr('src', data.player.image);
    		    }
    		}
    		
    		$('.play div').click(function(event) {
                var nameFromInput = $('#nameinput').attr('value'),
                    nameFromStorage = $('#playername').html(),
                    name = nameFromInput || nameFromStorage;
                
                app.tryStartingGame(name);
            });
        
            document.addEventListener("touchstart", function() {},false);
            
            $('#resize-check').bind("transitionend", app.resizeUi.bind(app));
            $('#resize-check').bind("webkitTransitionEnd", app.resizeUi.bind(app));
            $('#resize-check').bind("oTransitionEnd", app.resizeUi.bind(app));
            // Window resize, orientation and browser panels do not always fire
            // CSS transition events. Refresh the actual three Canvas layers too.
            var resizeFramePending = false;
            window.addEventListener('resize', function() {
                if(resizeFramePending) { return; }
                resizeFramePending = true;
                (window.requestAnimationFrame || function(fn) { setTimeout(fn, 16); })(function() {
                    resizeFramePending = false;
                    app.resizeUi();
                });
            });
        
            log.info("App initialized.");
        
            initGame();
        });
    };
    
    var initGame = function() {
        require(['game'], function(Game) {
            
            var canvas = document.getElementById("entities"),
        	    background = document.getElementById("background"),
        	    foreground = document.getElementById("foreground"),
        	    input = document.getElementById("chatinput");

    		game = new Game(app);
    		game.setup('#bubbles', canvas, background, foreground, input);
            game.controls = new Controls(game);
            // One epoch-based clock for server and client; only terrain darkens.
            var previousPhase = null;
            function updateWorldLight() {
                var phase = DayCycle.phase(Date.now(), game.map && game.map.dayNight),
                    body = document.body;
                if(previousPhase === phase) { return; }
                previousPhase = phase;
                body.classList.remove('bq-night', 'bq-dusk', 'bq-dawn');
                if(phase === 'night' || phase === 'dusk' || phase === 'dawn') {
                    body.classList.add('bq-' + phase);
                }
            }
            updateWorldLight();
            setInterval(updateWorldLight, 5000);
    		game.setStorage(app.storage);
    		app.setGame(game);
            app.initEquipmentPanel();

    		if(app.isDesktop && app.supportsWorkers) {
    		    game.loadMap();
    		}
	
    		game.onGameStart(function() {
                app.initEquipmentIcons();
    		});
    		
    		game.onDisconnect(function(message) {
                // A closed socket cannot be revived with another HELLO.
                // Leave the existing button accessible as a safe reconnect action.
                $('#respawn').data('connectionLost', true).show();
                $('#death').find('p').text(message || 'Connection lost.')
                    .append($('<em>').text('Click the button to reconnect.'));
                $('body').addClass('death');
    		});
	
    		game.onPlayerDeath(function() {
                if(!$('#respawn').data('connectionLost')) {
                    $('#death').find('p').text('You are dead...');
                    $('#respawn').show();
                }
    		    if($('body').hasClass('credits')) {
    		        $('body').removeClass('credits');
    		    }
                $('body').addClass('death');
    		});
	
    		game.onPlayerEquipmentChange(function() {
    		    app.initEquipmentIcons();
    		});
	
    		game.onPlayerInvincible(function() {
    		    $('#hitpoints').toggleClass('invincible');
    		});

    		game.onNbPlayersChange(function(worldPlayers, totalPlayers) {
    		    var setWorldPlayersString = function(string) {
        		        $("#instance-population").find("span:nth-child(2)").text(string);
        		        $("#playercount").find("span:nth-child(2)").text(string);
        		    },
        		    setTotalPlayersString = function(string) {
        		        $("#world-population").find("span:nth-child(2)").text(string);
        		    };
    		    
    		    $("#playercount").find("span.count").text(worldPlayers);
    		    
    		    $("#instance-population").find("span").text(worldPlayers);
    		    if(worldPlayers == 1) {
    		        setWorldPlayersString("player");
    		    } else {
    		        setWorldPlayersString("players");
    		    }
    		    
    		    $("#world-population").find("span").text(totalPlayers);
    		    if(totalPlayers == 1) {
    		        setTotalPlayersString("player");
    		    } else {
    		        setTotalPlayersString("players");
    		    }
    		});
	
    		game.onAchievementUnlock(function(id, name, description) {
    		    app.unlockAchievement(id, name);
    		});
	
    		game.onNotification(function(message) {
    		    app.showMessage(message);
    		});
	
            app.initHealthBar();
	
            // Preserve a name typed while the game assets were loading.
    		$('#chatbox').attr('value', '');
    		
            function interactAtPointer(event) {
                app.setMouseCoordinates(event);
                game.click(); // adjacent NPC/chest only; never walks.
            }
            // Pointer Events provide the floating movement joystick. A short
            // touch can still talk to a nearby NPC, but cannot move or attack.
            if(window.PointerEvent) {
                game.controls.attachTouchSurface(foreground, interactAtPointer);
            } else if(game.renderer.mobile || game.renderer.tablet) {
                $('#foreground').bind('touchend', function(event) {
                    var changed = event.originalEvent.changedTouches;
                    if(changed && changed.length) { interactAtPointer(changed[0]); }
                });
            }
            if(!game.renderer.mobile && !game.renderer.tablet) {
                $('#foreground').click(function(event) {
                    var original = event.originalEvent || {};
                    if(original.pointerType === 'touch' ||
                       (original.sourceCapabilities &&
                        original.sourceCapabilities.firesTouchEvents)) { return; }
                    interactAtPointer(event);
                });
            }
            foreground.addEventListener('contextmenu', function(event) {
                if(!game.started || !game.controls || !game.controls.canMove() ||
                   event.pointerType === 'touch') { return; }
                event.preventDefault();
                event.stopPropagation();
                app.setMouseCoordinates(event);
                game.attackAtCursor(); // target under mouse, only one tile away
            });

            $('body').unbind('click');
            $('body').click(function(event) {
                var hasClosedParchment = false;
                
                if($('#parchment').hasClass('credits')) {
                    if(game.started) {
                        app.closeInGameCredits();
                        hasClosedParchment = true;
                    } else {
                        app.toggleCredits();
                    }
                }
                
                if($('#parchment').hasClass('about')) {
                    if(game.started) {
                        app.closeInGameAbout();
                        hasClosedParchment = true;
                    } else {
                        app.toggleAbout();
                    }
                }
                
                var sourceEvent = event.originalEvent || {};
                var isTouchClick = sourceEvent.pointerType === 'touch' ||
                    (sourceEvent.sourceCapabilities &&
                     sourceEvent.sourceCapabilities.firesTouchEvents);
                // Global body clicks only manage parchment/help overlays.
                // Movement is exclusive to WASD/arrows and the joystick.
            });
            
            $('#respawn').click(function(event) {
                event.stopPropagation();
                if($('#respawn').data('connectionLost') ||
                    !game.client || !game.client.connection ||
                    game.client.connection.readyState !== WebSocket.OPEN) {
                    window.location.reload();
                    return;
                }
                // The death animation must finish before the new player is created.
                if(game.player) { return; }
                $('#respawn').data('connectionLost', false);
                game.audioManager.playSound("revive");
                game.restart();
                $('body').removeClass('death');
            });
            
            $(document).mousemove(function(event) {
            	app.setMouseCoordinates(event);
            	if(game.started) {
            	    game.movecursor();
            	}
            });

            $(document).keydown(function(e) {
            	var key = e.which,
                    $chat = $('#chatinput');

                if(key === 13) {
                    if($('#chatbox').hasClass('active')) {
                        app.hideChat();
                    } else {
                        app.showChat();
                    }
                }
            });
            
            $('#chatinput').keydown(function(e) {
                var key = e.which,
                    $chat = $('#chatinput');

                if(key === 13) {
                    if($chat.attr('value') !== '') {
                        if(game.player) {
                            game.say($chat.attr('value'));
                        }
                        $chat.attr('value', '');
                        app.hideChat();
                        $('#foreground').focus();
                        return false;
                    } else {
                        app.hideChat();
                        return false;
                    }
                }
                
                if(key === 27) {
                    app.hideChat();
                    return false;
                }
            });

            $('#nameinput').keypress(function(event) {
                var $name = $('#nameinput'),
                    name = $name.attr('value');

                if(event.keyCode === 13) {
                    if(name !== '') {
                        app.tryStartingGame(name, function() {
                            $name.blur(); // exit keyboard on mobile
                        });
                        return false; // prevent form submit
                    } else {
                        return false; // prevent form submit
                    }
                }
            });
            
            $('#mutebutton').click(function() {
                game.audioManager.toggle();
            });
            
            $(document).bind("keydown", function(e) {
            	var key = e.which,
            	    $chat = $('#chatinput');

                if($('#chatinput:focus').size() == 0 && $('#nameinput:focus').size() == 0) {
                    if(key === 13) { // Enter
                        if(game.ready) {
                            $chat.focus();
                            return false;
                        }
                    }
                    if(key === 32) { // Space
                        // game.togglePathingGrid();
                        return false;
                    }
                    if(key === 70) { // F
                        // game.toggleDebugInfo();
                        return false;
                    }
                    if(key === 27) { // ESC
                        app.hideWindows();
                        _.each(game.player.attackers, function(attacker) {
                            attacker.stop();
                        });
                        return false;
                    }

                } else {
                    if(key === 13 && game.ready) {
                        $chat.focus();
                        return false;
                    }
                }
            });
            
            if(game.renderer.tablet) {
                $('body').addClass('tablet');
            }
        });
    };
    
    initApp();
});
