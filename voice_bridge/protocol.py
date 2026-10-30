"""Strict, small command vocabulary for the read-only Family HQ MQTT bridge."""
import json
import re
import time

ACTIONS = frozenset({"ping", "list_chores"})
REQUEST_ID = re.compile(r"^[a-f0-9]{32}$")

def parse_command(raw, now=None):
    if len(raw) > 4096:
        raise ValueError("oversized command")
    doc = json.loads(raw)
    if not isinstance(doc, dict) or set(doc) != {"id", "action", "expires_at", "args"}:
        raise ValueError("invalid command envelope")
    if not isinstance(doc["id"], str) or not REQUEST_ID.fullmatch(doc["id"]):
        raise ValueError("invalid request id")
    if doc["action"] not in ACTIONS or not isinstance(doc["args"], dict):
        raise ValueError("unsupported action")
    timestamp = time.time() if now is None else now
    expiry = doc["expires_at"]
    if isinstance(expiry, bool) or not isinstance(expiry, (int, float)) or not timestamp < expiry <= timestamp + 10:
        raise ValueError("expired or long-lived command")
    if doc["action"] == "ping" and doc["args"] != {}:
        raise ValueError("unexpected ping args")
    if doc["action"] == "list_chores":
        if set(doc["args"]) != {"child"} or not isinstance(doc["args"]["child"], str):
            raise ValueError("invalid child")
        if not 1 <= len(doc["args"]["child"]) <= 60:
            raise ValueError("invalid child length")
    return doc

def format_result(request_id, result=None, error=None):
    return json.dumps({"id": request_id, "ok": error is None, "result": result if error is None else None,
                       "error": error}, separators=(",", ":"))
