import base64
import tempfile
import unittest
import zipfile
from pathlib import Path

import server


class ModUploadValidationTest(unittest.TestCase):
    def test_names_and_jar_signature(self):
        self.assertTrue(server.valid_mod_name("crazy-cow-v2.jar"))
        self.assertFalse(server.valid_mod_name("../evil.jar"))
        self.assertFalse(server.valid_mod_name("not-a-mod.zip"))
        with tempfile.TemporaryDirectory() as directory:
            jar = Path(directory) / "mod.jar"
            with zipfile.ZipFile(jar, "w") as archive:
                archive.writestr("META-INF/mods.toml", "modLoader='javafml'")
            self.assertTrue(server.valid_mod_jar(jar))
            jar.write_bytes(b"not a jar")
            self.assertFalse(server.valid_mod_jar(jar))

    def test_basic_auth(self):
        token = base64.b64encode(b"admin:secret").decode("ascii")
        self.assertTrue(server.valid_basic_auth(f"Basic {token}", "admin", "secret"))
        self.assertFalse(server.valid_basic_auth(f"Basic {token}", "admin", "wrong"))
        self.assertFalse(server.valid_basic_auth("garbage", "admin", "secret"))

    def test_tactical_command_is_bounded(self):
        self.assertEqual(server.parse_entity_position("Player has data: [12.5d, 64.0d, -7.25d]"), [12.5, 64.0, -7.2])
        self.assertEqual(server.parse_entity_positions("a [1.0d, 2.0d, 3.0d]\nb [-4.0d, 5.0d, 6.0d]"), [[1.0, 2.0, 3.0], [-4.0, 5.0, 6.0]])
        self.assertEqual(
            server.build_summon_command("crazycow:szalona_krowa_v2", "minecraft:overworld", 12, -7),
            'execute in minecraft:overworld positioned 12 0 -7 positioned over motion_blocking_no_leaves run summon crazycow:szalona_krowa_v2 ~ ~1 ~ {Tags:["cyberops_tracked"]}',
        )


if __name__ == "__main__":
    unittest.main()
