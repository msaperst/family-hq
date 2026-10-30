"""Outbound-only MQTT bridge for the LAN-only Family HQ API.

The AWS CRT manages established-connection retries. The outer retry loop handles
initial connect/subscription failures; MQTT session loss restores subscriptions.
No inbound listener is started and only allowlisted, short-lived requests run.
"""
import json
import logging
import os
from pathlib import Path
import threading
import time
import urllib.request

from awscrt import mqtt
from awsiot import mqtt_connection_builder
from protocol import format_result, parse_command

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("family-hq-voice")
COMMANDS = "family-hq/v1/commands"
RESPONSES = "family-hq/v1/responses"
READY_FILE = Path("/tmp/family-hq-voice.ready")


def family_chore_list(child):
    base = os.environ.get("FAMILY_HQ_URL", "http://family-hq:3080").rstrip("/")
    # URL is static trusted deployment configuration, never taken from an MQTT message.
    with urllib.request.urlopen(base + "/api/chores", timeout=2.0) as res:
        dashboard = json.load(res)
    names = []
    matched = False
    for column in dashboard["columns"]:
        if column["name"].casefold() != child.casefold():
            continue
        matched = True
        names.extend(item["name"] for item in column["chores"]
                     if item["dueOn"] <= dashboard["today"] and not item["completed"] and not item.get("skipped"))
    if not matched:
        raise ValueError("Child not found")
    return {"child": child, "chores": names[:30], "remaining": len(names)}


class VoiceBridge:
    def __init__(self, ready_file=READY_FILE):
        self.ready_file = Path(ready_file)
        self.connection = None
        self.restart_required = threading.Event()
        self.lock = threading.Lock()
        self.seen_lock = threading.Lock()
        self.seen = {}
        self.epoch = 0
        self.ready = False
        self.mark_ready(False)

    def mark_ready(self, ready, epoch=None):
        """Only the current connection generation may become healthy."""
        with self.lock:
            if epoch is not None and epoch != self.epoch:
                return
            self.ready = ready
            try:
                if ready:
                    self.ready_file.write_text(str(os.getpid()), encoding="ascii")
                else:
                    self.ready_file.unlink(missing_ok=True)
            except OSError:
                LOG.error("Unable to update MQTT health marker")

    def on_connection_interrupted(self, _connection, _error, **_kwargs):
        with self.lock:
            self.epoch += 1
        self.mark_ready(False)
        LOG.warning("MQTT connection interrupted; SDK reconnecting")

    def _request_restart(self, epoch):
        with self.lock:
            if epoch != self.epoch:
                return
        self.mark_ready(False, epoch)
        self.restart_required.set()

    def _resubscribe_completed(self, future, epoch):
        with self.lock:
            if epoch != self.epoch:
                return
        try:
            topics = future.result()["topics"]
            if not any(topic == COMMANDS and qos is not None for topic, qos in topics):
                raise ValueError("command subscription rejected")
        except Exception:
            LOG.warning("MQTT resubscription failed; restarting connection")
            self._request_restart(epoch)
            return
        self.mark_ready(True, epoch)
        LOG.info("MQTT command subscription restored")

    def on_connection_resumed(self, connection, return_code, session_present, **_kwargs):
        with self.lock:
            self.epoch += 1
            epoch = self.epoch
        self.mark_ready(False, epoch)
        if return_code != mqtt.ConnectReturnCode.ACCEPTED:
            LOG.warning("MQTT reconnect rejected")
            return
        if session_present:
            self.mark_ready(True, epoch)
            LOG.info("MQTT session resumed")
            return
        # We use clean_session=True: the broker forgets subscriptions on reconnect.
        # Never wait on this future inside the SDK event-loop callback.
        try:
            future, _packet_id = connection.resubscribe_existing_topics()
            future.add_done_callback(lambda done: self._resubscribe_completed(done, epoch))
        except Exception:
            LOG.warning("Unable to request MQTT resubscription")
            self._request_restart(epoch)

    def handle_command(self, _topic, payload, **_kwargs):
        try:
            request = parse_command(payload)
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            LOG.warning("Rejected invalid command")
            return
        request_id = request["id"]
        with self.seen_lock:
            now = time.monotonic()
            for key, expiry in list(self.seen.items()):
                if expiry < now:
                    del self.seen[key]
            if request_id in self.seen:
                LOG.warning("Rejected duplicate command")
                return
            self.seen[request_id] = now + 60
        try:
            if request["action"] == "ping":
                result = {"status": "ok"}
            else:
                result = family_chore_list(request["args"]["child"])
            response = format_result(request_id, result=result)
        except Exception as exc:
            # Do not log child names, chore data, HTTP responses, or credentials.
            LOG.warning("Local command failed id=%s type=%s", request_id, type(exc).__name__)
            response = format_result(request_id, error="unavailable")
        try:
            self.connection.publish(topic=RESPONSES, payload=response, qos=mqtt.QoS.AT_LEAST_ONCE)
        except Exception:
            LOG.warning("Unable to publish response id=%s", request_id)


def serve_once(bridge):
    conn = mqtt_connection_builder.mtls_from_path(
        endpoint=os.environ["IOT_ENDPOINT"],
        cert_filepath=os.environ["IOT_CERT_PATH"],
        pri_key_filepath=os.environ["IOT_KEY_PATH"],
        client_id=os.environ.get("IOT_CLIENT_ID", "family-hq-voice-agent"),
        clean_session=True,
        keep_alive_secs=60,
        reconnect_min_timeout_secs=1,
        reconnect_max_timeout_secs=60,
        on_connection_interrupted=bridge.on_connection_interrupted,
        on_connection_resumed=bridge.on_connection_resumed,
    )
    bridge.connection = conn
    try:
        conn.connect().result(timeout=10)
        with bridge.lock:
            initial_epoch = bridge.epoch
        conn.subscribe(topic=COMMANDS, qos=mqtt.QoS.AT_LEAST_ONCE,
                       callback=bridge.handle_command)[0].result(timeout=10)
        bridge.mark_ready(True, initial_epoch)
        LOG.info("Subscribed to command topic; awaiting messages")
        # The SDK handles transient disconnects; only restart for unrecoverable
        # resubscription errors. Container Station can report unhealthy meanwhile.
        bridge.restart_required.wait()
    finally:
        bridge.mark_ready(False)
        try:
            conn.disconnect().result(timeout=5)
        except Exception:
            LOG.warning("MQTT disconnect was not clean")


def run():
    backoff = 1
    while True:
        bridge = VoiceBridge()
        try:
            serve_once(bridge)
            backoff = 1
        except Exception as exc:
            LOG.warning("MQTT connection attempt failed type=%s; retrying", type(exc).__name__)
        finally:
            bridge.mark_ready(False)
        time.sleep(backoff)
        backoff = min(backoff * 2, 60)


if __name__ == "__main__":
    run()
