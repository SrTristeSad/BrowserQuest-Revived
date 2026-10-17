import fs from 'node:fs';

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error('Anchor not found: ' + label);
  const next = source.replace(before, after);
  if (next === source) throw new Error('Replacement failed: ' + label);
  return next;
}

{
  const path = 'client/index.html';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    '        <link rel="stylesheet" href="css/achievements.css" type="text/css">\n',
    '        <link rel="stylesheet" href="css/achievements.css" type="text/css">\n        <link rel="stylesheet" href="css/announcements.css" type="text/css">\n',
    'announcement stylesheet link'
  );
  const notification = `    \t\t\t<div id="achievement-notification">\n    \t\t\t    <div class="coin">\n    \t\t\t        <div id="coinsparks"></div>\n    \t\t\t    </div>\n    \t\t\t    <div id="achievement-info">\n        \t\t\t    <div class="title">New Achievement Unlocked!</div>\n        \t\t\t    <div class="name"></div>\n    \t\t\t    </div>\n    \t\t\t</div>\n`;
  const announcement = `    \t\t\t<div id="admin-announcement" role="status" aria-live="polite" aria-atomic="true">\n    \t\t\t    <div class="announcement-label">Server</div>\n    \t\t\t    <div class="announcement-message"></div>\n    \t\t\t</div>\n`;
  source = replaceOnce(source, notification, notification + announcement, 'announcement markup');
  fs.writeFileSync(path, source);
}

{
  const path = 'client/js/app.js';
  let source = fs.readFileSync(path, 'utf8');
  source = replaceOnce(
    source,
    '            this.blinkInterval = null;\n',
    '            this.blinkInterval = null;\n            this.announcementTimeout = null;\n',
    'announcement timeout state'
  );
  const anchor = `        showAchievementNotification: function(id, name) {\n`;
  const method = `        showAnnouncement: function(message) {\n            var self = this,\n                $announcement = $('#admin-announcement'),\n                $message = $announcement.find('.announcement-message');\n\n            if(!$announcement.length) {\n                return;\n            }\n            if(this.announcementTimeout) {\n                clearTimeout(this.announcementTimeout);\n            }\n            $message.text(String(message || ''));\n            $announcement.addClass('active');\n            this.announcementTimeout = setTimeout(function() {\n                $announcement.removeClass('active');\n                self.announcementTimeout = null;\n            }, 6500);\n        },\n\n`;
  source = replaceOnce(source, anchor, method + anchor, 'showAnnouncement method');
  fs.writeFileSync(path, source);
}

{
  const path = 'client/js/game.js';
  let source = fs.readFileSync(path, 'utf8');
  const chat = `                self.client.onChatMessage(function(entityId, message) {\n                    var entity = self.getEntityById(entityId);\n                    self.createBubble(entityId, message);\n                    self.assignBubbleTo(entity);\n                    self.audioManager.playSound("chat");\n                });\n`;
  const announcement = `            \n                self.client.onAnnouncement(function(message) {\n                    if(self.app && self.app.showAnnouncement) {\n                        self.app.showAnnouncement(message);\n                    }\n                });\n`;
  source = replaceOnce(source, chat, chat + announcement, 'announcement display callback');
  fs.writeFileSync(path, source);
}

console.log('Announcement display patch applied.');
