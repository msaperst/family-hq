"""Private Alexa-independent command bridge: AWS IoT publish -> DynamoDB reply.

The MQTT agent remains outbound-only. This function accepts only read-only
commands and must not be exposed through a public Function URL/API Gateway.
"""
import json
import os
import time
import uuid
from decimal import Decimal

import boto3
from botocore.exceptions import BotoCoreError, ClientError

COMMAND_TOPIC = "family-hq/v1/commands"
RESPONSE_WAIT_SECONDS = 4.5
POLL_SECONDS = 0.2


def validate(event):
    if not isinstance(event, dict) or set(event) - {"action", "args"}:
        return None
    action = event.get("action")
    args = event.get("args", {})
    if action == "ping" and args == {}:
        return action, args
    if action == "list_chores" and isinstance(args, dict) and set(args) == {"child"}:
        child = args["child"]
        if isinstance(child, str) and 1 <= len(child) <= 60 and child.strip():
            return action, args
    return None


def json_safe(value):
    """Boto3 represents DynamoDB numbers as Decimal, not JSON-serializable."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    return value


def handler(event, context):
    request = validate(event)
    if request is None:
        return {"ok": False, "error": "invalid request"}
    action, args = request

    request_id = uuid.uuid4().hex
    now = time.time()
    command = {"id": request_id, "action": action, "args": args, "expires_at": now + 8}

    try:
        # No custom URL or network ingress: only the account's AWS IoT endpoint.
        mqtt = boto3.client("iot-data", endpoint_url="https://" + os.environ["IOT_DATA_ENDPOINT"])
        table = boto3.resource("dynamodb").Table(os.environ["RESPONSE_TABLE"])
        mqtt.publish(topic=COMMAND_TOPIC, qos=0,
                     payload=json.dumps(command, separators=(",", ":")).encode("utf-8"))
    except (BotoCoreError, ClientError, KeyError, ValueError):
        return {"ok": False, "error": "command publish unavailable"}

    # Leave time to serialize and return the result before Lambda's deadline.
    budget = RESPONSE_WAIT_SECONDS
    if context is not None and hasattr(context, "get_remaining_time_in_millis"):
        budget = min(budget, max(0, context.get_remaining_time_in_millis() / 1000 - 1))
    deadline = time.monotonic() + budget
    while time.monotonic() < deadline:
        try:
            item = table.get_item(Key={"id": request_id}, ConsistentRead=True).get("Item")
        except (BotoCoreError, ClientError):
            return {"ok": False, "error": "response store unavailable"}
        if item is not None:
            if (not isinstance(item.get("ok"), bool)
                    or not (item.get("result") is None or isinstance(item.get("result"), dict))
                    or not (item.get("error") is None or isinstance(item.get("error"), str))):
                return {"ok": False, "error": "invalid bridge response"}
            return {"ok": item["ok"], "result": json_safe(item.get("result")),
                    "error": item.get("error")}
        time.sleep(min(POLL_SECONDS, max(0, deadline - time.monotonic())))
    return {"ok": False, "error": "bridge timeout"}
