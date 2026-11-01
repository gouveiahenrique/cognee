#!/usr/bin/env python3
"""Rebrand a copy of cognee-frontend at build time.

Usage: rebrand.py <frontend-dir> <brand>

The frontend source keeps upstream's wording, so rebasing onto upstream never
conflicts on product copy. This rewrites a *copy* of it just before the image
is built:

- user-facing "Cognee" becomes the brand name (also in "Cognee Cloud"). The
  sample question and text about Cognee's founder (they must match each
  other as bundled sample data) and comment lines are left as they are;
- the top-bar logo image becomes a text logo;
- files under branding/<brand>/files/ are copied over the frontend
  (e.g. the favicon at src/app/icon.svg).

Every rule asserts that it matched, so when upstream moves the code the build
fails loudly instead of silently shipping Cognee branding.
"""

import re
import shutil
import sys
from pathlib import Path

BRANDS = {
    "context-mesh": {
        "name": "Context Mesh",
        "logo": (
            "<span style={{ flexShrink: 0, fontSize: 18, fontWeight: 700, "
            'letterSpacing: "-0.02em", color: "#EDECEA", whiteSpace: "nowrap" }}>\n'
            '            Context<span style={{ color: "#BC9BFF" }}>Mesh</span>\n'
            "          </span>"
        ),
    },
}

NAME = re.compile(r"(?<!CEO of )\bCognee\b(?!'s founder)")
COMMENT = re.compile(r"^\s*(//|/\*|\*|\{/\*)")
LOGO_IMAGE = re.compile(r'<Image src="/cognee-logo-black\.svg" alt="Cognee"[^>]*/>')
MIN_TEXT_REPLACEMENTS = 150  # the UI has ~190-240; far fewer means the copy moved


def fail(message: str) -> None:
    sys.exit(f"rebrand: {message}")


def rebrand_text(src: Path, name: str) -> int:
    count = 0
    for path in sorted(src.rglob("*")):
        if path.suffix not in {".ts", ".tsx"} or "__tests__" in path.parts:
            continue
        lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
        changed = False
        for i, line in enumerate(lines):
            if COMMENT.match(line):
                continue
            new, n = NAME.subn(name, line)
            if n:
                lines[i], changed, count = new, True, count + n
        if changed:
            path.write_text("".join(lines), encoding="utf-8")
    return count


def rebrand_logo(src: Path, logo: str) -> None:
    top_bar = src / "ui/layout/TopBar.tsx"
    text = top_bar.read_text(encoding="utf-8")
    text, n = LOGO_IMAGE.subn(logo, text)
    if n != 1:
        fail(f"expected one Cognee logo <Image> in {top_bar}, found {n}")
    if "<Image" not in text:
        text = text.replace('import Image from "next/image";\n', "")
    top_bar.write_text(text, encoding="utf-8")


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage: rebrand.py <frontend-dir> <brand>")
    frontend, brand = Path(sys.argv[1]), sys.argv[2]
    if brand not in BRANDS:
        fail(f"unknown brand {brand!r}; known: {', '.join(BRANDS)}")
    src = frontend / "src"
    if not src.is_dir():
        fail(f"{src} is not a directory")

    config = BRANDS[brand]
    # The logo first: its alt text says Cognee, which the name rule would change.
    rebrand_logo(src, config["logo"])
    count = rebrand_text(src, config["name"])
    if count < MIN_TEXT_REPLACEMENTS:
        fail(f"only {count} product-name replacements (expected {MIN_TEXT_REPLACEMENTS}+)")

    overlay = Path(__file__).resolve().parent / brand / "files"
    copied = 0
    for path in sorted(overlay.rglob("*")) if overlay.is_dir() else []:
        if path.is_file():
            target = frontend / path.relative_to(overlay)
            if not target.exists():
                fail(f"overlay {path} has no counterpart at {target}")
            shutil.copyfile(path, target)
            copied += 1
    print(f"rebrand: {brand}: {count} name replacements, logo, {copied} overlay file(s)")


if __name__ == "__main__":
    main()
