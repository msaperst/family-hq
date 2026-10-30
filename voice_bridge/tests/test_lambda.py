import unittest
from unittest.mock import patch, MagicMock
import lambda_handler

class LambdaValidationTests(unittest.TestCase):
    def test_rejects_invalid_requests_without_aws_access(self):
        for event in ({"action":"delete_all"}, {"action":"ping","args":{"url":"bad"}}, {"action":"list_chores","args":{"child":""}}):
            with self.subTest(event=event):
                self.assertFalse(lambda_handler.handler(event, None)["ok"])

if __name__ == "__main__": unittest.main()
