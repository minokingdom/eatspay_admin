#!/usr/bin/env python3
import datetime, hashlib, json, os, re, threading, time, urllib.error, urllib.parse, urllib.request, uuid
from pathlib import Path
from flask import Flask, jsonify, request

def _load_env():
    for path in (Path(__file__).with_name(".env"), Path("/home/mino/.bot_env"), Path("/home/mino/eatspay-kakao.env")):
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                    key, value = line.split("=", 1); os.environ.setdefault(key.strip(), value.strip().strip("\"'"))
        except OSError: pass

_load_env()
IRIS_URL = os.environ.get("IRIS_URL", "http://127.0.0.1:3000").rstrip("/")
BASE_URL = os.environ.get("EATSPAY_BASE_URL", "https://eatspay.kr").rstrip("/")
TOKEN = os.environ.get("KAKAO_TXID_TOKEN", "")
ROOM_IDS = {x.strip() for x in os.environ.get("EATSPAY_TXID_ROOM_IDS", "473042992214661").split(",") if x.strip()}
ROOM_KEYWORDS = [x.strip() for x in os.environ.get("EATSPAY_TXID_ROOM_NAME_KEYWORD", "이츠페이_TXID 업로드방,이츠페이_TXID,이츠페이_TID").split(",") if x.strip()]
TID_NOTIFY_ROOMS = [x.strip() for x in os.environ.get("EATSPAY_TID_NOTIFY_ROOMS", "473042992214661").split(",") if x.strip()]
NOTIFY_ROOMS = [x.strip() for x in os.environ.get("EATSPAY_NOTIFICATION_NOTIFY_ROOMS", "380705904900190").split(",") if x.strip()]
TID_STATE_PATH = Path(os.environ.get("EATSPAY_TID_EVENT_STATE_FILE", "/home/mino/eatspay_tid_event_state.json"))
NOTIFY_STATE_PATH = Path(os.environ.get("EATSPAY_NOTIFICATION_EVENT_STATE_FILE", "/home/mino/eatspay_notification_event_state.json"))
UPLOAD_DIR = Path(os.environ.get("EATSPAY_TXID_LOCAL_DIR", "/home/mino/eatspay_txid_uploads"))
PAYLOAD_DIR = Path(os.environ.get("EATSPAY_TXID_PAYLOAD_DIR", "/home/mino/eatspay_txid_payloads"))
POLLERS_ENABLED = os.environ.get("EATSPAY_POLLERS_ENABLED", "0").lower() in {"1", "true", "yes", "on"}
PORT = int(os.environ.get("EATSPAY_KAKAO_PORT", "5010"))
app = Flask(__name__); _recent = {}; _recent_lock = threading.Lock()

def is_eatspay_room(chat_id, room_name):
    return str(chat_id or "").strip() in ROOM_IDS or any(k in str(room_name or "") for k in ROOM_KEYWORDS)

def read_state(path):
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8")); return value if isinstance(value, dict) else {}
    except (OSError, ValueError): return {}

def write_state(path, state):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True); temp = Path(str(path) + ".tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"); os.replace(temp, path)

def _mask_account(value):
    digits = re.sub(r"\D", "", str(value or "")); return digits if len(digits) <= 4 else "*" * (len(digits) - 4) + digits[-4:]

def format_tid_upload_event(event):
    lines = ["✅ 이츠페이 TID 엑셀 서버 반영 완료", f"배치: {event.get('batchId') or '-'}", f"결과: 전체 {int(event.get('total') or 0)}건 / 반영 {int(event.get('updated') or 0)}건 / 스킵 {int(event.get('skipped') or 0)}건"]
    invalid, missing, ambiguous = (int(event.get(k) or 0) for k in ("invalidTid", "notFound", "ambiguous"))
    if invalid or missing or ambiguous: lines.append(f"확인 필요: 형식오류 {invalid}건 / 미매칭 {missing}건 / 중복후보 {ambiguous}건")
    targets = [x for x in event.get("targets") or [] if x.get("status") == "UPDATED"]
    if targets:
        lines += ["", "반영 대상"]
        for index, item in enumerate(targets[:10], 1):
            tid = item.get("recurringTid") or item.get("manualTid") or ""; tail = f" / TID {tid[-6:]}" if tid else ""
            lines.append(f"{index}. {item.get('franchiseName') or '이름 없음'} / 계좌 {_mask_account(item.get('accountNo'))}{tail}")
    return "\n".join(lines)

