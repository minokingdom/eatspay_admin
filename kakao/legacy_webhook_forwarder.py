import json
import os
import urllib.request

EATSPAY_WEBHOOK_URL = os.environ.get("EATSPAY_KAKAO_WEBHOOK_URL", "http://127.0.0.1:5010/webhook")

def forward_eatspay_webhook(payload):
    try:
        req = urllib.request.Request(EATSPAY_WEBHOOK_URL, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=1.5) as response:
            result = json.loads(response.read().decode("utf-8", "replace"))
        return bool(result.get("handled"))
    except Exception as exc:
        print(f"[EATSPAY_FORWARD] unavailable: {exc}", flush=True)
        return False
