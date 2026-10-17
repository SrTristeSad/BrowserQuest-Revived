
define(function() {

    var Storage = Class.extend({
        init: function() {
            var self = this;
            this.achievementSyncTimeout = null;
            if(this.hasLocalStorage() && localStorage.data) {
                this.data = JSON.parse(localStorage.data);
            } else {
                this.resetData();
            }
            this.ensureDataShape();
            this.applyAccountAchievementState();

            if(window.addEventListener) {
                window.addEventListener('pagehide', function() {
                    if(self.getAccountSession()) {
                        clearTimeout(self.achievementSyncTimeout);
                        self.achievementSyncTimeout = null;
                        self.syncAchievements(true);
                    }
                });
            }
        },
    
        resetData: function() {
            this.data = {
                hasAlreadyPlayed: false,
                player: {
                    name: "",
                    weapon: "",
                    armor: "",
                    image: ""
                },
                achievements: {
                    unlocked: [],
                    ratCount: 0,
                    skeletonCount: 0,
                    totalKills: 0,
                    totalDmg: 0,
                    totalRevives: 0
                },
                activeAccountCharacterId: null,
                guestAchievementsCache: null,
                accountAchievementCaches: {}
            };
        },

        ensureDataShape: function() {
            if(!this.data.achievements) {
                this.data.achievements = this.normalizeAchievements({});
            }
            // Migrate the first account-cache prototype if a browser already saw it.
            if(this.data.activeAccountCharacterId === undefined) {
                this.data.activeAccountCharacterId = this.data.accountCharacterId || null;
            }
            delete this.data.accountCharacterId;
            if(this.data.guestAchievementsCache === undefined) {
                this.data.guestAchievementsCache = null;
            }
            if(!this.data.accountAchievementCaches || typeof this.data.accountAchievementCaches !== 'object') {
                this.data.accountAchievementCaches = {};
            }
            if(this.data.activeAccountCharacterId && !this.data.accountAchievementCaches[String(this.data.activeAccountCharacterId)]) {
                this.data.accountAchievementCaches[String(this.data.activeAccountCharacterId)] = this.normalizeAchievements(this.data.achievements);
            }
        },

        normalizeAchievements: function(value) {
            value = value || {};
            var seen = {}, unlocked = _.filter(_.map(value.unlocked || [], function(id) {
                return parseInt(id, 10);
            }), function(id) {
                if(isNaN(id) || id < 1 || id > 20 || seen[id]) {
                    return false;
                }
                seen[id] = true;
                return true;
            });
            unlocked.sort(function(a, b) { return a - b; });

            var clamp = function(input, max) {
                var number = parseInt(input, 10);
                if(isNaN(number) || number < 0) { number = 0; }
                return Math.min(number, max);
            };

            return {
                unlocked: unlocked,
                ratCount: clamp(value.ratCount, 10),
                skeletonCount: clamp(value.skeletonCount, 10),
                totalKills: clamp(value.totalKills, 50),
                totalDmg: clamp(value.totalDmg, 5000),
                totalRevives: clamp(value.totalRevives, 5)
            };
        },

        mergeAchievements: function(first, second) {
            first = this.normalizeAchievements(first);
            second = this.normalizeAchievements(second);
            var unlocked = first.unlocked.concat(second.unlocked);
            return this.normalizeAchievements({
                unlocked: unlocked,
                ratCount: Math.max(first.ratCount, second.ratCount),
                skeletonCount: Math.max(first.skeletonCount, second.skeletonCount),
                totalKills: Math.max(first.totalKills, second.totalKills),
                totalDmg: Math.max(first.totalDmg, second.totalDmg),
                totalRevives: Math.max(first.totalRevives, second.totalRevives)
            });
        },

        getAccountSession: function() {
            var state = window.BQAuthState;
            return state && state.session && state.session.loggedIn ? state.session : null;
        },

        cacheCurrentAccountAchievements: function() {
            if(this.data.activeAccountCharacterId) {
                this.data.accountAchievementCaches[String(this.data.activeAccountCharacterId)] = this.normalizeAchievements(this.data.achievements);
            }
        },

        applyAccountAchievementState: function() {
            var session = this.getAccountSession(), serverAchievements, accountCharacterId, cachedAchievements, wasAccountActive;

            if(!session || !session.character) {
                if(this.data.activeAccountCharacterId) {
                    this.cacheCurrentAccountAchievements();
                    this.data.achievements = this.normalizeAchievements(this.data.guestAchievementsCache || {});
                    this.data.activeAccountCharacterId = null;
                    this.saveLocalOnly();
                }
                return;
            }

            accountCharacterId = String(session.character.id);
            wasAccountActive = String(this.data.activeAccountCharacterId || '') === accountCharacterId;

            if(!this.data.activeAccountCharacterId) {
                this.data.guestAchievementsCache = this.normalizeAchievements(this.data.achievements);
            } else if(!wasAccountActive) {
                this.cacheCurrentAccountAchievements();
            }

            cachedAchievements = this.data.accountAchievementCaches[accountCharacterId] || null;
            serverAchievements = session.progress && session.progress.achievements;
            this.data.activeAccountCharacterId = accountCharacterId;

            if(serverAchievements) {
                // PostgreSQL is canonical, but merge a cache belonging to this exact character
                // so an update made immediately before a tab/browser close can be replayed safely.
                this.data.achievements = cachedAchievements ?
                    this.mergeAchievements(serverAchievements, cachedAchievements) :
                    this.normalizeAchievements(serverAchievements);
                this.data.accountAchievementCaches[accountCharacterId] = this.normalizeAchievements(this.data.achievements);
                this.saveLocalOnly();
                if(cachedAchievements) {
                    this.scheduleAchievementSync(0);
                }
            } else {
                // Upgrade path for accounts created before server-backed achievements existed.
                // Prefer a cache previously bound to this exact account; otherwise import the
                // old single localStorage achievement snapshot once.
                this.data.achievements = this.normalizeAchievements(cachedAchievements || this.data.achievements);
                this.data.accountAchievementCaches[accountCharacterId] = this.normalizeAchievements(this.data.achievements);
                this.saveLocalOnly();
                this.scheduleAchievementSync(0);
            }
        },
    
        hasLocalStorage: function() {
            return Modernizr.localstorage;
        },

        saveLocalOnly: function() {
            this.cacheCurrentAccountAchievements();
            if(this.hasLocalStorage()) {
                localStorage.data = JSON.stringify(this.data);
            }
        },
    
        save: function() {
            this.saveLocalOnly();
        },

        saveAchievements: function() {
            this.saveLocalOnly();
            this.scheduleAchievementSync(250);
        },

        scheduleAchievementSync: function(delay) {
            var self = this;
            if(!this.getAccountSession() || !window.fetch) { return; }
            clearTimeout(this.achievementSyncTimeout);
            this.achievementSyncTimeout = setTimeout(function() {
                self.achievementSyncTimeout = null;
                self.syncAchievements(false);
            }, delay === undefined ? 250 : delay);
        },

        syncAchievements: function(keepalive) {
            var self = this,
                session = this.getAccountSession(),
                snapshot;
            if(!session || !window.fetch) { return; }

            snapshot = this.normalizeAchievements(this.data.achievements);
            fetch('/api/auth/progress/achievements', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({achievements: snapshot}),
                keepalive: Boolean(keepalive)
            }).then(function(response) {
                if(!response.ok) { throw new Error('Achievement sync failed: ' + response.status); }
                return response.json();
            }).then(function(result) {
                if(result && result.achievements) {
                    self.data.achievements = self.normalizeAchievements(result.achievements);
                    if(self.data.activeAccountCharacterId) {
                        self.data.accountAchievementCaches[String(self.data.activeAccountCharacterId)] = self.normalizeAchievements(self.data.achievements);
                    }
                    if(window.BQAuthState && window.BQAuthState.session) {
                        window.BQAuthState.session.progress = window.BQAuthState.session.progress || {};
                        window.BQAuthState.session.progress.achievements = self.data.achievements;
                    }
                    self.saveLocalOnly();
                }
            }).catch(function() {
                if(self.getAccountSession() && !keepalive) {
                    // PostgreSQL/HTTP can be briefly unavailable. Keep the account-specific cache
                    // and retry; the server merge is monotonic, so replaying the snapshot is safe.
                    self.scheduleAchievementSync(2000);
                }
            });
        },
    
        clear: function() {
            if(this.hasLocalStorage()) {
                localStorage.data = "";
                this.resetData();
            }
        },
    
        // Player
    
        hasAlreadyPlayed: function() {
            return this.data.hasAlreadyPlayed;
        },
    
        initPlayer: function(name) {
            this.data.hasAlreadyPlayed = true;
            this.setPlayerName(name);
        },
        
        setPlayerName: function(name) {
            this.data.player.name = name;
            this.save();
        },
    
        setPlayerImage: function(img) {
            this.data.player.image = img;
            this.save();
        },

        setPlayerArmor: function(armor) {
            this.data.player.armor = armor;
            this.save();
        },
    
        setPlayerWeapon: function(weapon) {
            this.data.player.weapon = weapon;
            this.save();
        },

        savePlayer: function(img, armor, weapon) {
            this.setPlayerImage(img);
            this.setPlayerArmor(armor);
            this.setPlayerWeapon(weapon);
        },
    
        // Achievements
    
        hasUnlockedAchievement: function(id) {
            return _.include(this.data.achievements.unlocked, id);
        },
    
        unlockAchievement: function(id) {
            if(!this.hasUnlockedAchievement(id)) {
                this.data.achievements.unlocked.push(id);
                this.saveAchievements();
                return true;
            }
            return false;
        },
    
        getAchievementCount: function() {
            return _.size(this.data.achievements.unlocked);
        },
    
        // Angry rats
        getRatCount: function() {
            return this.data.achievements.ratCount;
        },
    
        incrementRatCount: function() {
            if(this.data.achievements.ratCount < 10) {
                this.data.achievements.ratCount++;
                this.saveAchievements();
            }
        },
        
        // Skull Collector
        getSkeletonCount: function() {
            return this.data.achievements.skeletonCount;
        },

        incrementSkeletonCount: function() {
            if(this.data.achievements.skeletonCount < 10) {
                this.data.achievements.skeletonCount++;
                this.saveAchievements();
            }
        },
    
        // Meatshield
        getTotalDamageTaken: function() {
            return this.data.achievements.totalDmg;
        },
    
        addDamage: function(damage) {
            if(this.data.achievements.totalDmg < 5000) {
                this.data.achievements.totalDmg += damage;
                if(this.data.achievements.totalDmg > 5000) {
                    this.data.achievements.totalDmg = 5000;
                }
                this.saveAchievements();
            }
        },
    
        // Hunter
        getTotalKills: function() {
            return this.data.achievements.totalKills;
        },

        incrementTotalKills: function() {
            if(this.data.achievements.totalKills < 50) {
                this.data.achievements.totalKills++;
                this.saveAchievements();
            }
        },
    
        // Still Alive
        getTotalRevives: function() {
            return this.data.achievements.totalRevives;
        },
    
        incrementRevives: function() {
            if(this.data.achievements.totalRevives < 5) {
                this.data.achievements.totalRevives++;
                this.saveAchievements();
            }
        },
    });
    
    return Storage;
});
