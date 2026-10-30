"""Outbound-only NAS bridge; mTLS connects to AWS IoT Core. No inbound ports."""
import json
import logging
import os
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

def family_chore_list(child):
    base = os.environ.get("FAMILY_HQ_URL", "http://family-hq:3080").rstrip("/")
    # URL is a trusted static service address, not taken from a cloud message.
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

def run():
    endpoint = os.environ["IOT_ENDPOINT"]
    conn = mqtt_connection_builder.mtls_from_path(
        endpoint=endpoint, cert_filepath=os.environ["IOT_CERT_PATH"],
        pri_key_filepath=os.environ["IOT_KEY_PATH"],
        client_id=os.environ.get("IOT_CLIENT_ID", "family-hq-voice-agent"),
        clean_session=True, keep_alive_secs=60)
    seen = {}
    lock = threading.Lock()
    def handle(_topic, payload, **_kwargs):
        try:
            request = parse_command(payload)
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            LOG.warning("Rejected invalid command")
            return
        request_id = request["id"]
        with lock:
            current = time.monotonic()
            for key, expiry in list(seen.items()):
                if expiry < current: del seen[key]
            if request_id in seen:
                LOG.warning("Rejected duplicate command")
                return
            seen[request_id] = current + 60
        try:
            if request["action"] == "ping":
                result = {"status": "ok"}
            else:
                result = family_chore_list(request["args"]["child"])
            message = format_result(request_id, result=result)
        except Exception:
            LOG.exception("Command failed id=%s", request_id)
            message = format_result(request_id, error="unavailable")
        conn.publish(topic=RESPONSES, payload=message, qos=mqtt.QoS.AT_LEAST_ONCE)
    conn.connect().result(timeout=10)
    conn.subscribe(topic=COMMANDS, qos=mqtt.QoS.AT_LEAST_ONCE, callback=handle)[0].result(timeout=10)
    LOG.info("Subscribed to command topic; awaiting messages")
    try:
        while True: time.sleep(30)
    finally:
        conn.disconnect().result(timeout=10)

if __name__ == "__main__":
    run()
