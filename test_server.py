import base64
import tempfile
import unittest
import zipfile
from pathlib import Path

import server
import terrain


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
        mom_token = base64.b64encode(b"mama:rose").decode("ascii")
        self.assertTrue(server.valid_basic_auth(f"Basic {token}", "admin", "secret"))
        self.assertFalse(server.valid_basic_auth(f"Basic {token}", "admin", "wrong"))
        self.assertFalse(server.valid_basic_auth("garbage", "admin", "secret"))
        self.assertTrue(server.valid_route_auth(f"Basic {mom_token}", "/api/mama/state", "admin", "secret", "mama", "rose"))
        self.assertFalse(server.valid_route_auth(f"Basic {mom_token}", "/api/status", "admin", "secret", "mama", "rose"))
        mom = "Basic " + base64.b64encode(b"mama:obiad").decode("ascii")
        self.assertTrue(server.valid_route_auth(mom, "/mama", "admin", "secret", "mama", "obiad"))
        self.assertFalse(server.valid_route_auth(mom, "/api/status", "admin", "secret", "mama", "obiad"))
        self.assertFalse(server.is_mom_route("/mamaevil"))

    def test_tactical_command_is_bounded(self):
        self.assertEqual(server.parse_entity_position("Player has data: [12.5d, 64.0d, -7.25d]"), [12.5, 64.0, -7.2])
        self.assertEqual(server.parse_entity_positions("a [1.0d, 2.0d, 3.0d]\nb [-4.0d, 5.0d, 6.0d]"), [[1.0, 2.0, 3.0], [-4.0, 5.0, 6.0]])
        self.assertEqual(
            server.parse_named_entity_positions("Crazy Cow V2 has the following entity data: [-625.5d, 98.0d, -718.5d]"),
            [{"name": "Crazy Cow V2", "x": -625.5, "y": 98.0, "z": -718.5}],
        )
        self.assertEqual(
            server.build_summon_command("crazycow:szalona_krowa_v2", "minecraft:overworld", 12, -7),
            'execute in minecraft:overworld positioned 12 0 -7 positioned over motion_blocking_no_leaves run summon crazycow:szalona_krowa_v2 ~ ~1 ~ {Tags:["cyberops_tracked"]}',
        )

    def test_heightmap_unpacking(self):
        values = list(range(256))
        bits, per_long = 9, 64 // 9
        packed = []
        for start in range(0, len(values), per_long):
            word = 0
            for offset, value in enumerate(values[start:start + per_long]):
                word |= value << (offset * bits)
            packed.append(word)
        self.assertEqual(terrain.unpack_height(packed, 173, -64), 109)

    def test_rapl_energy_delta_handles_counter_wrap(self):
        self.assertEqual(server.rapl_delta_uj(900, 950, 1000), 50)
        self.assertEqual(server.rapl_delta_uj(950, 25, 1000), 75)


if __name__ == "__main__":
    unittest.main()
