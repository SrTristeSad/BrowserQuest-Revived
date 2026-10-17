define(['gameclient', '../../shared/js/storyprotocol'], function(GameClient, StoryProtocol) {
    'use strict';

    var originalInit = GameClient.prototype.init,
        originalStoryDialogue = GameClient.prototype.receiveStoryDialogue;

    function element(tag, className, text) {
        var node = document.createElement(tag);
        if(className) { node.className = className; }
        if(text != null) { node.textContent = String(text); }
        return node;
    }

    function ensureUi() {
        var panel = document.getElementById('story-tracker');
        if(panel) { return panel; }

        var style = document.createElement('style');
        style.textContent = '#story-tracker{position:absolute;z-index:12;right:14px;top:14px;width:270px;max-height:46%;overflow:auto;background:rgba(25,20,14,.91);border:2px solid #6b5030;border-radius:6px;color:#f0dfbd;font:12px/1.35 Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.45);padding:9px;display:none;pointer-events:auto}#story-tracker .story-head{font-weight:bold;color:#f6c86d;margin-bottom:5px}#story-tracker .story-mission{padding:6px 0;border-top:1px solid rgba(226,190,126,.18)}#story-tracker .story-mission:first-child{border-top:0}#story-tracker .story-title{font-weight:bold;color:#fff0c9}#story-tracker .story-objective{margin-top:3px;color:#d9c59f}#story-tracker .story-progress{margin-top:3px;color:#a9e09c}#story-tracker .story-choice-box{margin-top:7px;padding-top:7px;border-top:1px solid #70573a}#story-tracker .story-choice-title{font-weight:bold;color:#f6c86d;margin-bottom:5px}#story-tracker button{display:block;width:100%;text-align:left;margin:4px 0;padding:6px 7px;background:#3a2b1d;color:#f7e8c8;border:1px solid #82613a;border-radius:4px;cursor:pointer}#story-tracker button:hover{background:#513a23}#story-tracker button:disabled{opacity:.55;cursor:default}#story-tracker .story-narrative{margin-top:7px;padding-top:7px;border-top:1px solid #70573a;color:#f5e2bd}#story-tracker .story-narrative p{margin:3px 0}@media(max-width:700px){#story-tracker{right:7px;top:7px;width:230px;max-height:38%;font-size:11px}}';
        document.head.appendChild(style);

        panel = element('div');
        panel.id = 'story-tracker';
        panel.setAttribute('aria-live', 'polite');
        panel.appendChild(element('div', 'story-head', 'Missões'));
        panel.appendChild(element('div', 'story-missions'));
        panel.appendChild(element('div', 'story-choices'));
        panel.appendChild(element('div', 'story-narrative'));
        var host = document.getElementById('canvasborder') || document.getElementById('container') || document.body;
        host.appendChild(panel);
        return panel;
    }

    function hasContent(panel) {
        return panel.querySelector('.story-missions').childNodes.length > 0 ||
            panel.querySelector('.story-choices').childNodes.length > 0 ||
            panel.querySelector('.story-narrative').childNodes.length > 0;
    }

    function renderState(client, payload) {
        var panel = ensureUi(),
            missions = panel.querySelector('.story-missions'),
            choices = panel.querySelector('.story-choices'),
            list = payload && Array.isArray(payload.missions) ? payload.missions : [],
            pending = payload && Array.isArray(payload.choices) ? payload.choices : [];

        while(missions.firstChild) { missions.removeChild(missions.firstChild); }
        while(choices.firstChild) { choices.removeChild(choices.firstChild); }

        list.forEach(function(mission) {
            var box = element('div', 'story-mission');
            box.appendChild(element('div', 'story-title', mission.title || mission.missionId || 'Missão'));
            if(mission.objective) { box.appendChild(element('div', 'story-objective', mission.objective)); }
            box.appendChild(element('div', 'story-progress', String(mission.progress || 0) + ' / ' + String(mission.amount || 1)));
            missions.appendChild(box);
        });

        pending.forEach(function(group) {
            var box = element('div', 'story-choice-box');
            box.appendChild(element('div', 'story-choice-title', (group.missionTitle || 'Escolha') + ':'));
            (Array.isArray(group.choices) ? group.choices : []).forEach(function(choice) {
                var button = element('button', '', choice.text || 'Escolher');
                button.type = 'button';
                button.onclick = function() {
                    var buttons = box.querySelectorAll('button');
                    for(var i = 0; i < buttons.length; i += 1) { buttons[i].disabled = true; }
                    client.sendMessage([
                        StoryProtocol.STORY_CHOICE_SELECT,
                        String(group.storyId || ''),
                        String(group.missionId || ''),
                        Number(choice.index)
                    ]);
                };
                box.appendChild(button);
            });
            choices.appendChild(box);
        });

        panel.style.display = hasContent(panel) ? 'block' : 'none';
    }

    function renderNarrative(lines) {
        var panel = ensureUi(), narrative = panel.querySelector('.story-narrative');
        while(narrative.firstChild) { narrative.removeChild(narrative.firstChild); }
        (Array.isArray(lines) ? lines : []).slice(0, 100).forEach(function(line) {
            if(String(line || '').trim()) { narrative.appendChild(element('p', '', line)); }
        });
        panel.style.display = hasContent(panel) ? 'block' : 'none';
    }

    GameClient.prototype.init = function(host, port) {
        originalInit.call(this, host, port);
        this.handlers[StoryProtocol.STORY_STATE] = this.receiveStoryState;
    };

    GameClient.prototype.receiveStoryState = function(data) {
        renderState(this, data && data[1] || {});
    };

    GameClient.prototype.receiveStoryDialogue = function(data) {
        if(data && Number(data[1]) === 0) {
            renderNarrative(Array.isArray(data[2]) ? data[2] : []);
            return;
        }
        return originalStoryDialogue.call(this, data);
    };

    return {
        ensureUi: ensureUi,
        renderState: renderState,
        renderNarrative: renderNarrative
    };
});
