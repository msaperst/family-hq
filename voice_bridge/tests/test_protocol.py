import json
import unittest
from protocol import parse_command, format_result

class ProtocolTests(unittest.TestCase):
    def make(self, **changes):
        data = {"id": "a" * 32, "action": "list_chores", "args": {"child": "Miller"}, "expires_at": 105}
        data.update(changes)
        return json.dumps(data).encode()
    def test_valid(self):
        self.assertEqual(parse_command(self.make(), now=100)["args"]["child"], "Miller")
    def test_invalid(self):
        cases = [
            self.make(action="shell"), self.make(expires_at=99),
            self.make(expires_at=130), self.make(expires_at=True),
            self.make(id="broken"), self.make(args={"child": ""}),
            self.make(args={"child": "A", "url": "https://example.com"}),
            self.make(extra=1), b"[]" ]
        for value in cases:
            with self.subTest(value=value):
                with self.assertRaises((ValueError, TypeError)):
                    parse_command(value, now=100)
    def test_responses(self):
        self.assertEqual(json.loads(format_result("a"*32, error="unavailable"))["ok"], False)

if __name__ == "__main__": unittest.main()
