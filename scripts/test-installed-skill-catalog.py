#!/usr/bin/env python3
"""Regression tests for the installed-skills index."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import yaml

SCRIPT = Path(__file__).with_name("index-installed-skills.py")
SYNC = Path(__file__).with_name("sync-skill-store.sh")


class InstalledCatalogTests(unittest.TestCase):
    def test_catalog_tracks_actual_skills_and_refreshes_idempotently(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            alpha = root / "alpha"
            alpha.mkdir()
            (alpha / "SKILL.md").write_text(
                "---\nname: alpha\ndescription: |\n  Debug software\n  and trace failures.\ncategory: testing\n---\n# Alpha\n",
                encoding="utf-8",
            )
            beta = root / "beta"
            beta.mkdir()
            (beta / "SKILL.md").write_text(
                "---\nname: beta\ndescription: Improve API accessibility.\n---\n# Beta\n",
                encoding="utf-8",
            )
            missing = root / "missing"
            missing.mkdir()
            invalid = root / "invalid"
            invalid.mkdir()
            (invalid / "SKILL.md").write_text(
                "This is not skill frontmatter", encoding="utf-8"
            )
            command = [sys.executable, str(SCRIPT), str(root)]
            first = subprocess.run(command, capture_output=True, text=True, check=True)
            self.assertIn("2 skills", first.stdout)
            output = root / "skills.json"
            content = output.read_bytes()
            catalog = json.loads(content)
            self.assertEqual(catalog["skill_count"], 2)
            self.assertEqual(
                {row["name"] for row in catalog["skills"]}, {"alpha", "beta"}
            )
            self.assertEqual(catalog["categories"]["testing"], ["alpha"])
            self.assertEqual(catalog["categories"]["uncategorized"], ["beta"])
            self.assertEqual(catalog["skills"][0]["path"], "alpha/SKILL.md")
            self.assertIn("and trace failures.", catalog["skills"][0]["description"])
            again = subprocess.run(command, capture_output=True, text=True, check=True)
            self.assertIn("unchanged", again.stdout)
            self.assertEqual(output.read_bytes(), content)
            self.assertNotIn("missing", content.decode())
            self.assertNotIn("invalid", content.decode())

    def test_sync_command_updates_custom_store_from_any_working_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            store = Path(temp) / "custom-store"
            store.mkdir()
            skill = store / "first-skill"
            skill.mkdir()
            skill_file = skill / "SKILL.md"
            skill_file.write_text(
                "---\nname: first-skill\ndescription: First version.\n---\n",
                encoding="utf-8",
            )
            command = ["bash", str(SYNC), str(store)]
            first = subprocess.run(
                command, cwd=temp, capture_output=True, text=True, check=True
            )
            self.assertIn("indexed 1 skills", first.stdout)
            output = store / "skills.json"
            self.assertEqual(
                json.loads(output.read_text())["skills"][0]["description"],
                "First version.",
            )
            skill_file.write_text(
                "---\nname: first-skill\ndescription: Updated version.\n---\n",
                encoding="utf-8",
            )
            subprocess.run(command, cwd=temp, check=True, capture_output=True)
            self.assertEqual(
                json.loads(output.read_text())["skills"][0]["description"],
                "Updated version.",
            )
            again = subprocess.run(
                command, cwd=temp, check=True, capture_output=True, text=True
            )
            self.assertIn("unchanged", again.stdout)

    def test_sync_command_defaults_to_user_skill_store(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / ".agents" / "skills"
            skill = root / "default-skill"
            skill.mkdir(parents=True)
            (skill / "SKILL.md").write_text(
                "---\nname: default-skill\ndescription: Test routing.\n---\n",
                encoding="utf-8",
            )
            import os

            result = subprocess.run(
                ["bash", str(SYNC)],
                cwd=temp,
                env={
                    **os.environ,
                    "HOME": temp,
                    "PYTHONPATH": os.pathsep.join(
                        filter(
                            None,
                            [
                                str(Path(yaml.__file__).parent.parent),
                                os.environ.get("PYTHONPATH"),
                            ],
                        )
                    ),
                },
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertIn("indexed 1 skills", result.stdout)
            self.assertEqual(
                json.loads((root / "skills.json").read_text())["skill_count"], 1
            )


if __name__ == "__main__":
    unittest.main()
