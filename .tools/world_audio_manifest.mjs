#!/usr/bin/env node
// World cue audio: footsteps, landings, body falls, bullet debris, flesh hits,
// whiz-bys and death vox, resolved through the soundbank alias tables and
// copied into the web export.
//
//   BO2_ROOT=<zones and sound> node .tools/dump_soundbanks.mjs artifacts/soundbanks-pluto
//   node .tools/world_audio_manifest.mjs --dump artifacts/soundbanks-pluto            # report
//   node .tools/world_audio_manifest.mjs --dump artifacts/soundbanks-pluto --extract  # copy, write map
//
// The dump folder is an argument because the weapon audio tests treat
// artifacts/soundbanks as the maintainer's Windows dump and compare against
// checked-in expectations; a dump from another build lives beside it.
//
// Output is export/web/audio/world-map.json, `{ aliases, samples }` in the
// same shape as foley-map.json: an alias names a sample group, a group is one
// or more ./audio/world/*.wav variants and the runtime picks one per play.
// Only groups whose samples were actually copied are listed, so a cue whose
// bank is missing is silent rather than a 404.
//
// Which aliases: everything below matches names the runtime asks for in
// export/web/world-audio.js. Footsteps and impacts live in each map's own
// bank (mpl_<map>.all), the death vox in mpl_common.all.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveBankDir } from './dump_soundbanks.mjs';
import { loadAliasTables } from './weapon_audio_manifest.mjs';
import { repairWav } from './extract_weapon_audio.mjs';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolsDir, '..');

export const WORLD_ALIAS_PATTERNS = Object.freeze([
  /^fly_lstep_(crouch_)?(walk|run|sprint)_(npc_)?[a-z]+$/,
  /^fly_land_(plr|npc)_[a-z]+$/,
  /^fly_land_damage_(plr|npc)$/,
  /^fly_bodyfall_(large|generic)_[a-z_]+$/,
  /^prj_bullet_debris_(small|large)_[a-z]+$/,
  /^prj_bullet_ap_ricochet$/,
  /^prj_bullet_impact_headshot$/,
  /^prj_bolt_impact_flesh$/,
  /^phy_impact_flesh_flesh$/,
  /^prj_whizby$/,
  /^prj_crack$/,
  /^vox_moto_death$/,
  // Weapon handling the notetracks do not cover: aim, raise, switch, sprint.
  /^fly_generic_(ads|ads_lower|raise|first_raise|down)_plr$/,
  /^fly_(cloth|gear)_sprint_plr$/,
  /^fly_dtp_land_exert_plr$/,
  /^chr_breathing_hurt$/,
  // A mannequin part knocked off and landing.
  /^fly_bump_mannequin$/,
  // Bot reports for the rifle roster, near and distant, and each rifle's dry fire.
  /^wpn_(hk416|an94|sa58|saritch|scar|sig556|tar21|type95|xm8)_(fire_npc|fire_npc_decay|fire_npc_dist|dryfire_plr)$/,
  // The hitmarker, the timer beeps, and the title and pause screen navigation.
  /^mpl_hit_alert$/,
  /^mpl_ui_timer_countdown$/,
  /^uin_(main_nav|main_enter|main_exit|main_pause|cmn_backout|start_count_down|timer)$/,
  // Spawn, timer and result music. The frontend, load and action beds are
  // several minutes of FLAC each and are left out to keep the deploy light.
  /^mus_(spawn_short_fbi|victory|loss|draw|time_running_out)$/,
  // Pistol reports and dry fire, for the secondary slot and the bots that carry one.
  /^wpn_(fiveseven|kard|fnp45|beretta93r)_(fire_npc|fire_npc_decay|fire_npc_dist|dryfire_plr)$/,
  // Rifle melee is knife_mp: the swing, the knife's own draw, and hit or miss.
  /^wpn_melee_(whoosh_plr|knife_hit_body|knife_hit_other|hit_other|knife_hit_lfe|hit_plr|hit_plr_lfe|knife_draw_plr|knife_sheath_plr)$/,
  /^wpn_knife_melee_stab$/,
  /^vox_melee_exert_plr$/,
  /^fly_melee_get_hit_plr$/,
  // Frag and smoke: pin, throw, bounces by surface, the blast and its layers.
  /^wpn_grenade_(throw|pull_pin|explode|explode_dist|explode_lfe|bounce_[a-z]+)$/,
  /^wpn_smoke_(grenade_explode|hiss_lp|hiss_start|hiss_end|pull_pin_plyr|bounce_[a-z]+)$/,
]);

// The mix columns the runtime reads back per alias. T6 authors each cue's
// volume on a 0-100 scale, the range it plays at full level (DistMin), the
// range it has faded to nothing by (DistMaxDry), and the bus it sums into.
// Without these every cue played at one hand-set gain over one distance
// curve, which is how a vent loop authored to die at 50 units carried across
// the whole of Nuketown.
export const MIX_COLUMNS = Object.freeze(['VolMin', 'VolMax', 'DistMin', 'DistMaxDry', 'Bus', 'Looping']);

