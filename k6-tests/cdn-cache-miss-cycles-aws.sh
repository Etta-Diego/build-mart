#!/bin/bash
# CDN Performance Evaluation (rerun) - Experiment 2: CloudFront cache-MISS
# controlled cycles, measured from an AWS-hosted runner.
#
# Design: the actual timed HTTP request (the measurement) runs on the AWS
# EC2 runner via SSH, eliminating the residential-network confound from
# the previous run. The AWS control-plane calls (create-invalidation,
# wait-invalidation-completed) run locally, since their own timing is
# orchestration overhead, not part of the reported latency metric, and
# this avoids placing AWS credentials on the shared test runner.

export MSYS_NO_PATHCONV=1
DIST_ID="E1AILN8V2RAR97"
ASSET_PATH="/assets/index-B61W4Q95.css"
URL="https://d1iyf15c0shdw7.cloudfront.net${ASSET_PATH}"
N=25
OUT="k6-tests/results/cdn-evaluation/cdn-cache-miss-raw-aws.csv"
RUNNER="ubuntu@13.36.34.237"
KEY="c:/Users/NEW USER/aws-keys/buildmart-baseline-key.pem"

echo "cycle,invalidation_id,invalidation_wait_seconds,http_status,x_cache,latency_ms" > "$OUT"

for i in $(seq 1 $N); do
  INVAL_ID=$(aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "$ASSET_PATH" --query 'Invalidation.Id' --output text)
  WSTART=$(date +%s)
  aws cloudfront wait invalidation-completed --distribution-id "$DIST_ID" --id "$INVAL_ID"
  WEND=$(date +%s)
  WAITSEC=$((WEND-WSTART))

  # Timed request executed ON the AWS runner via SSH - this is the measurement.
  RESULT=$(ssh -i "$KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$RUNNER" \
    "curl -s -D /tmp/cdn_miss_headers.txt -o /dev/null --max-time 15 -w '%{http_code} %{time_total}' '$URL'; echo; grep -i '^x-cache:' /tmp/cdn_miss_headers.txt | tr -d '\r'")

  STATUS=$(echo "$RESULT" | sed -n '1p' | awk '{print $1}')
  TIME_S=$(echo "$RESULT" | sed -n '1p' | awk '{print $2}')
  XCACHE=$(echo "$RESULT" | sed -n '2p' | sed 's/.*: //')
  if [ -z "$TIME_S" ]; then
    LATENCY_MS=0
  else
    LATENCY_MS=$(node -e "console.log(Math.round(parseFloat(process.argv[1])*1000))" "$TIME_S")
  fi

  echo "$i,$INVAL_ID,$WAITSEC,$STATUS,$XCACHE,$LATENCY_MS" >> "$OUT"
  echo "cycle $i: wait=${WAITSEC}s status=$STATUS x-cache=$XCACHE latency=${LATENCY_MS}ms"
done

echo "=== all $N cycles complete ==="
