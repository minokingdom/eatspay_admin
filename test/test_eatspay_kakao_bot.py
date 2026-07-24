import importlib.util
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).parents[1] / "kakao" / "eatspay_kakao_bot.py"


def load_module():
    if "flask" not in sys.modules:
        flask = types.ModuleType("flask")
        class FakeFlask:
            def __init__(self, *args, **kwargs): pass
            def post(self, *args, **kwargs): return lambda fn: fn
            def get(self, *args, **kwargs): return lambda fn: fn
        flask.Flask = FakeFlask
        flask.jsonify = lambda value: value
        flask.request = types.SimpleNamespace(get_json=lambda **kwargs: {})
        sys.modules["flask"] = flask
    spec = importlib.util.spec_from_file_location("eatspay_kakao_bot", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class EatsPayKakaoBotTests(unittest.TestCase):
    def setUp(self):
        self.bot = load_module()

    def test_matches_only_configured_room_or_keyword(self):
        self.assertTrue(self.bot.is_eatspay_room("473042992214661", "원장 개인방"))
        self.assertTrue(self.bot.is_eatspay_room("1", "이츠페이_TID 업로드방"))
        self.assertFalse(self.bot.is_eatspay_room("460328798262123", "애플어린이집방"))

    def test_formats_tid_event_without_exposing_full_account(self):
        text = self.bot.format_tid_upload_event({
            "batchId": "batch-1", "total": 1, "updated": 1,
            "targets": [{"status": "UPDATED", "franchiseName": "테스트", "accountNo": "1234567890", "recurringTid": "TID123456"}],
        })
        self.assertIn("batch-1", text)
        self.assertIn("******7890", text)
        self.assertNotIn("1234567890", text)

    def test_notification_cursor_advances_deposit_only_for_deposit_event(self):
        state = {"initialized": True, "last_pg_id": 10, "last_deposit_id": 20}
        result = self.bot.next_notification_state(state, {"maxPgId": 11, "maxDepositId": 21, "events": [{"text": "카드 결제 승인"}]})
        self.assertEqual(result["last_pg_id"], 11)
        self.assertEqual(result["last_deposit_id"], 20)
        result = self.bot.next_notification_state(state, {"maxPgId": 11, "maxDepositId": 21, "events": [{"text": "입금일시: 2026-07-12"}]})
        self.assertEqual(result["last_deposit_id"], 21)

    def test_webhook_routes_eatspay_command_but_ignores_apple_room(self):
        with mock.patch.object(self.bot, "request_export_link", return_value=(True, "ok", {"data": {"count": 2, "fileName": "tid.xlsx", "url": "https://download", "uploadUrl": "https://upload"}})), \
             mock.patch.object(self.bot, "iris_reply", return_value=200) as reply:
            result = self.bot.process_webhook({"msg": "!이츠페이", "room": "원장", "json": {"chat_id": "473042992214661", "user_id": "1"}})
            self.assertTrue(result)
            self.assertIn("https://download", reply.call_args.args[1])
            reply.reset_mock()
            result = self.bot.process_webhook({"msg": "!이츠페이", "room": "애플어린이집방", "json": {"chat_id": "460328798262123", "user_id": "1"}})
            self.assertFalse(result)
            reply.assert_not_called()

    def test_manual_export_link_is_mirrored_to_tid_notify_rooms_once(self):
        with mock.patch.object(self.bot, "request_export_link", return_value=(True, "ok", {"data": {"count": 2, "fileName": "tid.xlsx", "url": "https://download", "uploadUrl": "https://upload"}})), \
             mock.patch.object(self.bot, "TID_NOTIFY_ROOMS", ["473042992214661", "380705904900190"]), \
             mock.patch.object(self.bot, "iris_reply", return_value=200) as reply:
            self.assertTrue(self.bot.process_webhook({"msg": "!이츠페이", "room": "mino", "json": {"chat_id": "473042992214661", "user_id": "1"}}))
        self.assertEqual([call.args[0] for call in reply.call_args_list], ["473042992214661", "380705904900190"])
        self.assertTrue(all("https://download" in call.args[1] for call in reply.call_args_list))

    def test_state_write_is_atomic(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            self.bot.write_state(path, {"last_id": "a"})
            self.assertEqual(self.bot.read_state(path), {"last_id": "a"})
            self.assertFalse(Path(str(path) + ".tmp").exists())

    def test_extracts_excel_from_stringified_iris_attachment(self):
        payload = {
            "msg": "★에이빅스 ★(업로드).xlsx",
            "room": "mino",
            "json": {
                "chat_id": "473042992214661",
                "type": "18",
                "attachment": '{"name":"★에이빅스 ★(업로드).xlsx","size":310501,"url":"https://talk.kakaocdn.net/file.xlsx?signature=test"}',
            },
        }
        self.assertEqual(
            self.bot._excel_candidates(payload),
            [("★에이빅스 ★(업로드).xlsx", "https://talk.kakaocdn.net/file.xlsx?signature=test")],
        )

    def test_tid_cursor_does_not_advance_when_iris_delivery_fails(self):
        event = {"id": "event-2", "batchId": "batch-2", "total": 1, "updated": 1}
        state = {"last_id": "event-1"}
        with mock.patch.object(self.bot, "fetch_tid_events", return_value=[event]), \
             mock.patch.object(self.bot, "iris_reply", return_value=None), \
             mock.patch.object(self.bot, "write_state") as write:
            self.bot.poll_tid_events_once(state)
        write.assert_not_called()
        self.assertEqual(state["last_id"], "event-1")

    def test_completed_tid_batch_generates_next_link_only_once_even_if_zero_repeats(self):
        state = {"last_id": "event-0"}
        events = [
            {"id": "event-1", "batchId": "ACCEXP-BATCH1", "total": 2, "updated": 2, "remainingValidationCount": 0},
            {"id": "event-2", "batchId": "ACCEXP-BATCH1", "total": 2, "updated": 2, "remainingValidationCount": 0},
        ]
        with mock.patch.object(self.bot, "fetch_tid_events", side_effect=[[events[0]], [events[1]]]), \
             mock.patch.object(self.bot, "TID_NOTIFY_ROOMS", ["tid-room", "mobis-room"]), \
             mock.patch.object(self.bot, "export_command_text", return_value="NEXT LINK") as export_text, \
             mock.patch.object(self.bot, "iris_reply", return_value=200) as reply, \
             mock.patch.object(self.bot, "write_state"):
            self.assertTrue(self.bot.poll_tid_events_once(state))
            self.assertTrue(self.bot.poll_tid_events_once(state))
        export_text.assert_called_once_with()
        self.assertEqual(
            [call for call in reply.call_args_list if call.args[1] == "NEXT LINK"],
            [mock.call("tid-room", "NEXT LINK"), mock.call("mobis-room", "NEXT LINK")],
        )
        self.assertIn("ACCEXP-BATCH1", state.get("auto_link_completed_batches", []))

    def test_tid_auto_link_retry_resumes_without_creating_another_link(self):
        event = {"id": "event-1", "batchId": "ACCEXP-BATCH1", "total": 1, "updated": 1, "remainingValidationCount": 0}
        state = {"last_id": "event-0"}
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(self.bot, "TID_STATE_PATH", Path(tmp) / "tid-state.json"), \
             mock.patch.object(self.bot, "fetch_tid_events", return_value=[event]), \
             mock.patch.object(self.bot, "TID_NOTIFY_ROOMS", ["tid-room", "mobis-room"]), \
             mock.patch.object(self.bot, "export_command_text", return_value="NEXT LINK") as export_text, \
             mock.patch.object(self.bot, "iris_reply", side_effect=[200, 200, 200, None, 200]) as reply:
            self.assertFalse(self.bot.poll_tid_events_once(state))
            restarted_state = self.bot.read_state(self.bot.TID_STATE_PATH)
            self.assertTrue(self.bot.poll_tid_events_once(restarted_state))
        export_text.assert_called_once_with()
        self.assertEqual(reply.call_args_list[-1], mock.call("mobis-room", "NEXT LINK"))
        self.assertEqual(restarted_state["last_id"], "event-1")

    def test_tid_upload_attachment_notifies_source_and_mobis_room(self):
        payload = {
            "msg": "eatsPay_ACCEXP-BATCH1.xlsx",
            "room": "이츠페이_TID 업로드방",
            "json": {
                "chat_id": "473042992214661",
                "type": "18",
                "nickname": "상대담당자",
                "attachment": '{"name":"eatsPay_ACCEXP-BATCH1.xlsx","url":"https://talk.kakaocdn.net/file.xlsx"}',
            },
        }
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(self.bot, "TID_NOTIFY_ROOMS", ["473042992214661", "380705904900190"]), \
             mock.patch.object(self.bot, "PAYLOAD_DIR", Path(tmp)), \
             mock.patch.object(self.bot, "_upload_excel", return_value={"success": True}), \
             mock.patch.object(self.bot, "iris_reply", return_value=200) as reply:
            self.assertTrue(self.bot.process_webhook(payload))
        mobis_texts = [call.args[1] for call in reply.call_args_list if call.args[0] == "380705904900190"]
        self.assertTrue(any("상대담당자" in text and "업로드" in text for text in mobis_texts))
        self.assertTrue(any("서버 업로드 완료" in text for text in mobis_texts))

    def test_pollers_are_disabled_by_default(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            bot = load_module()
        self.assertFalse(bot.POLLERS_ENABLED)

    def test_notification_event_supports_two_messages(self):
        event = {
            "text": "legacy fallback",
            "texts": ["transfer success", "daily sales"],
        }
        self.assertEqual(
            self.bot.notification_texts(event),
            ["transfer success", "daily sales"],
        )

    def test_notification_delivery_sends_each_message_to_each_room_once(self):
        state = {"initialized": True, "last_pg_id": 10, "last_deposit_id": 2}
        data = {
            "maxPgId": 11,
            "maxDepositId": 2,
            "events": [{"id": 11, "kind": "pg", "texts": ["transfer", "daily"]}],
        }
        with mock.patch.object(self.bot, "fetch_notification_events", return_value=data), \
             mock.patch.object(self.bot, "NOTIFY_ROOMS", ["380705904900190", "474536781052768"]), \
             mock.patch.object(self.bot, "iris_reply", return_value=200) as reply, \
             mock.patch.object(self.bot, "write_state") as write:
            self.assertTrue(self.bot.poll_notification_events_once(state))
        self.assertEqual(
            reply.call_args_list,
            [
                mock.call("380705904900190", "transfer"),
                mock.call("380705904900190", "daily"),
                mock.call("474536781052768", "transfer"),
                mock.call("474536781052768", "daily"),
            ],
        )
        self.assertEqual(state["last_pg_id"], 11)
        write.assert_called()

    def test_notification_retry_skips_messages_already_delivered(self):
        state = {
            "initialized": True,
            "last_pg_id": 10,
            "last_deposit_id": 2,
            "delivery_progress": {"pg:11": ["room-a:0"]},
        }
        data = {
            "maxPgId": 11,
            "maxDepositId": 2,
            "events": [{"id": 11, "kind": "pg", "texts": ["transfer", "daily"]}],
        }
        with mock.patch.object(self.bot, "fetch_notification_events", return_value=data), \
             mock.patch.object(self.bot, "NOTIFY_ROOMS", ["room-a"]), \
             mock.patch.object(self.bot, "iris_reply", return_value=200) as reply, \
             mock.patch.object(self.bot, "write_state"):
            self.assertTrue(self.bot.poll_notification_events_once(state))
        reply.assert_called_once_with("room-a", "daily")
        self.assertNotIn("delivery_progress", state)


if __name__ == "__main__":
    unittest.main()
