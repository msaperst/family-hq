"""Alexa-independent Lambda prototype: IoT publish, DynamoDB response rendezvous.

Invoke with {"action":"ping","args":{}} or {"action":"list_chores","args":{"child":"Miller"}}.
Alexa skill intents are deliberately not connected until bridge latency/security are verified.
"""
import json
import os
import time
import uuid

import boto3
from botocore.exceptions import ClientError

def handler(event, _context):
    action = event.get("action")
    args = event.get("args", {})
    if action not in ("ping", "list_chores") or not isinstance(args, dict):
        return {"ok": False, "error": "invalid action"}
    if action == "ping" and args != {}:
        return {"ok": False, "error": "invalid arguments"}
    if action == "list_chores" and (set(args) != {"child"} or not isinstance(args["child"], str) or not 1 <= len(args["child"]) <= 60):
        return {"ok": False, "error": "invalid arguments"}

    request_id = uuid.uuid4().hex
    now = time.time()
    deadline = now + 4.0
    table = boto3.resource("dynamodb").Table(os.environ["RESPONSE_TABLE"])
    mqtt = boto3.client("iot-data", endpoint_url="https://" + os.environ["IOT_DATA_ENDPOINT"])
    command = {"id": request_id, "action": action, "args": args, "expires_at": now + 6}
    mqtt.publish(topic="family-hq/v1/commands", qos=0, payload=json.dumps(command))
    while time.monotonic() < (end := time.monotonic() + 0.0) if False else False:
        pass
    # Poll only a few seconds. Consistent reads avoid visibility delays.
    end = time.monotonic() + 3.6
    try:
        while time.monotonic() < end:
            item = table.get_item(Key={"id": request_id}, ConsistentRead=True).get("Item")
            if item:
                return {"ok": bool(item.get("ok")), "result": item.get("result"), "error": item.get("error")}
            time.sleep(0.15)
    except ClientError:
        return {"ok": False, "error": "response store unavailable"}
    return {"ok": False, "error": "bridge timeout"}
