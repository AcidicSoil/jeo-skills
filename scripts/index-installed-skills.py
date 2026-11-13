#!/usr/bin/env python3
"""Build a routing catalog from an installed flat Agent Skills directory."""

import json
from pathlib import Path
import re
import sys

import yaml

FRONTMATTER = re.compile(r"\A---\s*\n(.*?)\n---\s*(?:\n|\Z)", re.DOTALL)


def skill_entry(directory: Path) -> dict | None:
    source = directory / "SKILL.md"
    if not source.is_file():
        return None
    match = FRONTMATTER.match(source.read_text(encoding="utf-8"))
    if not match:
        return None
    metadata = yaml.safe_load(match.group(1))
    if not isinstance(metadata, dict):
        return None
    description = metadata.get("description")
    if not isinstance(description, str) or not description.strip():
        return None
    category = metadata.get("category")
    if not isinstance(category, str) or not category.strip():
        category = "uncategorized"
    return {
        "name": directory.name,
        "path": f"{directory.name}/SKILL.md",
        "category": category.strip(),
        "description": " ".join(description.split()),
    }


def index(root: Path) -> tuple[dict, list[str]]:
    found, skipped = [], []
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        try:
            skill = skill_entry(child)
        except (OSError, UnicodeError, yaml.YAMLError):
            skill = None
        if skill is None:
            skipped.append(child.name)
        else:
            found.append(skill)
    categories = {}
    for skill in found:
        categories.setdefault(skill["category"], []).append(skill["name"])
    return {
        "version": 1,
        "skill_count": len(found),
        "categories": categories,
        "model_policies": {},
        "skills": found,
    }, skipped


def main() -> int:
    root = (
        Path(sys.argv[1] if len(sys.argv) > 1 else "~/.agents/skills")
        .expanduser()
        .resolve()
    )
    if not root.is_dir():
        print(f"Not a skills directory: {root}", file=sys.stderr)
        return 2
    catalog, skipped = index(root)
    if not catalog["skills"]:
        print(f"No valid SKILL.md documents in {root}", file=sys.stderr)
        return 2
    output = root / "skills.json"
    rendered = json.dumps(catalog, ensure_ascii=False, indent=2) + "\n"
    if output.is_file() and output.read_text(encoding="utf-8") == rendered:
        print(f"unchanged: {output} ({catalog['skill_count']} skills)")
    else:
        output.write_text(rendered, encoding="utf-8")
        print(f"indexed {catalog['skill_count']} skills: {output}")
    if skipped:
        print(f"skipped {len(skipped)} folders without usable SKILL.md metadata")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
