
define(function() {

    var Storage = Class.extend({
        init: function() {
            this.achievementSyncTimeout = null;
            if(this.hasLocalStorage() && localStorage.data) {
                this.data = JSON.parse(localStorage.data);
            } else {
                this.resetData();
            }
            this.ensureDataShape();
            this.applyAccountAchievementState();
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
                accountCharacterId: null,
                guestAchievementsCache: null
            };
        },

        ensureDataShape: function() {
            if(!this.data.achievements) {
                this.data.achievements = this.normalizeAchievements({});
            }
            if(this.data.accountCharacterId === undefined) {
                this.data.accountCharacterId = null;
            }
            if(this.data.guestAchievementsCache === undefined) {
                this.data.guestAchievementsCache = null;
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

        getAccountSession: function() {
            var state = window.BQAuthState;
            return state && state.session && state.session.loggedIn ? state.session : null;
        },

        applyAccountAchievementState: function() {
            var session = this.getAccountSession(), serverAchievements, accountCharacterId;

            if(!session || !session.character) {
                // If the previous page session belonged to an account, restore the guest cache.
                if(this.data.accountCharacterId) {
                    this.data.achievements = this.normalizeAchievements(this.data.guestAchievementsCache || {});
                    this.data.accountCharacterId = null;
                    this.data.guestAchievementsCache = null;
                    this.saveLocalOnly();
                }
                return;
            }

            accountCharacterId = String(session.character.id);
            if(String(this.data.accountCharacterId || '') !== accountCharacterId) {
                // Preserve the pre-login guest state so logging out cannot leak account progress to guests.
                if(!this.data.accountCharacterId) {
                    this.data.guestAchievementsCache = this.normalizeAchievements(this.data.achievements);
                }
                this.data.accountCharacterId = accountCharacterId;
            }

            serverAchievements = session.progress && session.progress.achievements;
            if(serverAchievements) {
                // Once a server record exists it is the source of truth. localStorage is only a cache.
                this.data.achievements = this.normalizeAchievements(serverAchievements);
                this.saveLocalOnly();
            } else {
                // Upgrade path for accounts created before server-backed achievements existed:
                // seed PostgreSQL once from the existing local cache.
                this.data.achievements = this.normalizeAchievements(this.data.achievements);
                this.saveLocalOnly();
                this.scheduleAchievementSync(0);
            }
        },
    
        hasLocalStorage: function() {
            return Modernizr.localstorage;
        },

        saveLocalOnly: function() {
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
                self.syncAchievements();
            }, delay === undefined ? 250 : delay);
        },

        syncAchievements: function() {
            var self = this,
                session = this.getAccountSession(),
                snapshot;
            if(!session || !window.fetch) { return; }

            snapshot = this.normalizeAchievements(this.data.achievements);
            fetch('/api/auth/progress/achievements', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({achievements: snapshot})
            }).then(function(response) {
                if(!response.ok) { throw new Error('Achievement sync failed: ' + response.status); }
                return response.json();
            }).then(function(result) {
                if(result && result.achievements) {
                    self.data.achievements = self.normalizeAchievements(result.achievements);
                    if(window.BQAuthState && window.BQAuthState.session) {
                        window.BQAuthState.session.progress = window.BQAuthState.session.progress || {};
                        window.BQAuthState.session.progress.achievements = self.data.achievements;
                    }
                    self.saveLocalOnly();
                }
            }).catch(function() {
                // PostgreSQL/HTTP can be briefly unavailable. Keep the local cache and retry;
                // server merge is monotonic, so replaying the same snapshot is safe.
                if(self.getAccountSession()) {
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
