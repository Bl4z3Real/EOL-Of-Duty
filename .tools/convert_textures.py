#!/usr/bin/env python3
"""Convert Unlinker DDS dumps to the PNGs the composer references.

    python .tools/convert_textures.py <dump>/images export/web/textures

compose_scene.py names every texture as <image name>.png under
export/web/textures, so this mirrors the dump one to one. Pillow decodes the
block formats T6 uses (DXT1, DXT5, BC5, BC7); anything it rejects is listed at
the end rather than aborting the run. Existing PNGs are skipped unless
--force is given.
"""

from __future__ import annotations

import argparse
import os
import sys

from PIL import Image


def convert(source: str, target: str) -> None:
    with Image.open(source) as image:
        image.load()
        mode = "RGBA" if "A" in image.getbands() else "RGB"
        image.convert(mode).save(target, optimize=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("source", help="folder of .dds files")
    parser.add_argument("target", help="folder to write .png files into")
    parser.add_argument("--force", action="store_true", help="rewrite PNGs that already exist")
    args = parser.parse_args()

    os.makedirs(args.target, exist_ok=True)
    names = sorted(n for n in os.listdir(args.source) if n.lower().endswith(".dds"))
    written = skipped = 0
    failed: list[tuple[str, str]] = []
    for name in names:
        out = os.path.join(args.target, name[:-4] + ".png")
        if os.path.exists(out) and not args.force:
            skipped += 1
            continue
        try:
            convert(os.path.join(args.source, name), out)
            written += 1
        except Exception as error:  # noqa: BLE001 - report and keep going
            failed.append((name, str(error)))

    print(f"textures: {written} written, {skipped} already present, {len(failed)} failed")
    for name, error in failed:
        print(f"  {name}: {error}")
    return 1 if failed and not written else 0


if __name__ == "__main__":
    sys.exit(main())
