#!/usr/bin/env python3
"""Import weapon models, animations, textures and camos from an Unlinker dump.

    python .tools/import_weapon_assets.py --dump <folder> [--images <folder>] [--dry-run]

The dump is what ``Unlinker --model-format GLB --include-assets xmodel,xanim,image``
writes for ``common_mp.ff`` (see README, "Adding a weapon"). Everything this
script copies is named in the tables below, so adding a gun, a melee weapon or
a grenade is a matter of adding a row and re-running it:

- ``VIEW_MODELS`` land in ``export/web/viewmodel/`` with their textures re-encoded
  to WebP in ``export/web/images/`` (the viewmodel loader rewrites ``.dds`` to
  ``.webp`` at load time, see viewmodel.js).
- ``WORLD_MODELS`` land in ``export/web/enemies/`` with PNG textures in
  ``export/web/enemies/textures/`` (the enemy loader's convention).
- ``ANIMS`` are converted with ``.tools/xanim_to_json.mjs`` into
  ``export/web/viewmodel/anims/``.
- ``CAMOS`` are the game's own weapon camo patterns. T6 stores the colour in the
  pattern texture's RGB and a gloss mask in its alpha, so the alpha is dropped
  and the RGB written as an opaque tile that ``skins.js`` lists.

Textures are read from the GLBs themselves (their ``images[].uri`` entries), so a
new model never needs its textures listed by hand. Normal maps are written
losslessly, colour maps at quality 90, matching ``.tools/pack_web_textures.mjs``.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import struct
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "export" / "web"
XANIM_TO_JSON = ROOT / ".tools" / "xanim_to_json.mjs"

# First-person rigs: the four pistols with a conventional magazine reload, the
# combat knife every rifle melee uses, and the two grenade bodies the throw
# releases. The Executioner (judge) is left out: its shell-by-shell manual
# reload needs a loop state the viewmodel does not have yet.
VIEW_MODELS = (
    "t6_wpn_pistol_fiveseven_view_lod0",
    "t6_wpn_pistol_kard_view_lod0",
    "t6_wpn_pistol_fnp45_view_lod0",
    "t6_wpn_pistol_b2023r_view_lod0",
    "t6_wpn_knife_base_view_lod0",
    "t6_wpn_grenade_frag_projectile_lod0",
    "t6_wpn_grenade_smoke_projectile_lod0",
)

# Third-person rigs the bots carry. LOD1 keeps every mount tag at a fraction of
# LOD0's vertex count, which is what enemy-system.js was written against.
WORLD_MODELS = tuple(
    f"t6_wpn_ar_{name}_world_lod1"
    for name in ("an94", "hk416", "sa58", "saritch", "scarh", "sig556", "type95", "x95l", "xm8")
) + (
    "t6_wpn_grenade_frag_projectile_lod1",
    "t6_wpn_grenade_smoke_projectile_lod1",
)

# Viewmodel clips, named as the weapon files name them.
PISTOL_CLIPS = ("idle", "fire", "ads_fire", "reload", "reload_empty", "tactical_melee")
ANIMS = tuple(
    f"viewmodel_{rig}_{clip}"
    for rig in ("fn57", "kard", "fnp45", "beretta2023r")
    for clip in PISTOL_CLIPS
) + (
    # knife_mp: the two shared rifle-melee clips, swipe then charge.
    "viewmodel_m4m203_knife_melee_1",
    "viewmodel_m4m203_knife_melee_2",
    # frag_grenade_mp / willy_pete_mp both throw with the M67 clips.
    "viewmodel_m67_pullpin",
    "viewmodel_m67_throw",
)

# The game's weapon camos, by the name in the camo table. The web catalog in
# skins.js keys them by this id; a camo added here also needs a row there.
CAMOS = (
    "erdl", "choco", "flora", "sahara", "siberia", "tiger_blue", "tiger_jungle",
    "urban_russia", "flecktarn", "atacs", "devgru", "nevada", "kryptek_typhon",
    "ghostex_delta6", "bloodshot", "blossom", "skulls", "ronin", "artofwar",
    "massacre", "elite",
)

NORMAL_MAP_SUFFIXES = ("_nml", "_n")
COLOUR_QUALITY = 90


def glb_image_uris(path: Path) -> list[str]:
    data = path.read_bytes()
    if data[:4] != b"glTF":
        raise ValueError(f"{path} is not a binary glTF")
    length = struct.unpack_from("<I", data, 12)[0]
    document = json.loads(data[20:20 + length])
    return [image["uri"] for image in document.get("images", []) if image.get("uri")]


def is_normal_map(name: str) -> bool:
    stem = name.rsplit(".", 1)[0].lower()
    return stem.endswith(NORMAL_MAP_SUFFIXES)


def load_dds(path: Path) -> Image.Image:
    with Image.open(path) as image:
        image.load()
        return image.convert("RGBA" if "A" in image.getbands() else "RGB")


def write_texture(source: Path, target: Path, *, dry_run: bool) -> None:
    if dry_run:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    image = load_dds(source)
    if target.suffix == ".webp":
        if is_normal_map(source.name):
            image.save(target, lossless=True, method=6)
        else:
            image.save(target, quality=COLOUR_QUALITY, method=6)
    else:
        image.save(target, optimize=True)


def import_models(names, models_dir: Path, images_dir: Path, model_target: Path, texture_target: Path,
                  texture_suffix: str, *, dry_run: bool, force: bool = False, report: list[str]) -> None:
    for name in names:
        source = models_dir / f"{name}.glb"
        if not source.exists():
            report.append(f"missing model {source}")
            continue
        target = model_target / source.name
        if target.exists() and not force:
            report.append(f"kept   {target.relative_to(ROOT)}")
        else:
            if not dry_run:
                model_target.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
            report.append(f"model  {target.relative_to(ROOT)}")
        for uri in glb_image_uris(source):
            dds = images_dir / Path(uri).name
            texture = texture_target / (Path(uri).stem + texture_suffix)
            if texture.exists():
                continue
            if not dds.exists():
                report.append(f"missing texture {dds.name} for {name}")
                continue
            write_texture(dds, texture, dry_run=dry_run)
            report.append(f"tex    {texture.relative_to(ROOT)}")


def import_anims(names, xanim_dir: Path, target: Path, *, dry_run: bool, report: list[str]) -> None:
    sources = []
    for name in names:
        source = xanim_dir / name
        if not source.exists():
            report.append(f"missing xanim {source}")
            continue
        sources.append(str(source))
        report.append(f"anim   {target.relative_to(ROOT)}/{name}.json")
    if sources and not dry_run:
        target.mkdir(parents=True, exist_ok=True)
        subprocess.run(["node", str(XANIM_TO_JSON), *sources, "-o", str(target)], check=True,
                       stdout=subprocess.DEVNULL)


def import_camos(names, images_dir: Path, target: Path, *, dry_run: bool, report: list[str]) -> None:
    for name in names:
        source = images_dir / f"t6_camo_{name}_pattern.dds"
        if not source.exists():
            report.append(f"missing camo {source.name}")
            continue
        out = target / f"{name}.webp"
        if not dry_run:
            target.mkdir(parents=True, exist_ok=True)
            # The alpha channel is the camo's gloss mask, not coverage.
            load_dds(source).convert("RGB").save(out, quality=COLOUR_QUALITY, method=6)
        report.append(f"camo   {out.relative_to(ROOT)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dump", required=True, help="Unlinker output folder holding model_export/ and xanim/")
    parser.add_argument("--images", help="folder of dumped .dds images (default: <dump>/images)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true", help="overwrite models that are already in the export")
    args = parser.parse_args()

    dump = Path(args.dump).resolve()
    models_dir = dump / "model_export"
    xanim_dir = dump / "xanim"
    images_dir = Path(args.images).resolve() if args.images else dump / "images"
    report: list[str] = []

    import_models(VIEW_MODELS, models_dir, images_dir, WEB / "viewmodel", WEB / "images", ".webp",
                  dry_run=args.dry_run, force=args.force, report=report)
    import_models(WORLD_MODELS, models_dir, images_dir, WEB / "enemies", WEB / "enemies" / "textures", ".png",
                  dry_run=args.dry_run, force=args.force, report=report)
    import_anims(ANIMS, xanim_dir, WEB / "viewmodel" / "anims", dry_run=args.dry_run, report=report)
    import_camos(CAMOS, images_dir, WEB / "images" / "camo", dry_run=args.dry_run, report=report)

    for line in report:
        print(line)
    missing = [line for line in report if line.startswith("missing")]
    kept = [line for line in report if line.startswith("kept")]
    print(f"{len(report) - len(missing) - len(kept)} asset(s) {'would be ' if args.dry_run else ''}written, "
          f"{len(kept)} already present, {len(missing)} missing")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