def _api_json(path, method="GET", body=None, timeout=30):
    if not TOKEN: raise RuntimeError("KAKAO_TXID_TOKEN is not configured")
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE_URL + path, data=data, headers={"X-Kakao-Txid-Token": TOKEN, "Content-Type": "application/json"}, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as response: return json.loads(response.read().decode("utf-8", "replace"))

def iris_reply(room, text):
    req = urllib.request.Request(IRIS_URL + "/reply", data=json.dumps({"type":"text","room":str(room),"data":text}, ensure_ascii=False).encode(), headers={"Content-Type":"application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as response: response.read(); return response.status
    except Exception as exc: print(f"[IRIS_REPLY] failed room={room}: {exc}", flush=True); return None

def _unique_rooms(*groups):
    rooms = []
    for group in groups:
        values = group if isinstance(group, (list, tuple, set)) else [group]
        for room in values:
            room_id = str(room or "").strip()
            if room_id and room_id not in rooms: rooms.append(room_id)
    return rooms

def _sender_name(payload):
    item = payload.get("json") or {}
    for value in (payload.get("sender"), payload.get("author"), payload.get("name"), item.get("sender"), item.get("name"), item.get("nickname"), item.get("user_name"), item.get("profile_name")):
        name = str(value or "").strip()
        if name: return name
    return "누군가"

def tid_delivery_rooms(source_room=None):
    return _unique_rooms(source_room, TID_NOTIFY_ROOMS)

def deliver_tid_text(text, source_room=None):
    statuses = [iris_reply(room, text) for room in tid_delivery_rooms(source_room)]
    return bool(statuses) and all(statuses)

def fetch_tid_events(since=""):
    query = "?since=" + urllib.parse.quote(str(since)) if since else ""
    return ((_api_json("/api/internal/kakao/account-approvals/tid-upload-events" + query) or {}).get("data") or {}).get("events") or []

def fetch_notification_events(state):
    query = urllib.parse.urlencode({"sincePg":int(state.get("last_pg_id") or 0), "sinceDeposit":int(state.get("last_deposit_id") or 0), "limit":50})
    return (_api_json("/api/internal/kakao/notification-events?" + query) or {}).get("data") or {}

def notification_texts(event):
    texts = event.get("texts") if isinstance(event, dict) else None
    if isinstance(texts, list):
        result = [str(text).strip() for text in texts if str(text or "").strip()]
        if result: return result
    text = str((event or {}).get("text") or "").strip()
    return [text] if text else []

def _has_deposit(events):
    return any(any(mark in text for mark in ("입금 이체 성공","입금일시=","입금일시:","WD")) for event in events or [] for text in notification_texts(event))

def next_notification_state(state, data):
    result = dict(state); result["last_pg_id"] = int(data.get("maxPgId") or result.get("last_pg_id") or 0)
    if _has_deposit(data.get("events") or []): result["last_deposit_id"] = int(data.get("maxDepositId") or result.get("last_deposit_id") or 0)
    return result

def request_export_link():
    try: return True, "ok", _api_json("/api/internal/kakao/account-approvals/export-link", method="POST", body={})
    except urllib.error.HTTPError as exc: return False, exc.read().decode("utf-8", "replace")[:800], None
    except Exception as exc: return False, str(exc), None

def export_command_text():
    ok, message, data = request_export_link()
    if ok:
        item = (data or {}).get("data") or {}; return f"📥 이츠페이 TID 엑셀 다운로드\n대상: {item.get('count',0)}건\n파일: {item.get('fileName','')}\n\n1) 엑셀 다운로드\n{item.get('url','')}\n\n2) 수정본 서버 업로드\n{item.get('uploadUrl','')}\n\nPC에서 수정한 파일은 2번 업로드 링크로 올려주세요."
    if "NO_EXPORT_ROWS" in message: return "📭 현재 내보낼 승인 계좌가 없습니다.\n관리자 페이지에서 다운로드 가능한 계좌가 생기면 다시 !이츠페이 해주세요."
    return "⚠️ 이츠페이 다운로드 준비 실패\n" + message[:500]

def _walk(value):
    if isinstance(value, dict):
        yield value
        for item in value.values(): yield from _walk(item)
    elif isinstance(value, list):
        for item in value: yield from _walk(item)
    elif isinstance(value, str):
        text = value.strip()
        if len(text) < 200000 and text[:1] in {"{", "["}:
            try: yield from _walk(json.loads(text))
            except (TypeError, ValueError): pass

def _excel_candidates(payload):
    result=[]
    for item in _walk(payload):
        low={str(k).lower():v for k,v in item.items()}; name=low.get("filename") or low.get("file_name") or low.get("name") or "eatspay_tid.xlsx"; url=low.get("download_url") or low.get("downloadurl") or low.get("file_url") or low.get("url")
        if re.search(r"\.(xlsx|xls)($|[?&#])", " ".join(map(str,(name,url))), re.I): result.append((str(name),str(url or "")))
    return result

def _upload_excel(name, url):
    if not url.startswith(("http://","https://")): raise ValueError("다운로드 URL이 없습니다")
    UPLOAD_DIR.mkdir(parents=True,exist_ok=True); safe=re.sub(r"[^0-9A-Za-z가-힣._ -]+","_",Path(name).name) or "eatspay_tid.xlsx"; local=UPLOAD_DIR/(datetime.datetime.now().strftime("%Y%m%d_%H%M%S_")+safe)
    with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0"}),timeout=60) as response: local.write_bytes(response.read(25*1024*1024+1))
    boundary="----eatspay"+uuid.uuid4().hex; content=local.read_bytes(); body=(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{local.name}\"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n".encode()+content+f"\r\n--{boundary}--\r\n".encode())
    req=urllib.request.Request(BASE_URL+"/api/internal/kakao/account-approvals/txid-upload",data=body,headers={"X-Kakao-Txid-Token":TOKEN,"Content-Type":"multipart/form-data; boundary="+boundary},method="POST")
    with urllib.request.urlopen(req,timeout=90) as response: return json.loads(response.read().decode("utf-8","replace"))

def _dedupe(payload):
    key=hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False).encode()).hexdigest(); now=time.time()
    with _recent_lock:
        for old,stamp in list(_recent.items()):
            if now-stamp>30: _recent.pop(old,None)
        if key in _recent: return True
        _recent[key]=now
    return False

