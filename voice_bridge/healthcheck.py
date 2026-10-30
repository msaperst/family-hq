"""Container health is the agent's subscribed MQTT readiness, not AWS API polling."""
import os
from pathlib import Path
import sys

READY_FILE = Path("/tmp/family-hq-voice.ready")


def healthy(path=READY_FILE):
    try:
        pid = int(Path(path).read_text(encoding="ascii").strip())
        if pid <= 0:
            return False
        os.kill(pid, 0)  # Ensure a previous process did not leave a stale marker.
        return True
    except (OSError, ValueError):
        return False


if __name__ == "__main__":
    sys.exit(0 if healthy() else 1)