export function mixFromRow(header, cells) {
  const column = (name) => cells[header.indexOf(name)];
  const volMin = Number(column('VolMin'));
  const volMax = Number(column('VolMax'));
  const volume = Number.isFinite(volMin) && Number.isFinite(volMax) ? (volMin + volMax) / 2 : null;
  const distMin = Number(column('DistMin'));
  const distMax = Number(column('DistMaxDry'));
  const bus = String(column('Bus') ?? '').replace(/^bus_/, '') || null;
  return {
    volume: volume === null ? null : Math.round(volume),
    distMin: Number.isFinite(distMin) ? distMin : null,
    distMax: Number.isFinite(distMax) ? distMax : null,
    bus,
  };
}

/** Per-alias mix values from every alias table, first table to define an alias wins. */
export function readMixTables(bankDir) {
  const mix = new Map();
  if (!fs.existsSync(bankDir)) return mix;
  for (const file of fs.readdirSync(bankDir).filter((name) => name.endsWith('.aliases.csv'))) {
    const bank = file.replace(/\.aliases\.csv$/, '');
    const lines = fs.readFileSync(path.join(bankDir, file), 'utf8').split(/\r?\n/).filter(Boolean);
    const header = lines[0].split(',');
    const nameIndex = header.indexOf('Name');
    if (nameIndex < 0 || MIX_COLUMNS.some((name) => header.indexOf(name) < 0)) continue;
    for (const line of lines.slice(1)) {
      const cells = line.split(',');
      const name = cells[nameIndex];
      if (!name) continue;
      const entry = mixFromRow(header, cells);
      if (!mix.has(name)) mix.set(name, entry);
      // Ambience is keyed per bank at runtime, so it is recorded that way too.
      if (AMBIENCE_PATTERN.test(name)) mix.set(`${name}@${bank}`, entry);
    }
  }
  return mix;
}

// Ambience is per map: the same alias name means the ocean on Hijacked and
// the desert wind on Nuketown, so these are keyed by bank as well.
export const AMBIENCE_PATTERN = /^amb_/;

function readBankAliases(bankDir) {
  const perBank = new Map();
  for (const file of fs.readdirSync(bankDir).filter((name) => name.endsWith('.aliases.csv'))) {
    const bank = file.replace(/\.aliases\.csv$/, '');
    const lines = fs.readFileSync(path.join(bankDir, file), 'utf8').split(/\r?\n/).filter(Boolean);
    const header = lines[0].split(',');
    const nameIndex = header.indexOf('Name');
    const sourceIndex = header.indexOf('FileSource');
    const loopIndex = header.indexOf('Looping');
    const aliases = new Map();
    for (const line of lines.slice(1)) {
      const cells = line.split(',');
      const name = cells[nameIndex];
      const source = cells[sourceIndex];
      if (!name || !source || !AMBIENCE_PATTERN.test(name)) continue;
      const entry = aliases.get(name) ?? { sources: new Set(), looping: false };
      entry.sources.add(source);
      if (cells[loopIndex] === 'looping') entry.looping = true;
      aliases.set(name, entry);
    }
    if (aliases.size) perBank.set(bank, aliases);
  }
  return perBank;
}