def process_webhook(payload):
    message=str(payload.get("msg") or "").strip(); room_name=payload.get("room") or ""; chat_id=(payload.get("json") or {}).get("chat_id") or room_name
    if not is_eatspay_room(chat_id,room_name) or _dedupe(payload): return False
    for name,url in _excel_candidates(payload):
        PAYLOAD_DIR.mkdir(parents=True,exist_ok=True); (PAYLOAD_DIR/f"txid_payload_{int(time.time())}_{uuid.uuid4().hex[:8]}.json").write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding="utf-8")
        uploader = _sender_name(payload)
        deliver_tid_text(f"📥 TID 엑셀 업로드 감지\n업로더: {uploader}\n파일: {name}", chat_id)
        try: _upload_excel(name,url); deliver_tid_text(f"✅ TID 엑셀 서버 업로드 완료\n업로더: {uploader}\n파일: {name}", chat_id)
        except Exception as exc: deliver_tid_text(f"⚠️ TID 엑셀 처리 실패\n업로더: {uploader}\n파일: {name}\n{str(exc)[:300]}", chat_id)
        return True
    if message.lower() in {"!이츠페이","!eatspay"}: deliver_tid_text(export_command_text(), chat_id); return True
    if message.lower() in {"!업로드","!upload"}: iris_reply(chat_id,"📤 수정한 엑셀 파일을 이 방에 올려주세요. 파일이 감지되면 서버에 자동 반영합니다."); return True
    return False

