import json
import urllib.request

for name, url in [
    ("faqs", "https://eatspay.kr/api/faqs"),
    ("notices", "https://eatspay.kr/api/notices"),
    ("guides", "https://eatspay.kr/api/guides"),
]:
    with urllib.request.urlopen(url, timeout=10) as response:
        payload = json.load(response)
    items = payload.get("data", [])
    labels = [item.get("question") or item.get("title") or "" for item in items]
    print(name, len(items))
    print(" | ".join(labels))
