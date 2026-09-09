#!/usr/bin/env python3
"""Generate browser viewmodel definitions from T6 weapon-file records.

The exported weapon records are backslash-delimited key/value pairs.  This
script keeps the authored model names, attachment index/offsets, timing,
magazine size, damage, and clip names in one source of truth while emitting
the small JavaScript objects consumed by ``export/web/index.html``.

Examples::

    python .tools/generate_weapon_definitions.py sa58 saritch scar sig556 tar21 type95 xm8
    python .tools/generate_weapon_definitions.py --all
    python .tools/generate_weapon_definitions.py --all --ballistics > export/web/weapon-ballistics.js

The weapon files come from ``Unlinker --include-assets weapon`` on
``common_mp.ff`` into ``artifacts/weapon-data/``.

Display names are the BO2 in-game names.  They are intentionally hardcoded:
the checked-in localization file contains Windows configuration strings, not
the multiplayer weapon labels.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEAPON_DIR = ROOT / "artifacts" / "weapon-data" / "weapons"

# Primary rifles in class-screen order, then the pistols the secondary slot
# offers. The Executioner (judge) is left out until the viewmodel can play its
# shell-by-shell manual reload loop.
ROSTER = ("hk416", "an94", "sa58", "saritch", "scar", "sig556", "tar21", "type95", "xm8")
PISTOLS = ("fiveseven", "fnp45", "kard", "beretta93r")
# Sniper rifles share the primary slot with the assault rifles, after them.
SNIPERS = ("dsr50", "ballista", "svu", "as50")
ALL_IDS = ROSTER + PISTOLS + SNIPERS
DISPLAY_NAMES = {
    "dsr50": "DSR 50",
    "ballista": "Ballista",
    "svu": "SVU-AS",
    "as50": "XPR-50",
    "fiveseven": "Five-seven",
    "fnp45": "Tac-45",
    "kard": "KAP-40",
    "beretta93r": "B23R",
    "hk416": "M27",
    "an94": "AN-94",
    "sa58": "FAL OSW",
    "saritch": "SMR",
    "scar": "SCAR-H",
    "sig556": "SWAT-556",
    "tar21": "MTAR",
    "type95": "Type 25",
    "xm8": "M8A1",
}
# The existing slot uses the player-facing M27 id.  Keep the source weapon id
# in the input lookup, but emit the runtime id already used by the game.
RUNTIME_IDS = {"hk416": "m27"}
# tag_torso position (engine axes, inches) a weapon's clips assume when it is
# not the viewhands' bind of (-4.63, 0, -1.38). Only the XPR-50 differs.
TORSO_BINDS = {"as50": (8.68, -3.97, -4.64)}

CLIPS = (
    ("idle", "idleAnim"),
    ("fire", "fireAnim"),
    ("adsFire", "adsFireAnim"),
    ("introFire", "fireIntroAnim"),
    ("introAdsFire", "adsFireIntroAnim"),
    ("reload", "reloadAnim"),
    ("reloadEmpty", "reloadEmptyAnim"),
    # Pistols carry their own pistol-whip; rifles melee with knife_mp's clips.
    ("melee", "meleeAnim"),
    # Bolt-actions work the bolt after every shot, from the hip or in the scope.
    ("rechamber", "rechamberAnim"),
    ("adsRechamber", "adsRechamberAnim"),
)


def parse_weapon_file(path: Path) -> dict[str, str]:
    """Parse the same ``\\key\\value`` record format used by the exporter."""

    parts = path.read_text(encoding="utf-8").split("\\")
    values: dict[str, str] = {}
    for index in range(1, len(parts) - 1, 2):
        values[parts[index]] = parts[index + 1]
    return values


def js_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def number(value: str, *, integer: bool = False) -> str:
    parsed = float(value)
    if integer:
        return str(int(round(parsed)))
    if parsed.is_integer():
        return str(int(parsed))
    return f"{parsed:.6f}".rstrip("0").rstrip(".")


def find_magazine(weapon: dict[str, str]) -> tuple[int, str] | None:
    """The separate magazine attachment, or None when the mag is part of the gun (pistols)."""
    for index in range(1, 17):
        model = weapon.get(f"attachViewModel{index}", "")
        if model.startswith("t6_attach_mag_"):
            return index, model
    return None


def clip_entries(weapon: dict[str, str]) -> list[tuple[str, str]]:
    entries = []
    for key, field in CLIPS:
        name = weapon.get(field, "")
        if name:
            entries.append((key, name))
    required = {"idle", "fire", "adsFire", "reload", "reloadEmpty"}
    missing = required - {key for key, _ in entries}
    if missing:
        raise ValueError(f"missing required clips: {', '.join(sorted(missing))}")
    return entries


def emit_definition(source_id: str, slot: int) -> str:
    path = WEAPON_DIR / f"{source_id}_mp"
    weapon = parse_weapon_file(path)
    runtime_id = RUNTIME_IDS.get(source_id, source_id)
    gun_model = weapon["gunModel"]
    magazine = find_magazine(weapon)
    clip_values = clip_entries(weapon)
    pistol = source_id in PISTOLS
    sniper = source_id in SNIPERS

    fire_time = float(weapon["fireTime"])
    rpm = int(round(60 / fire_time))
    fire_type = weapon.get("fireType", "Full Auto")
    fire_mode = "single" if fire_type == "Single Shot" else "burst" if "Burst" in fire_type else "auto"
    clip_size = int(round(float(weapon["clipSize"])))

    lines = [
        f"  {runtime_id}: Object.freeze({{",
        f"    id: {js_string(runtime_id)},",
        f"    name: {js_string(DISPLAY_NAMES[source_id])},",
        f"    class: {js_string('secondary' if pistol else 'primary')},",
        f"    role: {js_string('Pistol' if pistol else 'Sniper rifle' if sniper else 'Assault rifle')},",
        f"    slot: {slot},",
        f"    sourceId: {js_string(source_id)},",
        f"    magazineSize: {clip_size},",
        # Rifles carry eight spare magazines here; the game starts pistols with two.
        f"    reserveAmmo: {clip_size * 2 if pistol else 240},",
        f"    roundsPerMinute: {rpm},",
        f"    fireMode: {js_string(fire_mode)},",
        "    damage: " + number(weapon["damage"], integer=True) + ",",
        f"    fireTypeIcon: {js_string(weapon['fireTypeIcon'])},",
        f"    viewmodelUrl: 'viewmodel/{gun_model}_lod0.glb',",
        f"    worldModelUrl: 'enemies/{weapon['worldModel']}_lod1.glb',",
    ]
    if fire_mode == "burst":
        lines.append(f"    burstCount: {number(weapon.get('burstCount', '3'), integer=True)},")
    if sniper:
        # The scope: the file's zoom FOV (three slots, all equal without the
        # Variable Zoom attachment), its overlay image, the sway in the glass,
        # and whether the action has to be worked between shots.
        overlay = weapon.get("adsOverlayShader", "")
        lines.extend([
            "    scope: Object.freeze({",
            f"      zoomFov: {number(weapon.get('adsZoomFov1', '15'))},",
            "      zoomLevels: Object.freeze([" + ", ".join(number(weapon.get(f'adsZoomFov{i}', '15')) for i in (1, 2, 3)) + "]),",
            f"      overlay: {js_string(f'ui/scope/{overlay}.png') if overlay else 'null'},",
            f"      idleAmount: {number(weapon.get('adsIdleAmount', '30'))},",
            f"      swayMaxAngle: {number(weapon.get('adsSwayMaxAngle', '2'))},",
            "    }),",
            f"    boltAction: {'true' if weapon.get('rechamberAnim') else 'false'},",
        ])
    if magazine:
        attachment_index, magazine_model = magazine
        offset = [
            number(weapon[f"attachViewModelOffset{axis}{attachment_index}"])
            for axis in ("X", "Y", "Z")
        ]
        roll = number(weapon.get(f"attachViewModelOffsetRoll{attachment_index}", "0"))
        lines.extend([
            f"    magazineUrl: 'viewmodel/{magazine_model}_lod0.glb',",
            f"    // Authored attachment offset from the shipped {source_id}_mp weapon file.",
            f"    magazineOffset: Object.freeze([{', '.join(offset)}]),",
            f"    magazineRotation: Object.freeze([degToRad({roll}), 0, 0]),",
        ])
    else:
        lines.append("    // The magazine is part of the gun model; no separate attachment.")
        lines.append("    magazineUrl: null,")

    # AN-94's hyperburst behavior is not represented by the generic weapon
    # fields, so preserve the tuned values from the shipped reference entry.
    if source_id == "an94":
        lines.extend([
            "    initialRoundsPerMinute: 937.5,",
            "    initialShotCount: 2,",
        ])

    # A rig whose clips were authored against a different torso bind (the
    # XPR-50's sit 13 units further forward than the FBI hands) says so here;
    # the value is the first tag_torso key of its ads_up clip.
    if source_id in TORSO_BINDS:
        lines.append(f"    torsoBind: Object.freeze([{', '.join(number(str(v)) for v in TORSO_BINDS[source_id])}]),")
    lines.append("    // Agent A ADS sight-anchor override can be added here when a rig needs one.")
    lines.append("    clips: Object.freeze({")
    for key, name in clip_values:
        lines.append(f"      {key}: 'viewmodel/anims/{name}.json',")
    lines.extend(["    }),", "  }),"])
    return "\n".join(lines)


# Hitbox regions the browser resolves, mapped onto the weapon file's
# locational multipliers. The bots have head, torso and leg boxes only.
# The bots' boxes are head, upper torso (chest and arms), lower torso and legs.
LOCATIONS = (
    ("none", "locNone"),
    ("head", "locHead"),
    ("torso", "locTorsoUpper"),
    ("torsoLower", "locTorsoLower"),
    ("legs", "locRightLegUpper"),
)


def ballistics(weapon: dict[str, str]) -> dict:
    """The range, spread, kick and timing fields export/web/gunplay.js reads."""

    def f(key: str, default: float = 0.0) -> float:
        value = weapon.get(key, "")
        return float(value) if value not in ("", None) else default

    ranges = []
    # maxDamageRange closes the full-damage band; damageRange2/3 open the
    # next ones; minDamageRange opens the floor. Zero ranges are unused.
    for range_key, damage_key in (("damageRange2", "damage2"), ("damageRange3", "damage3"),
                                  ("damageRange4", "damage4"), ("damageRange5", "damage5")):
        if f(range_key) > 0 and f(damage_key) > 0:
            ranges.append({"range": f(range_key), "damage": f(damage_key)})
    if f("minDamageRange") > 0 and f("minDamage") > 0:
        ranges.append({"range": f("minDamageRange"), "damage": f("minDamage")})
    ranges.sort(key=lambda band: band["range"])

    def kick(prefix: str) -> dict:
        return {
            "pitchMin": f(f"{prefix}ViewKickPitchMin"),
            "pitchMax": f(f"{prefix}ViewKickPitchMax"),
            "yawMin": f(f"{prefix}ViewKickYawMin"),
            "yawMax": f(f"{prefix}ViewKickYawMax"),
            "centerSpeed": f(f"{prefix}ViewKickCenterSpeed"),
            "minMagnitude": f(f"{prefix}ViewKickMinMagnitude"),
        }

    return {
        "damage": f("damage"),
        "maxDamageRange": f("maxDamageRange"),
        "ranges": ranges,
        "locations": {region: f(key, 1.0) for region, key in LOCATIONS},
        "hipSpread": {
            "standMin": f("hipSpreadStandMin"),
            "duckedMin": f("hipSpreadDuckedMin"),
            "max": f("hipSpreadMax"),
            "duckedMax": f("hipSpreadDuckedMax"),
            "moveAdd": f("hipSpreadMoveAdd"),
            "fireAdd": f("hipSpreadFireAdd"),
            "decayRate": f("hipSpreadDecayRate"),
        },
        "adsSpread": f("adsSpread"),
        "hipKick": kick("hip"),
        "adsKick": kick("ads"),
        "adsTransInTime": f("adsTransInTime", 0.25),
        "adsTransOutTime": f("adsTransOutTime", 0.25),
        "sprintOutTime": f("sprintOutTime", 0.2),
        "moveSpeedScale": f("moveSpeedScale", 1.0),
        "penetrateType": (weapon.get("penetrateType") or "none").lower(),
    }


def emit_ballistics_module(ids: tuple[str, ...]) -> str:
    table = {}
    for source_id in ids:
        weapon = parse_weapon_file(WEAPON_DIR / f"{source_id}_mp")
        table[RUNTIME_IDS.get(source_id, source_id)] = ballistics(weapon)
    body = json.dumps(table, indent=2, sort_keys=True)
    return (
        "// Generated by .tools/generate_weapon_definitions.py --ballistics from the\n"
        "// T6 weapon files. Read by export/web/gunplay.js. Do not edit by hand.\n"
        f"export const WEAPON_BALLISTICS = Object.freeze({body});\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ids", nargs="*", help="weapon-file ids to emit")
    parser.add_argument("--all", action="store_true", help="emit the complete roster: nine rifles and four pistols")
    parser.add_argument(
        "--ballistics",
        action="store_true",
        help="emit export/web/weapon-ballistics.js (range, spread, kick, ADS and sprint timing) instead of definitions",
    )
    args = parser.parse_args()
    unknown = sorted(set(args.ids) - set(ALL_IDS))
    if unknown:
        parser.error(f"unknown weapon id(s): {', '.join(unknown)}")
    ids = ALL_IDS if args.all or not args.ids else tuple(args.ids)
    if args.ballistics:
        print(emit_ballistics_module(ids), end="")
        return
    for source_id in ids:
        group = PISTOLS if source_id in PISTOLS else ROSTER + SNIPERS
        print(emit_definition(source_id, group.index(source_id) + 1))


if __name__ == "__main__":
    main()
