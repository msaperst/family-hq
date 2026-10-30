"""Guardrails for the private command-response AWS infrastructure."""
from pathlib import Path
import unittest

import yaml


class CfnLoader(yaml.SafeLoader):
    pass


def construct_intrinsic(loader, node):
    return {node.tag[1:]: loader.construct_scalar(node)}


for tag in ("Ref", "GetAtt", "Sub"):
    CfnLoader.add_constructor("!" + tag, construct_intrinsic)


class ResponseStackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(__file__).resolve().parents[1] / "aws" / "response-stack.yaml"
        cls.stack = yaml.load(path.read_text(), Loader=CfnLoader)
        cls.resources = cls.stack["Resources"]

    def test_only_private_aws_resources_are_created(self):
        kinds = {resource["Type"] for resource in self.resources.values()}
        self.assertEqual(kinds, {
            "AWS::DynamoDB::Table", "AWS::IAM::Role", "AWS::IoT::TopicRule",
            "AWS::Lambda::Function", "AWS::Logs::LogGroup",
        })
        self.assertNotIn("FunctionUrlConfig", self.resources["CommandLambda"]["Properties"])

    def test_response_table_has_key_ttl_and_on_demand_billing(self):
        props = self.resources["ResponseTable"]["Properties"]
        self.assertEqual(props["BillingMode"], "PAY_PER_REQUEST")
        self.assertEqual(props["KeySchema"], [{"AttributeName": "id", "KeyType": "HASH"}])
        self.assertEqual(props["TimeToLiveSpecification"], {"Enabled": True, "AttributeName": "ttl"})

    def test_iot_rule_routes_only_responses_to_table(self):
        rule = self.resources["ResponseTopicRule"]["Properties"]["TopicRulePayload"]
        self.assertIn("FROM 'family-hq/v1/responses'", rule["Sql"])
        self.assertIn("floor(timestamp() / 1000) + 120 AS ttl", rule["Sql"])
        self.assertEqual(rule["Actions"][0]["DynamoDBv2"]["PutItem"], {"TableName": {"Ref": "ResponseTable"}})
        self.assertEqual(rule["AwsIotSqlVersion"], "2016-03-23")

    def test_roles_are_least_privilege(self):
        iot_stmt = self.resources["IotRuleRole"]["Properties"]["Policies"][0]["PolicyDocument"]["Statement"]
        self.assertEqual(iot_stmt, [{"Effect": "Allow", "Action": "dynamodb:PutItem", "Resource": {"GetAtt": "ResponseTable.Arn"}}])
        permission = self.resources["LambdaRole"]["Properties"]["Policies"][0]["PolicyDocument"]["Statement"]
        self.assertEqual(permission[0]["Action"], "iot:Publish")
        self.assertIn("topic/family-hq/v1/commands", permission[0]["Resource"]["Sub"])
        self.assertEqual(permission[1]["Action"], "dynamodb:GetItem")
        self.assertEqual(permission[1]["Resource"], {"GetAtt": "ResponseTable.Arn"})
        self.assertNotIn("dynamodb:Scan", str(permission))

    def test_lambda_is_private_and_timeout_bounded(self):
        props = self.resources["CommandLambda"]["Properties"]
        self.assertEqual(props["Timeout"], 8)
        self.assertEqual(props["Handler"], "lambda_handler.handler")
        self.assertEqual(props["Runtime"], "python3.12")
        self.assertIn("IOT_DATA_ENDPOINT", props["Environment"]["Variables"])
        self.assertIn("RESPONSE_TABLE", props["Environment"]["Variables"])


if __name__ == "__main__":
    unittest.main()
