import ast
import sys
from pathlib import Path


TARGET_FUNCTIONS = {
    "_read_tid_event_state", "_write_tid_event_state", "_mask_account_no",
    "_format_tid_upload_event", "_fetch_tid_upload_events", "_tid_upload_event_loop",
    "_read_notification_event_state", "_write_notification_event_state",
    "_fetch_eatspay_notification_events", "_has_deposit_notification_event",
    "_notification_event_loop", "_is_eatspay_txid_room", "_safe_filename",
    "_dump_txid_payload", "_extract_excel_file_candidates", "_download_txid_candidate",
    "_post_txid_file_to_eatspay", "_request_eatspay_txid_download_link",
    "handle_eatspay_txid_download_command", "handle_eatspay_txid_upload_payload",
}
TARGET_CONSTANTS = {
    "EATSPAY_TXID_ROOM_IDS", "EATSPAY_TXID_ROOM_NAME_KEYWORD", "EATSPAY_TXID_LOCAL_DIR",
    "EATSPAY_TXID_PAYLOAD_DIR", "EATSPAY_TXID_REMOTE", "EATSPAY_TXID_SSH_KEY",
    "EATSPAY_BASE_URL", "EATSPAY_KAKAO_TXID_TOKEN", "EATSPAY_TID_NOTIFY_ROOMS",
    "EATSPAY_TID_EVENT_STATE_FILE", "EATSPAY_NOTIFICATION_NOTIFY_ROOMS",
    "EATSPAY_NOTIFICATION_EVENT_STATE_FILE",
}


def migrate(path):
    path = Path(path)
    source = path.read_text(encoding="utf-8-sig")
    tree = ast.parse(source)
    ranges = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in TARGET_FUNCTIONS:
            ranges.append((node.lineno, node.end_lineno))
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            names = []
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Name): names.append(target.id)
            if TARGET_CONSTANTS.intersection(names): ranges.append((node.lineno, node.end_lineno))
    lines = source.splitlines(keepends=True)
    for start, end in sorted(ranges, reverse=True):
        del lines[start - 1:end]
    source = "".join(lines)
    source = source.replace(
        "def webhook():\n    data = request.get_json(force=True, silent=True) or {}\n",
        "def webhook():\n    data = request.get_json(force=True, silent=True) or {}\n    if _forward_eatspay_webhook(data):\n        return \"ok\"\n",
        1,
    )
    source = source.replace(
        "    if (not is_private and not is_apple_room(chat_id, room_name)\n            and not is_lupang_room(chat_id, room_name)\n            and not _is_eatspay_txid_room(chat_id, room_name)):\n",
        "    if (not is_private and not is_apple_room(chat_id, room_name)\n            and not is_lupang_room(chat_id, room_name)):\n",
        1,
    )
    source = source.replace("\n    if handle_eatspay_txid_upload_payload(data, chat_id, room_name):\n        return \"ok\"\n", "\n", 1)
    excel_branch = '''\n    if _is_eatspay_txid_room(chat_id, room_name) and re.search(r"\\.(xlsx|xls)$", msg, re.I):
        _dump_txid_payload(data)
        print(f"[TXID_UPLOAD] excel filename without downloadable payload msg={msg!r}", flush=True)
        iris_reply(chat_id, "⚠️ 엑셀 파일명은 감지했지만 파일 다운로드 URL이 웹훅에 없습니다.\\nPC에서 올린 카카오 파일은 봇 웹훅에 파일 내용이 오지 않아 자동 반영할 수 없습니다.")
        return "ok"
'''
    source = source.replace(excel_branch, "\n", 1)
    command_branch = '''    if cmd in ("이츠페이", "eatspay"):
        if not _is_eatspay_txid_room(chat_id, room_name):
            return None
        return handle_eatspay_txid_download_command(chat_id)
    if cmd in ("업로드", "upload"):
        if not _is_eatspay_txid_room(chat_id, room_name):
            return None
        return "📤 수정한 엑셀 파일을 이 방에 올려주세요. 파일이 감지되면 서버에 자동 반영합니다."
'''
    source = source.replace(command_branch, "", 1)
    source = source.replace("    threading.Thread(target=_tid_upload_event_loop, daemon=True).start()\n", "", 1)
    source = source.replace("    threading.Thread(target=_notification_event_loop, daemon=True).start()\n", "", 1)
    anchor = "_load_dotenv_if_needed()\n"
    forwarder = '''_load_dotenv_if_needed()


def _forward_eatspay_webhook(payload):
    url = os.environ.get("EATSPAY_KAKAO_WEBHOOK_URL", "http://127.0.0.1:5010/webhook")
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=1.5) as response:
            result = json.loads(response.read().decode("utf-8", "replace"))
        return bool(result.get("handled"))
    except Exception as exc:
        print(f"[EATSPAY_FORWARD] unavailable: {exc}", flush=True)
        return False
'''
    source = source.replace(anchor, forwarder, 1)
    if "_tid_upload_event_loop" in source or "handle_eatspay_txid_download_command" in source:
        raise RuntimeError("legacy EatsPay symbols remain")
    ast.parse(source)
    path.write_text(source, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    migrate(sys.argv[1])
