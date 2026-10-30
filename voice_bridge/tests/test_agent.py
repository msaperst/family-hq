import concurrent.futures
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import MagicMock, patch

from awscrt import mqtt
import agent
import healthcheck


class BridgeRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.marker = Path(self.tmp.name) / "ready"
        self.bridge = agent.VoiceBridge(self.marker)
        self.conn = MagicMock()
        self.bridge.connection = self.conn

    def test_health_marker_tracks_connection_loss(self):
        self.assertFalse(healthcheck.healthy(self.marker))
        self.bridge.mark_ready(True)
        self.assertTrue(self.bridge.ready)
        self.assertTrue(healthcheck.healthy(self.marker))
        self.bridge.on_connection_interrupted(self.conn, RuntimeError("offline"))
        self.assertFalse(self.bridge.ready)
        self.assertFalse(healthcheck.healthy(self.marker))

    def test_clean_session_reconnect_waits_for_resubscription(self):
        self.bridge.mark_ready(True)
        self.bridge.on_connection_interrupted(self.conn, RuntimeError("offline"))
        result = concurrent.futures.Future()
        self.conn.resubscribe_existing_topics.return_value = (result, 1)
        self.bridge.on_connection_resumed(self.conn, mqtt.ConnectReturnCode.ACCEPTED, False)
        self.assertFalse(self.bridge.ready)
        result.set_result({"topics": [(agent.COMMANDS, mqtt.QoS.AT_LEAST_ONCE)]})
        self.assertTrue(self.bridge.ready)
        self.assertFalse(self.bridge.restart_required.is_set())

    def test_rejected_resubscription_requests_fresh_connection(self):
        self.bridge.on_connection_interrupted(self.conn, RuntimeError("offline"))
        result = concurrent.futures.Future()
        self.conn.resubscribe_existing_topics.return_value = (result, 1)
        self.bridge.on_connection_resumed(self.conn, mqtt.ConnectReturnCode.ACCEPTED, False)
        result.set_result({"topics": [(agent.COMMANDS, None)]})
        self.assertTrue(self.bridge.restart_required.is_set())
        self.assertFalse(healthcheck.healthy(self.marker))

    def test_resubscribe_failure_requests_restart(self):
        result = concurrent.futures.Future()
        self.conn.resubscribe_existing_topics.return_value = (result, 1)
        self.bridge.on_connection_resumed(self.conn, mqtt.ConnectReturnCode.ACCEPTED, False)
        result.set_exception(RuntimeError("offline again"))
        self.assertTrue(self.bridge.restart_required.is_set())

    def test_late_resubscribe_result_cannot_mask_second_disconnect(self):
        result = concurrent.futures.Future()
        self.conn.resubscribe_existing_topics.return_value = (result, 1)
        self.bridge.on_connection_resumed(self.conn, mqtt.ConnectReturnCode.ACCEPTED, False)
        self.bridge.on_connection_interrupted(self.conn, RuntimeError("offline"))
        result.set_result({"topics": [(agent.COMMANDS, mqtt.QoS.AT_LEAST_ONCE)]})
        self.assertFalse(self.bridge.ready)
        self.assertFalse(healthcheck.healthy(self.marker))

    def test_resumed_persistent_session_is_ready(self):
        self.bridge.on_connection_resumed(self.conn, mqtt.ConnectReturnCode.ACCEPTED, True)
        self.assertTrue(self.bridge.ready)
        self.conn.resubscribe_existing_topics.assert_not_called()

    def test_rejected_reconnect_stays_unhealthy(self):
        self.bridge.on_connection_resumed(self.conn, -1, False)
        self.assertFalse(self.bridge.ready)

    def test_handler_matches_aws_crt_mqtt_callback_contract(self):
        # The SDK validates callback names with keyword arguments at subscribe
        # time. Naming the argument _topic raises TypeError before SUBSCRIBE.
        self.assertFalse(
            mqtt.Connection._check_uses_old_message_callback_signature(
                None, self.bridge.handle_command
            )
        )
        request = json.dumps({"id": "d" * 32, "action": "ping",
                              "args": {}, "expires_at": time.time() + 5}).encode()
        self.bridge.handle_command(
            topic=agent.COMMANDS, payload=request,
            dup=False, qos=mqtt.QoS.AT_LEAST_ONCE, retain=False
        )
        self.conn.publish.assert_called_once()

    def test_ping_and_duplicate_id_are_handled_without_local_api(self):
        with patch.object(agent, "family_chore_list", side_effect=AssertionError("not called")):
            request = json.dumps({"id": "a" * 32, "action": "ping", "args": {},
                                  "expires_at": time.time() + 5}).encode()
            self.bridge.handle_command(agent.COMMANDS, request)
            self.bridge.handle_command(agent.COMMANDS, request)
        self.conn.publish.assert_called_once()
        sent = self.conn.publish.call_args.kwargs
        self.assertEqual(sent["topic"], agent.RESPONSES)
        self.assertEqual(json.loads(sent["payload"])["result"], {"status": "ok"})

    def test_local_api_failure_does_not_kill_agent_or_leak_details(self):
        request = json.dumps({"id": "b" * 32, "action": "list_chores",
                              "args": {"child": "Miller"}, "expires_at": time.time() + 5}).encode()
        with patch.object(agent, "family_chore_list", side_effect=ConnectionError("private details")):
            self.bridge.handle_command(agent.COMMANDS, request)
        response = json.loads(self.conn.publish.call_args.kwargs["payload"])
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"], "unavailable")
        self.assertNotIn("private details", json.dumps(response))

    def test_expired_request_is_ignored(self):
        request = json.dumps({"id": "c" * 32, "action": "ping", "args": {},
                              "expires_at": time.time() - 1}).encode()
        self.bridge.handle_command(agent.COMMANDS, request)
        self.conn.publish.assert_not_called()

    def test_initial_aws_failure_is_retried(self):
        with patch.object(agent, "serve_once", side_effect=[OSError("AWS unavailable"), KeyboardInterrupt]), \
             patch.object(agent.time, "sleep") as sleep:
            with self.assertRaises(KeyboardInterrupt):
                agent.run()
        sleep.assert_called_once_with(1)


if __name__ == "__main__":
    unittest.main()
