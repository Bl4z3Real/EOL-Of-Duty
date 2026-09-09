# Claude of Duty: Vibe Slops II

[![CI](https://github.com/luckeyfaraday/claude-of-duty/actions/workflows/ci.yml/badge.svg)](https://github.com/luckeyfaraday/claude-of-duty/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/code-MIT-7fffc4.svg)](LICENSE)
[![Play](https://img.shields.io/badge/play-online-7fffc4.svg)](https://vibeslops.luckeysystems.com/)

A browser-based Three.js first-person shooter played on the Black Ops II
Hijacked map export, with capsule collision and a baked Recast navigation mesh.

**[Play Claude of Duty](https://vibeslops.luckeysystems.com/)**

> [!IMPORTANT]
> This is an unofficial, non-commercial fan project. It is not affiliated with,
> endorsed by, or sponsored by Activision, Treyarch, Microsoft, Anthropic, or
> the Call of Duty or Claude brands. The MIT license covers the project's
> original code and documentation only. Exported game art, audio, maps, models,
> animations, names, and other third-party material remain the property of
> their respective owners and are not relicensed. See [Asset rights](ASSET_NOTICE.md).

## Give a shout-out

If you use this code, learn from it, stream it, or build something with it,
please shout out **[Luckey Faraday (@luckeyfaraday)](https://github.com/luckeyfaraday)**
and link back to this repository. That credit is sincerely appreciated and
helps people find the original project. The request is not an extra restriction
on the MIT license; the license's copyright and permission notice still needs
to be preserved in copies or substantial portions of the code. GitHub's
**Cite this repository** control is configured through [CITATION.cff](CITATION.cff).

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request, use the issue templates for bugs and ideas, and follow
the [Code of Conduct](CODE_OF_CONDUCT.md). Security reports should follow
[SECURITY.md](SECURITY.md), not a public issue.

## Run it

Install the JavaScript dependencies once, then serve the web export from the
repository root:

```powershell
npm install
python -m http.server 8000 --directory export/web
```

Open <http://localhost:8000>. The viewer must be served over HTTP; opening
`index.html` directly will not load its modules and binary assets.

Controls:

- `WASD`: move; mouse: look
- `Shift`: sprint; `Space`: jump
- `C` or `Ctrl`: crouch; `B`: respawn
- `Left mouse`: fire; `R`: reload
- `Right mouse`: aim down sights
- `Mouse wheel`, `1`, `2`: switch between the class's primary and secondary
- `Shift` while scoped: hold breath
- `E`: melee (the knife with a rifle, a pistol-whip with a pistol)
- `G`: frag grenade, held to cook; `Q`: smoke grenade
- `K`: cycle the weapon camo (a random one is dealt each page load)
- `Tab`: hold the free-for-all scoreboard
- `N`: navmesh overlay; `V`: collision overlay
- `P`: find and draw a navmesh path to the point under the crosshair
- `Esc`: pause and release the mouse
- Title screen: click a map card to switch maps (reloads with `?map=`)

On a phone or tablet, tap **Tap or click to load**, then tap to deploy once the
game is ready. Drag the left stick to walk and push it
fully forward to sprint. Swipe on the right to look; hold **FIRE** and drag it
to aim while shooting. **AIM** and **CROUCH** toggle, while **JUMP** and
**RELOAD** act on a tap. Aiming or firing automatically interrupts sprint.
Tap **SWITCH** to swap the class's guns, **MELEE** to attack at close range,
or **SMOKE** to throw smoke. Hold **FRAG** to cook it and release to throw;
the equipment buttons show the remaining counts. Cancelling a touch, pausing,
or rotating the screen clears a held grenade without an accidental throw.
The top-right buttons open scores and pause. The pause menu includes class
selection, saved look sensitivity, and optional full screen. Both orientations
work; landscape leaves more room around the controls.

Mobile graphics default to **Auto**, which starts at up to 1.5× resolution
and adjusts gradually to sustained frame times. **Performance** uses up to
1× resolution and disables edge smoothing; **Quality** uses up to 2× with
stronger texture filtering. Both Auto and Quality smooth the scene and weapon
edges using supported HDR multisampling, with FXAA as the fallback. Resolution
stays within pixel and GPU size limits. Choose a preset from the title or pause
menu; the selection is saved on the device.

## Frontend

The viewer opens on a menu shell rather than a bare loading message. It has a
loading screen, a title screen, and an `Esc` pause menu, all sharing one set of
layers built from the game's own frontend art in `zone/all/ui_mp.ff`: the
`menu_mp_background_main2` backdrop, a scrolling `bg_fogscrollthin` strip, the
`menu_mp_background_glow` plate, and the `menu_mp_map_select_hijacked_final`
map card. The pause buttons and panel use `menu_button_backing` and
`menu_mp_lobby_frame_outer`.

Those plates ship white-on-alpha because the game tints them at runtime, so the
browser does the same through `mask-image`. The single `--fe-accent` custom
property in `index.html` recolours every panel, button, and glow at once; it is
set to the HUD's mint rather than the game's blue. The layout is not the
original: T6 menudefs do not dump (the Unlinker lists all 133 in `ui_mp.ff` and
writes none of them), so only the art is reused.

The load bar measures stages declared up front with fixed weights. The visible
map ships as one Meshopt-compressed GLB containing GPU-compressed KTX2 textures,
so its transfer accounts for the dominant loading stage. Models are downloaded
through the native response body before parsing; this avoids intermittent
aborted model requests observed with a wrapped progress stream in Chrome.
A stage is held below
its full weight until its promise settles, preventing the bar from reaching
100% before the game is playable.

Re-export the menu art with:

```powershell
python .tools/export_ui.py
```

It dumps `ui_mp.ff` and converts the dozen images the menu uses into
`export/web/ui/` (~1.4 MB), leaving the other 513 in the zone.

The original in-game HUD art is exported the same way into
`export/web/ui/hud/`:

```powershell
python .tools/export_hud.py
```

It dumps `common_mp.ff` and `mp_hijacked.ff` and converts everything matching
the HUD filters — compass ring, pings, and the `compass_map_mp_hijacked` radar
map, waypoints, killstreak and killfeed icons, fire-mode selectors, grenade
icons, damage feedback, and the low-health overlays (~2 MB). The HUD's layout
menudefs do not dump for T6, so the browser would rebuild placement itself and
draw with this art.

## Play counter

The title screen shows how many people have played, under the prompt:

```
3 PLAYERS · 8 PLAYS
```

Production is being migrated from Netlify to Cloudflare Pages. The Cloudflare
backend is `functions/api/plays.js`, with separate D1 databases for production
and branch previews so automated checks and preview visits cannot change the
public totals. `wrangler.jsonc` is the source of truth for those bindings.

Cloudflare cannot upload the bake inputs that live beside the runtime export:
some are unused and one exceeds Pages' per-file limit. The staging command
copies only the same runtime package Netlify publishes, without deleting files
from the working tree:

```powershell
npm run cloudflare:stage
npm run cloudflare:dev
```

Apply `migrations/0001_play_counter.sql` to both D1 databases once, then deploy
the staged package with `npm run cloudflare:deploy`. Branch deployments select
the preview database through `CF_PAGES_BRANCH`; only `main` uses the production
counter.

`players` counts browsers that have started a match, `plays` counts sessions
that have. The split is deliberate: `players` is the honest answer to "how many
people have played", and `plays` is the one that moves.

`export/web/play-counter.js` holds the client half and, like `frontend.js`,
touches no DOM so it tests in node. A play is recorded when a desktop player
takes pointer lock or a touch player deploys. Social-card scrapers and bounced
tabs never reach it; the automation harness enters through `setAutomationActive`
without counting a play, and the mobile harness uses a local counter stub. The first
record per page session latches, so resuming from the pause menu does not count
again. New-versus-returning is a `vibeslops:player` key in `localStorage` —
clearing site data counts you again, which is unavoidable without asking
anonymous players to sign in.

The server half is `netlify/functions/plays.mjs`, on Netlify Blobs. Both counts
live under one key so a reader cannot catch the pair mid-update, and the
increment is a compare-and-swap against the entry's ETag with a short retry
ladder: Blobs has no atomic add, and a plain read-modify-write would silently
drop a count whenever two players started at the same moment.

The counter is decoration and fails silently — offline, blocked, or served by
the static dev server above, which has no function and simply 404s, the line
stays blank rather than breaking the frontend. There is no "am I in production"
check, so `netlify dev` exercises the real thing against its own local blob
store:

```powershell
npx netlify dev
```

`netlify.toml` exists only to name the publish and functions directories; it
restates the `export/web` the site already served, since a `netlify.toml`
overrides the Netlify UI's settings.

### Bandwidth

Nothing heavy is fetched until the page sees a pointer move, key press, wheel
or touch. A visit that never gets that far costs about 2.6 MB; one that plays
costs about 47 MB. The gate exists because the account went over its Netlify
bandwidth limit twice on traffic that was not players: the play counter read
867 plays all-time while September burned 125 GB in two days, so the bytes were
going to crawlers, link previews and people who bounced off the title screen.
Shrinking the files (`.tools/prune-deploy.sh`, the ETC1S re-bake) had already
been tried and was not enough on its own.

Two consequences worth knowing:

- Automation must either send input or opt out with `?autostart=1`. Desktop
  smoke checks opt out; `ai:mobile` tests the welcome prompt and sends a real
  touch before the game modules finish loading, then verifies startup completes
  with exactly one map download. Early visitor input is remembered while scripts load.
- Only the equipped rifle loads at boot. The other eight are fetched when the
  class screen opens, so scripted runs that select a rifle directly need
  `await hijacked.debug.loadAllWeapons()` first.

`export/web/_headers` caches art for a week and leaves the baked map set
revalidating, because the .glb, the collision BVH, the navmesh and the probes
are baked together and have to stay in step. Pinning them needs content-hashed
filenames first. `export/web/robots.txt` keeps crawlers off the asset tree.

## First-person viewmodel

The viewer renders the game's weapon viewmodels with FBI shortsleeve viewhands
in a dedicated depth-cleared pass so they never clip into walls. Every weapon
is one entry in `export/web/weapons.js`: nine assault rifles (M27, AN-94, FAL
OSW, SMR, SCAR-H, SWAT-556, MTAR, Type 25, M8A1) and four pistols (Five-seven,
Tac-45, KAP-40, B23R), each with its magazine, cadence, fire type (automatic,
semi-automatic or burst), damage, model, world model and clip names taken from
the T6 weapon file. Create-a-class is tabbed like the game's: Primary,
Secondary, Lethal and Tactical, one pick each, with the four sniper rifles
(see "Sniper rifles and the scope") in the primary tab. The mouse wheel and `1`/`2`
move between the two guns; a life starts on the primary. Pistol magazines are
part of the gun model, so they load no separate attachment and reload on the
gun's own `tag_clip`.

To add a weapon: dump `common_mp.ff` with the Unlinker (see "Adding a
weapon"), add its models, clips and textures with
`python .tools/import_weapon_assets.py --dump <folder>`, emit its entry with
`python .tools/generate_weapon_definitions.py <id>` and paste it into
`weapons.js`, then regenerate `weapon-ballistics.js` with `--all --ballistics`.
The rigs come from the game export; the copies served to the browser live in
`export/web/viewmodel/`. The weapon is mounted by aligning
its `j_gun` joint to the hands' `tag_weapon` joint, and the whole rig is
anchored at `tag_view` with the engine view axes (X forward, Z up) mapped to
the camera. It includes look sway, walk bob, a sprint pose, and hold-right-
mouse ADS, which rotates the gun square to the view axis and seats the eye
7 units behind `tag_sights` for a proper iron-sight picture.

### Camos and skins

Weapon camos are the game's own. T6 paints a camo by swapping the diffuse on
every `_camoN` material of a gun, which is what `viewmodel.js` does with the
tiles in `export/web/images/camo/`: twenty-one Black Ops II unlock camos (ERDL,
Choco, Kryptek Typhon, Blue Tiger, Skulls and the rest, written from the
game's `t6_camo_<name>_pattern` images by `import_weapon_assets.py`) plus the
two project tiles. The catalog is the `WEAPON_CAMOS` array in
`export/web/skins.js`; a camo is one row and one tile. The player is dealt a
random camo on each page load and keeps it until `K` cycles; every weapon slot
wears the same one so switching guns never changes it. Bots are dealt a camo
each too, painted onto their world rifle before it is baked, and keep it for
the match.

Operator skins are the `PLAYER_SKINS` array in the same file. Every bot is the
exported PLA assault body; a skin recolours its clothing textures (a hue
rotation, saturation, brightness and a tint applied while the body atlas is
packed, leaving the head, gloves and visor alone). Six bots are dealt six
different skins at match start and keep them through every respawn. A second
body mesh (SEALs, Mercs, ISA, the other PLA classes) is a `bodyUrl` and texture
set the enemy loader already accepts once it is dumped from the faction zones
(`faction_seals_mp.ff` and friends); it belongs in the same catalog.

Both rifles fire automatic camera-centered hitscan rounds against the collision
scene. The AN-94 uses its native 40 damage, 625 RPM sustained cadence, and
937.5 RPM two-round hyperburst. Shots use each rifle's authored hip/ADS fire
animations and include view recoil, a `tag_flash` muzzle flash, each rifle's own
player-shot sample over the shared decay/LFE layers, tracers, persistent impact
marks, a 30-round magazine, and eight reserve magazines. Every respawn restores the full
`30/240` life loadout.

Rounds that connect raise a hitmarker on the crosshair: white for a body hit,
gold for a head hit, and a longer-lived red marker for a kill. Each is paired
with a short synthesized tick — the extracted banks carry no UI alias — routed
around the gunfire compressor so the confirmation is not ducked by the shot
that earned it.

## Gunplay

Ballistics come from the BO2 weapon files rather than hand tuning.
`.tools/generate_weapon_definitions.py --all --ballistics` reads the records
Unlinker dumps from `common_mp.ff` into `artifacts/weapon-data/weapons/` and
writes `export/web/weapon-ballistics.js`; `export/web/gunplay.js` turns those
numbers into behaviour, and `test/gunplay.test.mjs` pins the rules down:

- **Range falloff.** Stepwise, as the engine does it: full `damage` out to
  `maxDamageRange`, then each `damageRangeN` band, then `minDamage`. The M27
  does 33 to 500 units, 30 to 1300, 22 beyond.
- **Locational damage.** The file's `locHead`, `locTorsoUpper` and
  `locRightLegUpper` multipliers replace the old fixed head and leg factors.
  On the rifles that is 1.1x to the head and 1x elsewhere.
- **Hip spread.** `hipSpreadStandMin` at rest, `hipSpreadDuckedMin` crouched,
  `hipSpreadMoveAdd` scaled by speed, `hipSpreadFireAdd` bloom per shot
  decaying at `hipSpreadDecayRate`, capped at `hipSpreadMax`. ADS blends the
  cone to `adsSpread`. Rounds are sampled uniformly over the cone's disc.
- **View kick.** Each shot draws a pitch and yaw inside the file's
  `hipViewKick*` or `adsViewKick*` range, then the view recentres at
  `viewKickCenterSpeed`, returning about half of each kick so a held burst
  climbs and settles. `adsViewKickMinMagnitude` floors aimed kicks.
- **Flinch.** Taking a hit jolts the view up and away from the shooter,
  scaled by damage, and recentres the same way.
- **Sprint-out.** Firing or aiming breaks the sprint and the gun waits
  `sprintOutTime` before it can fire; releasing sprint starts the same timer.
- **ADS timing.** The sight raises and lowers on `adsTransInTime` and
  `adsTransOutTime` with an ease, replacing the fixed damp.
- **Penetration and collaterals.** A round is traced as a chain of segments.
  Bodies never stop it; each one passed scales the damage that follows by
  0.7, which is what makes a collateral possible. Glass and open fences are
  passed for free. Thin materials (wood, plaster, cloth, plastic, foliage,
  carpet, ceramic) each spend one point of the file's `penetrateType` budget
  (none 0, small 1, medium 2, large 3) and scale damage by 0.75. Concrete,
  brick, metal and the like stop the round. The surface comes from the same
  world-shell probe the footsteps use; the collision mesh has no materials.

Bullet holes use the game's impact decals by surface class (concrete, metal,
plaster, glass, fabric) from `export/web/textures/fx/impact_*.png`.

- **Destructible mannequins.** Nuketown's mannequins lose their heads and
  arms. Each is one rigid model in the game, with the head, hair and arms as
  separate shells in the mesh, so `compose_scene.py` splits every
  `dest_nt_nuked_*_d0` placement into `dm_<n>_body`, `dm_<n>_head` and
  `dm_<n>_arm_*` nodes (a shell in the top quarter is the head, a shell of
  the skin material hanging mid-height is an arm; the male arms are part of
  the jacket and stay on). The bake instances repeated parts, so at runtime
  a part is either its own mesh or one instance of an InstancedMesh;
  `destructibles.js` finds both by name, and a round that reaches one sends
  the piece tumbling off the stand with the game's `fly_bump_mannequin` cue
  (a loose instance is scaled away and a plain copy takes its place). The stand keeps its
  collision, so later rounds are passed through the space a lost piece left.
  Mannequins count as plastic for penetration.

Hits on a body draw blood from `export/web/textures/fx/`: a burst and a wall
splatter using the game's opaque character blood decal, an additive red mist
from its gush mask, and drawn drops that carry on past the body under
gravity. The game's burst masks themselves are white alpha textures meant for
additive FX and are nearly invisible tinted, which is why they are not the
burst here. The debug state exposes `weapon.spreadDegrees`,
`weapon.sprinting` and `weapon.sprintOutBlocked`.

### Sniper rifles and the scope

Four snipers sit in the primary slot after the assault rifles: DSR 50 and
Ballista (bolt-action) and SVU-AS and XPR-50 (semi-automatic). The scope is
built the way the game builds it. Every weapon file carries three ADS zoom
slots (`adsZoomFov1/2/3`); on a base weapon they are equal, 15 degrees for
three of these and 20 for the SVU, so a gun has one zoom level and the
Variable Zoom attachment is what gives it several. The world camera zooms
toward that FOV as the sight comes up; at the top of the raise
(`adsZoomInFrac` 0) the rig leaves the view and the game's own overlay
image for that scope (`ui/scope/scope_overlay_<gun>.png`, from
`adsOverlayShader`) stands in for the glass, with a crosshair reticle; at
the first touch of the lower (`adsZoomOutFrac` 0.05) it goes again. Mouse
sensitivity scales with the zoom. In the glass the view sways on a slow
figure of eight sized by the file's `adsIdleAmount` (26 to 60); holding
`Shift` (or hold **STEADY** on touch) steadies it for five seconds, then it returns while the lungs
recover. The bolt-actions play their `rechamberAnim` (the scoped one while
aimed) after every shot and cannot fire until it ends. Reloading interrupts the bolt cycle. Damage is
the file's: 95 to 98 flat to 3000 or 4000 units with head 2x and upper
torso 1.5x, so a chest hit kills. The bots carry a chest box and a lower
torso box because the files score them apart (the DSR 50's lower torso is
1.5x, the XPR-50's is 1x). Bots draw snipers with the rest of the roster.
The XPR-50's clips were authored against a hands rig whose torso sits 13
units ahead of the FBI viewhands' bind, so its entry carries a `torsoBind`
that the viewmodel applies before the clips play; without it the receiver
sits in the camera.

### Fire modes, melee and grenades

- **Fire modes.** The weapon file's `fireType` sets the controller: automatics
  fire while the trigger is held, semi-automatics (FAL OSW, SMR, Five-seven,
  Tac-45) once per pull, bursts (SWAT-556, M8A1, B23R) their `burstCount` per
  pull, all at the file's cadence. Tapping cannot beat `fireTime`.
- **Melee.** `E` swings. Rifles use the combat knife: knife_mp's two shared
  clips, the knife model on the hands' `tag_knife_attach`, 150 damage (one
  hit kills), the blade landing `meleeDelay` 0.125 s into a 0.8 s `meleeTime`
  lockout. Pistols play their own tactical-melee whip. A target within 64
  units and inside a 32 degree cone is hit; one a little further but dead
  ahead is lunged to, as the game does. A miss into a wall plays the knife's
  object hit. Sounds are the game's `wpn_melee_*` aliases.
- **Grenades.** `G` pulls the frag's pin and starts its 3.5 s fuse; letting go
  throws it, so a held frag cooks. `Q` pops the smoke. Both leave the hand at
  the file's `projectileSpeed` of 920, lofted a little above the aim line, and
  `grenades.js` flies them under gravity, bounces them off the collision BVH
  with the game's grenade restitution, rolls them to a stop and fires the
  fuse. The frag deals `explosionInnerDamage` 200 falling to
  `explosionOuterDamage` 75 across `explosionRadius` 256, blocked by solid
  cover, to bots and the player alike; the smoke stands a 220 unit cloud for
  12 s that the bots cannot see through. The game's own bodies are shown in the
  hand (on the throwing wrist, since the M67 clips park the grenade
  viewmodel's `tag_weapon` out of view) and in flight, and its pin, throw,
  bounce-by-surface, blast and hiss aliases play. Counts restore each life.
  There is no throw arc: Black Ops II shows none, the grenade goes where the
  view points.
- **Long shots.** A kill from over 1500 units awards the game's Long Shot
  medal and the kill feed shows the range in metres. Black Ops II shows no
  range readout otherwise, so neither does the HUD.

## World sound

`export/web/world-audio.js` plays the game's own aliases for footsteps and
landings (player and bots, by surface and pace), body falls, bullet debris
by surface, flesh hits and headshots, whiz-bys and cracks from rounds that
pass the listener, and bot death vox. Surfaces are read off the visible
world shell's material names through a BVH probe, so grass, wood, metal,
concrete and the rest each get their own set.

On top of that: aim raise and lower, weapon raise and holster on a switch,
the first raise on spawn, sprint cloth and gear, hurt breathing under 35
health, each rifle's own dry fire, the game's hitmarker alert instead of
the synthesized tick, and the bots' M27 report from its NPC alias (near or
distant, with decay). The menu plays the UI set on hover, select, back and
pause. Music covers the spawn sting, the one-minute timer piece, the last
ten seconds' beeps, and the victory, loss or draw result; the long frontend
and action beds are left out of the extraction to keep the deploy light.

### The mix

Every alias in the game's soundbank tables carries its own volume (0-100),
the range it plays at full level (`DistMin`), the range it has faded to
nothing by (`DistMaxDry`) and the bus it sums into. `world_audio_manifest.mjs`
writes those four into `world-map.json` as `mix`, and `WorldAudio.play` reads
them back: the alias volume scales the gain (a power law, `VOLUME_CURVE`, that
keeps the player's rifle at 93 near full level and puts the 60-75 ambience
loops 8-12 dB under it), a positional cue's panner runs a linear curve from
`DistMin` to `DistMaxDry`, and the alias bus picks the output. There are five
buses: FX (gunfire, impacts, foley, through the compressor), ambience, music,
voice and UI, mirroring the game's `bus_fx`, `bus_music`, `bus_voice` and
`bus_ui`. The player's own shots duck the ambience bus for a moment the way
the game's `wpn_cmn_shot_plr` duck snapshot does.

Ambience comes from the map's own emitters: `script_struct` entities with a
`script_sound`, exported into the nav hints by the collision exporter. Each
loop runs only inside its own `DistMaxDry`, which is 50 to 225 units for the
vents, hums and interior winds; nearest emitters fill the slots first, at
most ten at once, each on its own HRTF panner; random emitters fire every 6
to 20 seconds inside their range; the map's stereo bed (`amb_main_bg_l` and
`_r` on Nuketown, the ocean pair on Hijacked) runs hard-panned underneath.
This is what fixed the Nuketown drone: the runtime used to play every loop
out to 1600 units on one gunfire-style distance curve, so eight appliance-hum
loops authored to die within 100 units summed into a constant low tone across
the whole map. Ambience aliases are keyed per map bank
(`amb_ac@mpl_nuketown_2020.all`), because the same name is a different
recording on each map. The announcer is not in this install's banks, so there
is none.

The samples live in each map's soundbank, `sound/mpl_<map>.all.sabl`, with
the death vox streamed from `sound/mpl_common.all.sabs`. To extract them:

```sh
BO2_ROOT=<folder with zone/all and sound> node .tools/dump_soundbanks.mjs artifacts/soundbanks-pluto
node .tools/world_audio_manifest.mjs --dump artifacts/soundbanks-pluto            # what resolves
node .tools/world_audio_manifest.mjs --dump artifacts/soundbanks-pluto --extract  # copy samples, write the map
```

That writes `export/web/audio/world/*.wav` (and `.flac` for the streamed
vox, which browsers decode natively) and `export/web/audio/world-map.json`:
359 aliases over 34 sample groups, 9.5 MB. The dump goes beside
`artifacts/soundbanks` rather than into it because the weapon audio tests
compare that folder against the maintainer's checked-in expectations.
Without the map every cue is silent; nothing else changes.

## Free for all

The browser runs a seven-combatant free-for-all: the player and six named PLA
bots, first to 30 kills or the leader after five minutes. The match HUD shows
score, time, placement, and a kill feed; holding `Tab` opens the full standings.
Death keeps the fight visible behind a killer/respawn card, then selects a safe
authored `mp_dm_spawn`, restores the loadout, and grants brief spawn protection.

Six PLA assault enemies spawn across the map's authored FFA markers and
move with the baked Detour crowd. Each is dealt its own class at match start
and keeps it through every respawn: a random rifle from the roster (its own
world model, magazine, cadence and range falloff, with the NPC report alias of
that rifle), a random camo painted on it, and an operator skin (see "Camos
and skins"). Bot rounds do their rifle's damage by range scaled by
`botDamageScale` (24/33), which keeps the M27 where the old flat 24 had it
and lets a FAL hit harder than a Type 25. Smoke between a bot and its target
breaks its line of sight. They patrol, acquire the player through
field-of-view and collision-based line-of-sight checks, pursue, fire, remember
the last seen position, search nearby navigation points after losing contact,
die, and respawn. Bots use the same perception and damage paths against every
other living combatant, so bot-versus-bot kills count in the standings. Every
enemy with visibility and a clear firing line can shoot; individual reaction
delays, bursts, reloads, movement-sensitive
accuracy, suppression, and tactical repositioning keep the fight readable
without an artificial attacker cap. The browser uses the exported PLA
body, M27 world model, and converted `pb_*` body animations, with separate
head, torso, and leg damage zones.

The HUD is drawn with the game's own art (`export/web/ui/hud/`, dumped by
`.tools/export_hud.py`; layout rebuilt in `export/web/hud.js` since T6 HUD
menudefs do not dump): a rotating radar minimap built on the
`compass_map_mp_hijacked` radar texture with firing-enemy pings, the compass
tape, and the digit-based ammo counter. Health reads through the low-health
vignette and damage flash rather than a bar, as in the game.

The rifle rides `tag_weapon_right`, the body's own weapon socket, the same way
the viewmodel welds `j_gun` to the hands' `tag_weapon`. Two details do not come
free. The stance clips have to be the weapon set (`pb_stand_alert`,
`pb_combatrun_forward_loop`); the `pb_hold_*` set is T6's carry stance, which
poses the hands for an object and parks the socket somewhere unrelated. And the
clips and the PLA rig disagree about the socket offset — the clips put it about
14 inches from the wrist, the model's bind 11.4 — so the socket is calibrated
once per stance against the authored trigger hand, which lands the grip within
about a sixth of an inch of the wrist. `pb_death_faceplant` animates the
socket 30 inches clear of the body because T6 drops the weapon on death, so the
falling body instead keeps the rifle welded to its trigger hand.

Enemy fire is audible and locatable. Every shot lights a pooled additive sprite
at the shooter's `tag_flash` and plays a panned report through an HRTF
`PannerNode` whose distances are tuned to Radiant inches, with a distance-driven
lowpass standing in for air absorption. The export ships only the
player-perspective M27 alias, so that report is derived from it rather than
sampled from a true `_npc` variant; extracting those from `mpl_common` would
replace the filtering with the authored sound. The flashes are deliberately
unlit sprites — a `PointLight` per shot would recompile every material it
reached, undoing the load-time shader warm-up.

## Maps

The title screen lists every map in `export/web/maps.js`. The map is fixed
before the payload loads, so picking a different card reloads the page with
`?map=<id>`; the choice is remembered in `localStorage`. A map whose bake has
not landed is shown dimmed and cannot be picked, and nothing is fetched for
it. `?map=mp_nuketown_2020` on such a map fails with a message naming it
rather than a broken asset load.

Each map's entry names its prefix, title card, radar art, sky and probe
folders, LUT, vision set, radar view radius, and optionally `hiddenNodes`,
baked render nodes the runtime hides by name. Nuketown lists the hydro car's
client-side display case (`fxanim_mp_nuked2025_display_glass_mod`): it is an
FX-animation model the game poses with an xanim the composer never plays, so
its bind pose puts the case 30 to 60 units under the road and left only the
sign panel floating over the buses. The server-side brush copy of the case is
the right one; `.tools/export_collision.py` now draws that and skips the
fxanim copy, which takes effect on the next Nuketown bake (the `ktx` tool the
bake needs is not installed here, so the shipped GLB still carries the old
node and the registry hides it).

Water is shaded at load rather than baked: `lighting.js` gives every water
material a low roughness so it reflects the sky probe and an `onBeforeCompile`
that perturbs the shading normal with two wave trains and drifts the colour
map, sharing one clock. Hijacked's ocean and the pool and hot tub caustics
take it; the deck pool's material ships with no colour map at all in the
source and gets a translucent water tint. Nuketown has no water. The map's
water normal maps were never carried through the bake, which is the next step
for a truer surface. Every baked file is derived
from the prefix, so `mp_hijacked` reads `hijacked_*` and `mp_nuketown_2020`
reads `nuketown_2020_*`. The radar is calibrated at load from the map's own
`minimap_corner` entities, carried in `<prefix>_nav_hints.json`.

## Rebuild collision and navigation

Python 3 is required. The scene composer also runs the collision exporter.
Every command takes a map and defaults to `mp_hijacked`:

```powershell
python .tools/compose_scene.py mp_hijacked
npm run bake:map -- --map mp_hijacked
npm run bake:collision -- --map mp_hijacked
npm run bake:ladders -- --map mp_hijacked
npm run bake:navmesh -- --map mp_hijacked
npm run bake:env -- --map mp_hijacked
npm run bake:probes -- --map mp_hijacked
```

The first command rebuilds the source render scene, collision-only glTF, and
spawn/pathnode navigation hints. Brush model surfaces (the entities' `*N`
inline models: glass panes, the living room carpet, roof panels) are authored
around their own origin, so both exporters move them to the entity that owns
them using the dump's `brushModels` table; without it they would pile up at
the map origin. Triggers, clip volumes and the server-side copy of the display
case are left out. The bake commands then create the optimized
render GLB, collision BVH, ladder volumes, serialized Recast navmesh, sky and
grading assets, and the light probe volume loaded by the browser. `bake:map`
requires Khronos KTX-Software's `ktx` executable on `PATH`; `bake:env` needs
`texconv.exe` in `.tools/`.

Generated runtime assets are in `export/web`, named from the map prefix:

- `<prefix>.gltf` / `.bin`: visible map (bake input only)
- `<prefix>_collision.gltf` / `.bin`: physics-only geometry (bake input only)
- `<prefix>_optimized.glb`: Meshopt/KTX2 runtime render map
- `<prefix>_collision_bvh.bin` / `.json`: runtime collision BVH
- `<prefix>_nav_hints.json`: spawns, pathnodes, traversal links, minimap corners
- `<prefix>_ladders.json`: ladder volumes
- `<prefix>.navmesh.bin` / `.json`: baked Recast mesh and build metadata
- `<prefix>_probes.bin` / `.json`: light probe volume

### Dumping a map from the game

The source files under `export/maps/mp/`, `export/xmodel/`, `export/images*/`
and `export/vision/` come from [OpenAssetTools](https://github.com/Laupetin/OpenAssetTools)'
`Unlinker`, which reads the PC release fastfiles directly (they are signed and
Salsa20-encrypted; Unlinker handles that). Upstream has no BO2 render world
dumper, so `.tools/oat/t6-gfxworld-dumper.patch` adds one that writes the
`*.gfxworld.{json,vd0,vd1,idx}` set the composer reads, including the
`brushModels` table that places the `*N` inline models.
`.tools/oat/macos-build-fixes.patch` carries the include and premake fixes
needed to build with Apple clang, `.tools/oat/t6-image-diagnostics.patch`
adds the image lookup details to the "Could not find data" error, and
`.tools/oat/UPSTREAM_COMMIT` names the upstream revision all three were made
against. Build it with:

```sh
git clone https://github.com/Laupetin/OpenAssetTools.git && cd OpenAssetTools
git checkout "$(cat ../.tools/oat/UPSTREAM_COMMIT)"
git apply ../.tools/oat/*.patch
PREMAKE_NO_PROMPT=1 ./generate.sh --cc=clang
make -C build -j10 config=release_x64 UnlinkerCli
cp build/bin/Release_x64/Unlinker ../.tools/Unlinker
```

Then dump a map zone. BO2 keeps image pixels in `.ipak` packs beside the
fastfiles, so put `zone/all/<map>.ipak` and `zone/all/base.ipak` next to the
`.ff` or the images come out as 1000-odd "Could not find data" errors:

```sh
.tools/Unlinker -o dump --image-format DDS --model-format OBJ \
  --exclude-assets soundbank,techniqueset,fx,script,xanim,physpreset,physconstraints,footsteptable,destructibledef,weapon,fximpacttable,material \
  path/to/mp_nuketown_2020.ff
```

Copy `dump/maps/mp/*` to `export/maps/mp/`, `dump/xmodel/**` to
`export/xmodel/`, `dump/model_export/**` to `export/model_export/`,
`dump/vision/*` to `export/vision/`, and `dump/images/*` to a per-map folder
such as `export/images_nuketown/` (every map names its reflection probes the
same, so they cannot share one). Convert the textures with:

```sh
python .tools/convert_textures.py dump/images export/web/textures
```

`bake:map` needs the `ktx` CLI from KTX-Software. Without admin rights, expand
the macOS `.pkg` with `pkgutil --expand-full` and put its `usr/local/bin/ktx`
on `PATH`; the binary finds `libktx` next to it via rpath.

### Adding a weapon

The weapon assets live in `common_mp.ff`. Dump its models, animations and
images from the game's own `zone/all` (so the image packs resolve), with the
code zone preloaded so the streamed textures find their data:

```sh
cd <game>/zone/all
OAT_EXTRA_IPAKS=dlc0 <repo>/.tools/Unlinker -o dump --image-format DDS --model-format GLB \
  --include-assets xmodel,xanim,image --search-path "$PWD" -l code_post_gfx_mp.ff common_mp.ff
```

Then, from the repo root:

```sh
python .tools/import_weapon_assets.py --dump dump         # models, clips, textures, camos
python .tools/generate_weapon_definitions.py <id>          # the weapons.js entry
python .tools/generate_weapon_definitions.py --all --ballistics > export/web/weapon-ballistics.js
T6_XANIM_DIR=dump/xanim node .tools/weapon_audio_manifest.mjs artifacts/soundbanks-pluto
node .tools/extract_weapon_audio.mjs --dump artifacts/soundbanks-pluto <id>
```

`import_weapon_assets.py` copies whatever its tables name (view models, world
models, clips, camo tiles) and reads each model's texture list out of the GLB
itself, so a new gun is one row per table. `generate_weapon_definitions.py`
knows the rifles and the four pistols; a new id goes in its `ROSTER` or
`PISTOLS` tuple with its display name. The shot sample and reload foley come
through the weapon audio manifest as before; melee and grenade cues are world
aliases, added to `WORLD_ALIAS_PATTERNS` in `world_audio_manifest.mjs` and
extracted with `--extract`. A card without exported menu art shows its name;
the KAP-40's art came from `code_post_gfx_mp.ff`, the others were not found in
this install's zones.

### Adding a map

Nuketown 2025 (`mp_nuketown_2020`) is complete: geometry, props, all 1201
textures, sky, reflection probe, vision set, LUT, probe volume, radar, title
card and world sound. Two of those needed packs the map zone does not
declare. About 200 of its textures live in `dlc0.ipak`, which Unlinker only
opens when the fastfile sits in the game's own `zone/all` next to every pack.
The title card `menu_mp_map_select_nuketown2020_final` is in `patch_ui_mp.ff`
with its pixels in `dlc0.ipak`, reached with
`OAT_EXTRA_IPAKS=dlc0 .tools/Unlinker ... patch_ui_mp.ff`
(`.tools/oat/t6-extra-ipaks.patch` adds that variable).
`.tools/oat/t6-image-diagnostics.patch` makes Unlinker print each missing
image's part count and hashes, which is how those two were traced.

For any other BO2 map:

1. Dump it as above and copy the files into place. The composer and collision
   exporter report every model or texture they could not find.
2. Add a registry entry in `export/web/maps.js`. The `sources` names come from
   the worldspawn's `skyboxmodel` and `lutmaterial` keys in the `.ents` dump,
   which do not always match the map id.
3. Run the seven bake commands with the map id. The navmesh and probe bakes
   clamp their grids to the pathnode envelope when the collision carries
   distant vista terrain, so a map surrounded by scenery still bakes.
4. Set `baked: true`, add a `/<prefix>*` cache rule to `export/web/_headers`,
   and check it with `AI_GAME_MAP=<id> npm run ai:test`.

`npm run cloudflare:stage` refuses to stage a map marked baked whose render,
collision or navmesh files are missing, warns about missing lighting and art,
and `prune-deploy.sh` strips the bake inputs of every registered map.

The composer and collision export place the render world's static models and
the map's `script_model` entities (Nuketown's vehicles, mannequins, flags and
clocks, Hijacked's lights and umbrellas), skipping gametype props and the
animated copies a map's ending swaps in. Glass renders as a tinted blend and
stays solid in collision, as it is in the game until shot; garage doors, lit
sign boxes and the opaque gloss panels carry glass in their names but stay
solid, and the invisible `glass_clear_wall` boundary keeps its collision and
never draws.

The world is written as one mesh per cell, 1024 units near the playable area
and 8192 out in the vista. `bake:map` quantizes positions to a 14-bit grid
over each mesh's own bounds, so a single world mesh spanning Nuketown's
75k-unit desert put that grid at 4.6 units, sinking carpets into floors and
shifting walls; per cell it is a sixteenth of an inch. Carpets, rugs and
decal layers also get a small depth bias at load.

The collision export combines filtered BSP render surfaces with each placed
xmodel's authored `collLod`. The extracted game files do not include usable T6
clipmap/physics brushes, so this is a close geometry-derived approximation
rather than the original engine collision.

## Tests

Run fast collision and navmesh tests with:

```powershell
npm run test:unit
```

With the localhost server running on port 8000, run the Chrome/Edge smoke test:

```powershell
npm run test:browser
```

`npm test` runs both sets.

## AI visual testing

The repository includes a Playwright harness that gives coding agents both a
rendered view of the game and a JSON snapshot of its internal state. It starts
its own local server and headless Chrome/Edge, so no manual setup is required:

```powershell
npm run ai:state
npm run ai:screenshot
npm run ai:test
npm run ai:enemy
npm run ai:life
npm run ai:mobile
npm run ai:sniper
npm run ai:rigs
npm run ai:graphics
npm run ai:graphics -- fallback
npm run ai:record -- 10
```

Outputs are written to `artifacts/ai-game/`:

- `before.png` and `screenshot.png`: visual before/after evidence
- `before-state.json` and `state.json`: player, weapon, enemy, overlay, and
  renderer state
- `console.log`: browser console, page, and network failures
- `trace.zip`: a Playwright trace with screenshots and DOM snapshots
- `recording.webm`: video produced by `ai:record`
- `report.json`: machine-readable checks and pass/fail status

`debug.setEnemiesActive(false)` pauses bots and their navigation for input/animation probes while the player keeps running; restore it with `true`. `getState().enemiesActive` reports the setting. Combat remains covered by `ai:enemy`.

`ai:rigs` renders all 17 weapon rigs at fixed hip, ADS, normal-reload and empty-reload poses. It checks sight projection, physical scopes and magazine seating, and saves screenshots and state to `artifacts/weapon-rigs`. Set `RIG_WEAPONS=m27,an94` to narrow the roster and `BROWSER_PATH` to choose Chrome or Edge.

`ai:sniper` checks all four rifles with real aim, fire and hold-breath input, including scope/bolt transitions and pause/respawn recovery. Set `AI_GAME_MOBILE=1` to exercise touch input and the portrait scope masks.

`ai:mobile` writes to `artifacts/ai-mobile/`. It tests simultaneous touch
contacts, action buttons, interruption recovery, class selection, and match
restart, with screenshots at phone and tablet sizes in both orientations.

`ai:graphics` writes to `artifacts/ai-graphics/`. It checks rendering presets,
high-density phone buffers, portrait/tablet resizing, persistence, and held
touch input across resolution changes. `fallback` simulates unavailable HDR
multisampling to verify the FXAA path. Use `AI_GAME_ARTIFACT_DIR` to retain both
runs separately. These software-rendered checks verify behavior and visuals;
real-device frame rates and battery use need phone measurements.
Set `AI_GAME_MOBILE=1` with `npm run ai:record -- 10 m27` to record the mobile
rendering path at a high-density phone viewport.

Set `AI_GAME_HEADED=1` to watch the controlled browser. `BROWSER_TEST_URL` can
point the harness at an existing server, `BROWSER_PATH` can select a custom
Chrome/Edge executable, and `AI_GAME_MAP` picks a map from `export/web/maps.js`.

At runtime, `globalThis.hijacked.debug` provides a stable automation surface:
`getState`, `setActive`, `pause`, `resume`, `teleportPlayer`, `lookAt`, overlay
toggles, `selectWeapon`, damage/respawn controls, and enemy reset. Keep this
surface stable when changing runtime internals because tests and coding agents
depend on it.