def poll_tid_events_once(state):
    progress = state.setdefault("delivery_progress", {})
    completed_batches = state.setdefault("auto_link_completed_batches", [])
    for event in fetch_tid_events(state.get("last_id", "")):
        event_id = str(event.get("id") or "")
        event_progress = progress.setdefault(event_id, {})
        text = format_tid_upload_event(event)
        delivered_event_rooms = set(event_progress.get("event_rooms") or [])
        for room in _unique_rooms(TID_NOTIFY_ROOMS):
            if room in delivered_event_rooms: continue
            status = iris_reply(room, text)
            if not status:
                print(f"[TID_EVENT] delivery failed id={event_id} room={room}", flush=True)
                return False
            delivered_event_rooms.add(room)
            event_progress["event_rooms"] = sorted(delivered_event_rooms)
            write_state(TID_STATE_PATH, state)

        batch_id = str(event.get("batchId") or "").strip()
        try: remaining_count = int(event.get("remainingValidationCount"))
        except (TypeError, ValueError): remaining_count = None
        if batch_id and remaining_count == 0 and batch_id not in completed_batches:
            if not event_progress.get("auto_link_text"):
                event_progress["auto_link_text"] = export_command_text()
                write_state(TID_STATE_PATH, state)
            delivered_link_rooms = set(event_progress.get("auto_link_rooms") or [])
            for room in _unique_rooms(TID_NOTIFY_ROOMS):
                if room in delivered_link_rooms: continue
                status = iris_reply(room, event_progress["auto_link_text"])
                if not status:
                    print(f"[TID_AUTO_LINK] delivery failed batch={batch_id} room={room}", flush=True)
                    return False
                delivered_link_rooms.add(room)
                event_progress["auto_link_rooms"] = sorted(delivered_link_rooms)
                write_state(TID_STATE_PATH, state)
            completed_batches.append(batch_id)
            del completed_batches[:-200]
            write_state(TID_STATE_PATH, state)

        progress.pop(event_id, None)
        state["last_id"] = event_id or state.get("last_id", "")
        if not progress: state.pop("delivery_progress", None)
        write_state(TID_STATE_PATH, state)
        print(f"[TID_EVENT] delivered id={state['last_id']} rooms={len(TID_NOTIFY_ROOMS)}", flush=True)
    return True

def _tid_loop():
    while True:
        try: poll_tid_events_once(read_state(TID_STATE_PATH))
        except Exception as exc: print(f"[TID_EVENT] poll failed: {exc}",flush=True)
        time.sleep(10)

def poll_notification_events_once(state):
    data = fetch_notification_events(state)
    if not state.get("initialized"):
        state.update({"initialized":True,"last_pg_id":int(data.get("maxPgId") or 0),"last_deposit_id":int(data.get("maxDepositId") or 0)})
        write_state(NOTIFY_STATE_PATH, state)
        return True
    progress = state.setdefault("delivery_progress", {})
    for event in data.get("events") or []:
        texts = notification_texts(event)
        if not texts: continue
        event_key = f"{event.get('kind') or 'event'}:{event.get('id') or ''}"
        delivered = set(progress.get(event_key) or [])
        for room in NOTIFY_ROOMS:
            for index, text in enumerate(texts):
                delivery_key = f"{room}:{index}"
                if delivery_key in delivered: continue
                status = iris_reply(room, text)
                if not status:
                    progress[event_key] = sorted(delivered)
                    write_state(NOTIFY_STATE_PATH, state)
                    print(f"[NOTI_EVENT] delivery failed id={event_key} room={room} message={index + 1}", flush=True)
                    return False
                delivered.add(delivery_key)
                progress[event_key] = sorted(delivered)
                write_state(NOTIFY_STATE_PATH, state)
        progress.pop(event_key, None)
    state.update(next_notification_state(state, data))
    if not progress: state.pop("delivery_progress", None)
    write_state(NOTIFY_STATE_PATH, state)
    return True

def _notification_loop():
    while True:
        try:
            poll_notification_events_once(read_state(NOTIFY_STATE_PATH))
        except Exception as exc: print(f"[NOTI_EVENT] poll failed: {exc}",flush=True)
        time.sleep(10)

@app.post("/webhook")
def webhook(): return jsonify({"ok":True,"handled":process_webhook(request.get_json(force=True,silent=True) or {})})
@app.get("/health")
def health(): return jsonify({"ok":True,"pollersEnabled":POLLERS_ENABLED,"tokenConfigured":bool(TOKEN)})

if __name__=="__main__":
    if POLLERS_ENABLED:
        threading.Thread(target=_tid_loop,daemon=True,name="eatspay-tid-events").start(); threading.Thread(target=_notification_loop,daemon=True,name="eatspay-notification-events").start()
    print(f"[eatspay-kakao] starting 127.0.0.1:{PORT} pollers={POLLERS_ENABLED}",flush=True); app.run(host="127.0.0.1",port=PORT,threaded=True)
