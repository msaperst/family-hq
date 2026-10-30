# Family HQ voice bridge — read-only proof of concept

**Status:** prototype, not production. No AWS infrastructure is automatically provisioned and no Alexa skill has been published. This is a separate bridge service; Family HQ remains LAN-only.

## Architecture

Alexa (later) → Lambda → AWS IoT Core command publish → NAS agent (outbound mTLS MQTT) → local Family HQ HTTP API → AWS IoT Core response publish → IoT Rule → DynamoDB → waiting Lambda.

Lambda has a short response deadline; there is no inbound traffic to the NAS. The bridge intentionally supports only `ping` and `list_chores`. No write actions or arbitrary commands are accepted.

## AWS setup (us-east-1 suggested)

1. Create an AWS IoT Thing and X.509 certificate, attach a restrictive IoT policy and download the private key safely **outside this repository**. Use the AWS account's ATS IoT data endpoint.
2. Create a DynamoDB table with partition key `id` (String), on-demand billing, TTL attribute `ttl`. Configure an AWS IoT SQL rule for topic `family-hq/v1/responses` to put the response in that table, including `id`, `ok`, `result`, `error`, and TTL. Ensure field types match what Lambda reads. Note: the IoT rule needs an IAM role permitted to write to this table.
3. Create a Python Lambda function with `lambda_handler.handler` from this folder, and environment variables `IOT_DATA_ENDPOINT` and `RESPONSE_TABLE`. Grant only `iot:Publish` on `family-hq/v1/commands` and `dynamodb:GetItem` for this table. The code uses standard AWS-provided boto3; verify runtime version.
4. Invoke Lambda with `{"action":"ping","args":{}}` to measure latency.
5. Build/run the agent container on a LAN host, mounting its private certificate and key **read-only**. Provide `IOT_ENDPOINT`, `IOT_CERT_PATH`, `IOT_KEY_PATH`, `IOT_CLIENT_ID`, and `FAMILY_HQ_URL`. The last must be a trusted LAN-only address; no public QNAP URL or reverse proxy is required.

**Important:** AWS IoT Rules and DynamoDB item serialization must be validated in a real AWS account before the end-to-end test will work. The rule is not provisioned by this branch. To simplify the first ping experiment, inspect the agent response in the IoT MQTT test client before wiring DynamoDB.

### IoT policy scope

The NAS certificate should permit:
- `iot:Connect` only for the assigned MQTT client ID;
- `iot:Subscribe` and `iot:Receive` only for `family-hq/v1/commands`;
- `iot:Publish` only for `family-hq/v1/responses`.

Avoid wildcard topic permissions. Commands must have unique UUID-hex IDs, a maximum six-to-ten-second expiry window, and QoS 0 on the Lambda publish (never retained). For a future write API, implement durable idempotency before allowing any completion action.

### Verify locally

```bash
cd voice_bridge
python3 -m unittest discover -s tests -v
```

Lambda test dependencies require `boto3` in your development environment. The NAS agent needs `awsiotsdk` from requirements.txt. Do **not** commit certificates or AWS credentials.

### Current limitations / next steps

- No deployed or provisioned AWS resources yet.
- The basic read-only chore list uses only already-visible due and overdue chores for a named child. It does not yet resolve ambiguous names, shared chores, or all history/reporting cases.
- Error responses are deliberately generic. Lambda and NAS logs must not contain household chore details.
- Add an infrastructure-as-code template for the IoT rule, certificate policy, DynamoDB TTL, and Lambda roles before production.
- A private Alexa skill with explicit account/skill validation and utterance mapping is the *next* phase once latency and transport are demonstrated.
