"""Integration guardrails for the QNAP image-only, two-service manifest."""
from pathlib import Path
import unittest


class IntegratedComposeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = (Path(__file__).resolve().parents[1] / "deployment" /
                    "container-station.compose.yaml").read_text()
        cls.main, cls.agent = cls.text.split("\n  voice-agent:", maxsplit=1)

    def test_both_images_are_immutable_and_share_release_sha(self):
        self.assertIn("ghcr.io/msaperst/family-hq:sha-", self.main)
        self.assertIn("ghcr.io/msaperst/family-hq-voice-agent:sha-", self.agent)
        self.assertEqual(self.text.count("REPLACE_WITH_40_CHAR_COMMIT_SHA"), 2)

    def test_data_and_loopback_ingress_preserved(self):
        self.assertIn("127.0.0.1:3080:3080", self.main)
        self.assertIn("family-hq-data:/app/data", self.main)
        self.assertIn("external: true", self.agent)

    def test_health_order_and_internal_network(self):
        self.assertIn("condition: service_healthy", self.agent)
        self.assertIn("restart: true", self.agent)
        self.assertIn("FAMILY_HQ_URL: http://family-hq:3080", self.agent)
        self.assertNotIn("\n    ports:", self.agent)

    def test_bridge_secrets_are_not_shared_with_main(self):
        self.assertNotIn("IOT_CERT_PATH", self.main)
        self.assertIn("/share/homes/msaperst/family-hq-voice/certs:/run/certs:ro", self.agent)
        self.assertIn("read_only: true", self.agent)
        self.assertIn("no-new-privileges:true", self.agent)


if __name__ == "__main__":
    unittest.main()
