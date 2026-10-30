import json
from decimal import Decimal
import unittest
from unittest.mock import MagicMock, patch

import lambda_handler


class LambdaTests(unittest.TestCase):
    def test_invalid_requests_never_contact_aws(self):
        bad = (None, [], "ping", {}, {"action": "delete_all"},
               {"action": "ping", "args": {"url": "https://bad"}},
               {"action": "list_chores", "args": {"child": ""}},
               {"action": "list_chores", "args": {"child": "   "}},
               {"action": "list_chores", "args": {"child": "Miller", "extra": 1}},
               {"action": "ping", "metadata": "no"})
        with patch.object(lambda_handler.boto3, "client") as client:
            for event in bad:
                with self.subTest(event=event):
                    self.assertEqual(lambda_handler.handler(event, None)["error"], "invalid request")
        client.assert_not_called()

    def test_publishes_valid_command_and_reads_matching_response(self):
        mqtt, table, resource = MagicMock(), MagicMock(), MagicMock()
        resource.Table.return_value = table
        table.get_item.side_effect = [
            {},
            {"Item": {"id": "a" * 32, "ok": True,
                      "result": {"child": "Miller", "chores": ["Set Table"],
                                 "remaining": Decimal("1")}, "error": None}},
        ]
        with patch.dict(lambda_handler.os.environ, {"RESPONSE_TABLE": "test-table", "IOT_DATA_ENDPOINT": "test.iot"}), \
             patch.object(lambda_handler.boto3, "client", return_value=mqtt), \
             patch.object(lambda_handler.boto3, "resource", return_value=resource), \
             patch.object(lambda_handler.uuid, "uuid4") as uuid4, \
             patch.object(lambda_handler.time, "sleep"):
            uuid4.return_value.hex = "a" * 32
            result = lambda_handler.handler({"action": "list_chores", "args": {"child": "Miller"}}, None)
        self.assertEqual(result, {"ok": True, "result": {"child": "Miller", "chores": ["Set Table"], "remaining": 1}, "error": None})
        self.assertEqual(table.get_item.call_args.kwargs, {"Key": {"id": "a" * 32}, "ConsistentRead": True})
        kwargs = mqtt.publish.call_args.kwargs
        self.assertEqual(kwargs["topic"], "family-hq/v1/commands")
        self.assertEqual(kwargs["qos"], 0)
        command = json.loads(kwargs["payload"])
        self.assertEqual(command["id"], "a" * 32)
        self.assertEqual(command["action"], "list_chores")
        self.assertLessEqual(len(kwargs["payload"]), 4096)
        self.assertEqual(command["args"], {"child": "Miller"})

    def test_publish_failure_is_safe(self):
        from botocore.exceptions import ClientError
        mqtt = MagicMock()
        mqtt.publish.side_effect = ClientError({"Error": {"Code": "AccessDenied", "Message": "private"}}, "Publish")
        with patch.dict(lambda_handler.os.environ, {"RESPONSE_TABLE": "tbl", "IOT_DATA_ENDPOINT": "test.iot"}), \
             patch.object(lambda_handler.boto3, "client", return_value=mqtt), \
             patch.object(lambda_handler.boto3, "resource"):
            result = lambda_handler.handler({"action": "ping"}, None)
        self.assertEqual(result, {"ok": False, "error": "command publish unavailable"})

    def test_dynamodb_failure_is_safe(self):
        from botocore.exceptions import ClientError
        table = MagicMock()
        table.get_item.side_effect = ClientError({"Error": {"Code": "Denied", "Message": "private"}}, "GetItem")
        resource = MagicMock()
        resource.Table.return_value = table
        with patch.dict(lambda_handler.os.environ, {"RESPONSE_TABLE": "tbl", "IOT_DATA_ENDPOINT": "test.iot"}), \
             patch.object(lambda_handler.boto3, "client"), \
             patch.object(lambda_handler.boto3, "resource", return_value=resource):
            result = lambda_handler.handler({"action": "ping"}, None)
        self.assertEqual(result, {"ok": False, "error": "response store unavailable"})

    def test_timeout_without_response(self):
        context = MagicMock()
        context.get_remaining_time_in_millis.return_value = 1000
        table = MagicMock()
        resource = MagicMock()
        resource.Table.return_value = table
        with patch.dict(lambda_handler.os.environ, {"RESPONSE_TABLE": "tbl", "IOT_DATA_ENDPOINT": "test.iot"}), \
             patch.object(lambda_handler.boto3, "client"), \
             patch.object(lambda_handler.boto3, "resource", return_value=resource):
            result = lambda_handler.handler({"action": "ping"}, context)
        self.assertEqual(result, {"ok": False, "error": "bridge timeout"})
        table.get_item.assert_not_called()

    def test_malformed_response_fails_closed(self):
        table = MagicMock()
        table.get_item.return_value = {"Item": {"ok": "true", "result": {}, "error": None}}
        resource = MagicMock()
        resource.Table.return_value = table
        with patch.dict(lambda_handler.os.environ, {"RESPONSE_TABLE": "tbl", "IOT_DATA_ENDPOINT": "test.iot"}), \
             patch.object(lambda_handler.boto3, "client"), \
             patch.object(lambda_handler.boto3, "resource", return_value=resource):
            result = lambda_handler.handler({"action": "ping"}, None)
        self.assertEqual(result, {"ok": False, "error": "invalid bridge response"})


if __name__ == "__main__":
    unittest.main()
