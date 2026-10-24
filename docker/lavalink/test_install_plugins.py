"""Offline integrity tests: never contact Maven, media providers or Discord."""
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("installer", Path(__file__).with_name("install-plugins.py"))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def artifact(properties="name=test\nversion=1.0.0\npath=test.plugin\n", filename="lavalink-plugins/test.properties"):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as jar:
        jar.writestr(filename, properties)
    return output.getvalue()


class IntegrityTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.raw = artifact()
        self.item = {"id": "test", "version": "1.0.0", "sha256": hashlib.sha256(self.raw).hexdigest()}

    def test_accepts_verified_plugin(self):
        installer.install(self.item, self.raw, self.folder.name)
        self.assertEqual(Path(self.folder.name, "test-1.0.0.jar").read_bytes(), self.raw)

    def test_rejects_tampered_artifact(self):
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            installer.install(self.item, self.raw + b"tampered", self.folder.name)
        self.assertEqual(list(Path(self.folder.name).iterdir()), [])

    def test_missing_digest_never_relaxes_normal_image_build(self):
        self.item["sha256"] = ""
        with self.assertRaisesRegex(ValueError, "missing reviewed"):
            installer.install(self.item, self.raw, self.folder.name)

    def test_rejects_non_plugin_or_wrong_identity(self):
        for raw in [artifact(filename="META-INF/MANIFEST.MF"), artifact("name=unreviewed\n")]:
            self.item["sha256"] = hashlib.sha256(raw).hexdigest()
            with self.assertRaises(ValueError):
                installer.install(self.item, raw, self.folder.name)

    def test_only_approved_https_build_repositories(self):
        for url in ["http://github.com/artifact", "https://evil.example/artifact", "https://secret@github.com/artifact", "https://github.com:8080/artifact", "file:///etc/passwd"]:
            with self.assertRaises(ValueError):
                installer.checked_url(url)
        self.assertEqual(installer.checked_url("https://maven.lavalink.dev/releases/artifact.jar"), "https://maven.lavalink.dev/releases/artifact.jar")

    def test_dspx_has_only_one_metadata_registration(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as jar:
            jar.writestr("lavalink-plugins/your-plugin.properties", "name=lavadspx-plugin\n")
            jar.writestr("lavalink-plugins/plugin-template.properties", "name=plugin-template\n")
            jar.writestr("me/devoxin/retained-notice.txt", "Upstream notice remains intact")
        raw = data.getvalue()
        installer.install({"id": "lavadspx-plugin", "version": "0.0.5", "sha256": hashlib.sha256(raw).hexdigest()}, raw, self.folder.name)
        with zipfile.ZipFile(Path(self.folder.name, "lavadspx-plugin-0.0.5.jar")) as jar:
            metadata = [name for name in jar.namelist() if name.startswith("lavalink-plugins/")]
            self.assertEqual(metadata, ["lavalink-plugins/lavadspx-plugin.properties"])
            self.assertIn(b"apiVersion=4.0.0", jar.read(metadata[0]))
            self.assertEqual(jar.read("me/devoxin/retained-notice.txt"), b"Upstream notice remains intact")

    def test_never_strips_signature_to_patch_a_signed_plugin(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w") as jar:
            jar.writestr("lavalink-plugins/test.properties", "name=lavadspx-plugin\n")
            jar.writestr("META-INF/SIGNATURE.SF", "signature")
        raw = data.getvalue()
        with self.assertRaisesRegex(ValueError, "signed"):
            installer.install({"id": "lavadspx-plugin", "version": "0.0.5", "sha256": hashlib.sha256(raw).hexdigest()}, raw, self.folder.name)


if __name__ == "__main__":
    unittest.main()
