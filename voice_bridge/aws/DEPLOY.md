# Family HQ — AWS command/response rendezvous

**Status:** Deployable infrastructure and Lambda code; AWS account provisioning and live validation are operator steps. **This does not deploy the Alexa skill**, modify NAS containers, or enable a public Lambda endpoint.

## Architecture

1. Private Lambda publishes a short-lived, uniquely identified command to `family-hq/v1/commands` using the AWS IoT data-plane endpoint in `us-east-1`.
2. Niaj's existing voice agent (outbound-only mTLS MQTT) handles the allowed `ping` and `list_chores` commands and replies to `family-hq/v1/responses`.
3. AWS IoT Rule `ResponseTopicRule` writes the reply to DynamoDB using DynamoDBv2; the rule adds a numeric `ttl` 120 seconds in the future, and DynamoDB TTL expires stale entries asynchronously.
4. The Lambda polls with **consistent reads** for the matching random request ID for up to 4.5 seconds, then returns a data-only result. It doesn't expose a public Function URL, Alexa trigger, or API Gateway.

CloudFormation creates only a DynamoDB response table, one IoT topic rule, the required narrow IAM roles, the Lambda, and its log group (7-day log retention). It does not recreate the already working IoT certificate, Thing, or NAS service.

## Prepare code artifact

Run these commands **on a trusted workstation with AWS CLI access** to the correct AWS account; the example is for `us-east-1`. An S3 artifact bucket is needed to hold the single-file Lambda ZIP. Use an existing *private, access-controlled* artifact bucket if you have one. If not, create a private bucket in the same region first. Do not place household secrets in the Lambda package.

```sh
export AWS_REGION=us-east-1
export ARTIFACT_BUCKET='REPLACE_WITH_PRIVATE_ARTIFACT_BUCKET'
export STACK_NAME=family-hq-voice

# Run from the repository root.
mkdir -p /tmp/family-hq-voice
(cd voice_bridge && zip -q /tmp/family-hq-voice/lambda.zip lambda_handler.py)
# A content-addressed S3 key forces CloudFormation to redeploy updated Lambda code.
REVISION="$(sha256sum /tmp/family-hq-voice/lambda.zip | cut -d' ' -f1)"
CODE_KEY="family-hq-voice/lambda-${REVISION}.zip"
aws s3 cp /tmp/family-hq-voice/lambda.zip "s3://${ARTIFACT_BUCKET}/${CODE_KEY}" --region "$AWS_REGION"

aws cloudformation validate-template \
  --region "$AWS_REGION" \
  --template-body file://voice_bridge/aws/response-stack.yaml

aws cloudformation deploy \
  --region "$AWS_REGION" \
  --stack-name "$STACK_NAME" \
  --capabilities CAPABILITY_IAM \
  --template-file voice_bridge/aws/response-stack.yaml \
  --parameter-overrides \
    LambdaCodeBucket="$ARTIFACT_BUCKET" \
    LambdaCodeKey="$CODE_KEY" \
    IotDataEndpoint=a1zj6ia2bckpg1-ats.iot.us-east-1.amazonaws.com
```

No S3 bucket is created by the stack; keep the Lambda deployment ZIP private. boto3 is supplied by the managed Python 3.12 Lambda runtime (no pip dependencies in the ZIP). Repackage and deploy again after changing `lambda_handler.py`.

## Validate the real AWS data path before Alexa

Confirm the CloudFormation stack reaches `CREATE_COMPLETE` or `UPDATE_COMPLETE`. Get the actual function and table names:

```sh
aws cloudformation describe-stacks --region us-east-1 --stack-name family-hq-voice \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' --output table
```

Using the `CommandLambdaName` output, invoke a ping and then the real read-only chore query:

```sh
export FUNCTION_NAME='REPLACE_WITH_CommandLambdaName_OUTPUT'
aws lambda invoke --region us-east-1 --function-name "$FUNCTION_NAME" \
  --cli-binary-format raw-in-base64-out \
  --payload '{"action":"ping","args":{}}' /tmp/family-hq-voice/ping.json
cat /tmp/family-hq-voice/ping.json

aws lambda invoke --region us-east-1 --function-name "$FUNCTION_NAME" \
  --cli-binary-format raw-in-base64-out \
  --payload '{"action":"list_chores","args":{"child":"Miller"}}' /tmp/family-hq-voice/chores.json
cat /tmp/family-hq-voice/chores.json
```

Expect `{"ok":true,"result":{"status":"ok"},"error":null}` for ping, and `ok: true` plus the actual chores for the second call. The Lambda result excludes the request ID; the matching ID is used internally as the DynamoDB partition key.

If a request times out, inspect the rule `ResponseTopicRule`, whether a matching item was written to the `ResponseTableName` table, whether the voice agent is healthy, and the CloudWatch Lambda errors. Do **not** log household chore payloads. The agent's `expires_at` window is eight seconds; a published command should never be retained. The rule requires AWS IoT SQL 2016-03-23 and a root-level string `id` in each reply. The table's `ttl` is a Unix **seconds** number; DynamoDB TTL removal is asynchronous, not an exact two-minute deletion deadline.

**Cost:** DynamoDB on-demand writes/reads, a small number of IoT rule executions, and Lambda requests/runtime. Expect low usage in a family environment, but actual AWS charges depend on region, account, consumption, and pricing; watch AWS Billing/Cost Explorer.

## Security and maintenance

- The Lambda has no public trigger or Alexa integration yet. Only trusted IAM principals who have permission to invoke it should use it. A future Alexa trigger must validate the expected skill ID and restrict Lambda's resource-based invocation permission to that skill.
- The Lambda role only publishes to `family-hq/v1/commands` and reads individual response items. AWS IoT's role only writes to the single response table. Neither is given broad access to IoT, DynamoDB, or the NAS.
- The voice agent's existing certificate must retain its existing topic-specific publish/subscribe policy; do not loosen it or expose the NAS HTTP port.
- DynamoDB TTL is **not** a strict privacy deletion deadline; items may linger until background deletion runs. For more aggressive retention, add explicit response deletion later with a narrowly scoped role.
- Keep the existing `/share/Family-HQ/run-release-check.sh` deployer and Container Station configuration reconciled; deploying this stack doesn't modify Niaj.
- The stored read-only chore results are sensitive household data: restrict DynamoDB and CloudWatch access accordingly, and avoid logging full responses.
- If the IoT Rule's IAM role is denied, check its `aws:SourceAccount`/`aws:SourceArn` trust conditions and the IoT Rule action role ARN; do not grant blanket DynamoDB access.
