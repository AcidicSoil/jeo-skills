#!/usr/bin/env python3
"""Regression tests for the installed-skills index."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("index-installed-skills.py")


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


if __name__ == "__main__":
    unittest.main()
