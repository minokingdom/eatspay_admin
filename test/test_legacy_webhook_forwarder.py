import importlib.util
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).parents[1] / "kakao" / "legacy_webhook_forwarder.py"


class LegacyWebhookForwarderTests(unittest.TestCase):
    def test_forwarder_is_fail_open_and_uses_loopback(self):
        spec = importlib.util.spec_from_file_location("legacy_webhook_forwarder", MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with mock.patch("urllib.request.urlopen", side_effect=OSError("down")) as open_url:
            self.assertFalse(module.forward_eatspay_webhook({"msg": "hello"}))
        request = open_url.call_args.args[0]
        self.assertTrue(request.full_url.startswith("http://127.0.0.1:"))

    def test_forwarder_returns_remote_handled_flag(self):
        spec = importlib.util.spec_from_file_location("legacy_webhook_forwarder", MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        response = mock.MagicMock()
        response.__enter__.return_value.read.return_value = b'{"handled": true}'
        with mock.patch("urllib.request.urlopen", return_value=response):
            self.assertTrue(module.forward_eatspay_webhook({"msg": "!eatspay"}))


if __name__ == "__main__":
    unittest.main()