// The Unlinker writes `raw\\sound\\x.LN65.pc.snd` out as `sound/x.LN65.pc.snd.wav`
// (or `.flac` for streamed entries); older dumps kept the bare name.
export function findDumpedSample(dumpDir, source) {
  const base = path.join(dumpDir, source.replace(/^(raw|devraw)\\/, '').split('\\').join(path.sep));
  for (const candidate of [base, `${base}.wav`, `${base}.flac`]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// `sound/x/step_00.LN65.pc.snd.wav` becomes `step_00.wav`; FLAC keeps `.flac`.
export function webNameFor(dumpedPath) {
  const base = path.basename(dumpedPath);
  const extension = base.endsWith('.flac') ? '.flac' : '.wav';
  return base.replace(/\.[A-Z]{2}\d{2}\.pc\.snd(\.wav|\.flac)?$/i, '').replace(/\.(wav|flac)$/i, '') + extension;
}

export function buildWorldManifest({ bankDir = path.join(repoRoot, 'artifacts', 'soundbanks') } = {}) {
  const { alias, tables } = loadAliasTables(bankDir);
  const cues = {};
  for (const [name, sources] of alias) {
    if (!WORLD_ALIAS_PATTERNS.some((pattern) => pattern.test(name))) continue;
    const list = [...sources].filter(Boolean);
    if (list.length) cues[name] = list.sort();
  }
  // Ambience cues are named `<alias>@<bank>`; the runtime asks for the bank
  // of the map it is playing. Looping ones are recorded for the map too.
  const looping = [];
  for (const [bank, aliases] of readBankAliases(bankDir)) {
    for (const [name, entry] of aliases) {
      const list = [...entry.sources].filter(Boolean).sort();
      if (!list.length) continue;
      cues[`${name}@${bank}`] = list;
      if (entry.looping) looping.push(`${name}@${bank}`);
    }
  }
  const mix = {};
  const mixTables = readMixTables(bankDir);
  for (const name of Object.keys(cues)) {
    const entry = mixTables.get(name);
    if (entry) mix[name] = entry;
  }
  return { tables, cues, looping, mix };
}

/**
 * Copies the resolved samples into export/web/audio/world/ and writes the
 * alias map. Groups are keyed by their first sample's basename; aliases that
 * share a sample set share a group, as the game's randomised sets do.
 */
export function extractWorldAudio({
  dumpDir = path.join(repoRoot, 'artifacts', 'soundbanks'),
  outDir = path.join(repoRoot, 'export', 'web', 'audio', 'world'),
  mapPath = path.join(repoRoot, 'export', 'web', 'audio', 'world-map.json'),
  dryRun = false,
} = {}) {
  const { cues, looping, mix } = buildWorldManifest({ bankDir: resolveBankDir(dumpDir) });
  const groups = new Map();
  const aliases = {};
  const written = [];
  const missing = new Set();

  for (const [name, sources] of Object.entries(cues)) {
    const names = [...new Set(sources.map((source) => webNameFor(source.split('\\').pop())))].sort();
    const signature = names.join('\0');
    let group = groups.get(signature);
    if (!group) {
      const urls = [];
      for (const source of sources) {
        const from = findDumpedSample(dumpDir, source);
        if (!from) { missing.add(source); continue; }
        // Streamed banks decode to FLAC, which browsers decode natively; the
        // loaded banks are PCM WAV with the dump's bad RIFF size to repair.
        const flac = from.endsWith('.flac');
        const sampleName = webNameFor(from);
        const data = flac ? fs.readFileSync(from) : repairWav(fs.readFileSync(from));
        if (!data) { missing.add(`${source} (not a RIFF WAV)`); continue; }
        const to = path.join(outDir, sampleName);
        if (!dryRun) {
          fs.mkdirSync(outDir, { recursive: true });
          if (!fs.existsSync(to) || !fs.readFileSync(to).equals(data)) fs.writeFileSync(to, data);
        }
        written.push(sampleName);
        urls.push(`./audio/world/${sampleName}`);
      }
      group = { key: names[0].replace(/\.(wav|flac)$/i, ''), urls: [...new Set(urls)].sort() };
      groups.set(signature, group);
    }
    if (group.urls.length) aliases[name] = group.key;
  }

  const samples = {};
  for (const group of groups.values()) {
    if (group.urls.length) samples[group.key] = group.urls.length === 1 ? group.urls[0] : group.urls;
  }
  const map = {
    aliases: Object.fromEntries(Object.entries(aliases).sort(([a], [b]) => a.localeCompare(b))),
    samples: Object.fromEntries(Object.entries(samples).sort(([a], [b]) => a.localeCompare(b))),
    looping: looping.filter((name) => aliases[name]).sort(),
    // Volume, full-level range, fade-out range and bus per alias; see MIX_COLUMNS.
    mix: Object.fromEntries(Object.keys(aliases).sort().filter((name) => mix[name]).map((name) => [name, mix[name]])),
  };
  if (!dryRun) {
    fs.mkdirSync(path.dirname(mapPath), { recursive: true });
    fs.writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`);
    // Samples no cue references any more are removed so the folder only
    // ever holds what the map lists.
    const referenced = new Set(Object.values(samples).flat().map((url) => path.basename(url)));
    for (const file of fs.existsSync(outDir) ? fs.readdirSync(outDir) : []) {
      if (!referenced.has(file)) fs.unlinkSync(path.join(outDir, file));
    }
  }
  return { map, written: [...new Set(written)].sort(), missing: [...missing].sort(), cueCount: Object.keys(cues).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dumpIndex = args.indexOf('--dump');
  const dumpRoot = path.resolve(dumpIndex >= 0 ? args[dumpIndex + 1] : path.join(repoRoot, 'artifacts', 'soundbanks'));
  const bankDir = resolveBankDir(dumpRoot);
  if (args.includes('--extract')) {
    const { map, written, missing, cueCount } = extractWorldAudio({ dumpDir: dumpRoot, dryRun: args.includes('--dry-run') });
    console.log(`${cueCount} world cues in the alias tables, ${Object.keys(map.aliases).length} resolved to samples`);
    console.log(`${written.length} sample file(s) ${args.includes('--dry-run') ? 'would be' : ''} written, ${missing.length} missing from the dump`);
    if (missing.length) console.log(`first missing: ${missing[0]}`);
  } else {
    const { tables, cues } = buildWorldManifest({ bankDir });
    console.log(`${tables.length} alias tables, ${Object.keys(cues).length} world cues`);
    for (const [name, sources] of Object.entries(cues).sort()) console.log(`  ${name.padEnd(44)} ${sources.length} sample(s)`);
  }
}
