from pathlib import Path

p = Path('.github/workflows/ci.yml')
s = p.read_text()

old = '    branches: [main, modernize-node, aapanel-visual-installer, world-editor]'
new = '    branches: [main, modernize-node, aapanel-visual-installer, world-editor, brain-system]'
if old not in s:
    raise SystemExit('CI branch anchor missing')
s = s.replace(old, new, 1)

old = '''      - name: Syntax and aaPanel checks
        run: |
          npm run check
          npm run doctor:aapanel
'''
new = '''      - name: Syntax, Brain System and aaPanel checks
        run: |
          npm run check
          node test/brain-smoke.js
          npm run doctor:aapanel
'''
if old not in s:
    raise SystemExit('CI syntax anchor missing')
s = s.replace(old, new, 1)

old = '''            storyId: 'story-test', missionId: 'mission-test', completionMissionId: ''
          });
          world.mobs.push({
            id: 'mob_test_rat', name: 'Rato Alfa', baseKind: 'rat', enabled: true,
            hitPoints: 321, armorLevel: 4, weaponLevel: 7, respawnMs: 4321, aggroDistance: 33,
            drops: [{kind: 'flask', chance: 50}]
          });'''
new = '''            storyId: 'story-test', missionId: 'mission-test', completionMissionId: '',
            brain: {preset:'guard',mode:'patrol',vision:9,wanderRadius:6,thinkMs:1100,fleeFromMobs:false,patrol:[{x:10,y:10},{x:14,y:10}]}
          });
          world.mobs.push({
            id: 'mob_test_rat', name: 'Rato Alfa', baseKind: 'rat', enabled: true,
            hitPoints: 321, armorLevel: 4, weaponLevel: 7, respawnMs: 4321, aggroDistance: 33,
            drops: [{kind: 'flask', chance: 50}],
            brain: {preset:'coward',mode:'wander',vision:8,wanderRadius:7,thinkMs:950,leash:10,fleeBelowHp:0.4,aggressive:true}
          });'''
if old not in s:
    raise SystemExit('CI profile anchor missing')
s = s.replace(old, new, 1)

old = '''          if (server.editorProfiles.npcs.npc_test_guard.name !== 'Guarda do Teste') throw new Error('custom NPC missing');
          if (server.editorProfiles.mobs.mob_test_rat.hitPoints !== 321) throw new Error('custom mob stats missing');
          if (!server.roamingAreas.some(a => a.profileId === 'mob_test_rat')) throw new Error('custom roaming area missing');'''
new = '''          if (server.editorProfiles.npcs.npc_test_guard.name !== 'Guarda do Teste') throw new Error('custom NPC missing');
          if (server.editorProfiles.npcs.npc_test_guard.brain.preset !== 'guard') throw new Error('NPC brain missing');
          if (server.editorProfiles.npcs.npc_test_guard.brain.patrol.length !== 2) throw new Error('NPC patrol missing');
          if (server.editorProfiles.mobs.mob_test_rat.hitPoints !== 321) throw new Error('custom mob stats missing');
          if (server.editorProfiles.mobs.mob_test_rat.brain.preset !== 'coward') throw new Error('mob brain missing');
          if (server.editorProfiles.mobs.mob_test_rat.brain.fleeBelowHp !== 0.4) throw new Error('mob flee threshold missing');
          if (!server.roamingAreas.some(a => a.profileId === 'mob_test_rat')) throw new Error('custom roaming area missing');'''
if old not in s:
    raise SystemExit('CI assertion anchor missing')
s = s.replace(old, new, 1)

p.write_text(s)
