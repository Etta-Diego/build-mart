#!/bin/bash
# CDN Performance Evaluation - Experiment 2: CloudFront cache-MISS controlled cycles.
# A sustained miss cannot exist for identical requests (the first miss
# immediately repopulates the edge cache), so this measures N independent,
# controlled miss events instead: invalidate -> wait for completion ->
# single timed request -> confirm genuine Miss -> record latency.
#
# Target asset: /assets/index-B61W4Q95.css (representative static frontend
# asset, same one used to verify the invalidation mechanism). A single
# asset was used rather than all four to keep total invalidation-wait time
# practical (~25-30s propagation per cycle, confirmed empirically).

export MSYS_NO_PATHCONV=1
DIST_ID="E1AILN8V2RAR97"
ASSET_PATH="/assets/index-B61W4Q95.css"
URL="https://d1iyf15c0shdw7.cloudfront.net${ASSET_PATH}"
N=25
OUT="k6-tests/results/cdn-evaluation/cdn-cache-miss-raw.csv"
HEADERS_FILE="k6-tests/results/cdn-evaluation/.miss-headers-tmp.txt"

echo "cycle,invalidation_id,invalidation_wait_seconds,http_status,x_cache,latency_ms" > "$OUT"

for i in $(seq 1 $N); do
  INVAL_ID=$(aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "$ASSET_PATH" --query 'Invalidation.Id' --output text)
  WSTART=$(date +%s)
  aws cloudfront wait invalidation-completed --distribution-id "$DIST_ID" --id "$INVAL_ID"
  WEND=$(date +%s)
  WAITSEC=$((WEND-WSTART))

  RESP=$(curl -s -D "$HEADERS_FILE" -o /dev/null --max-time 15 -w "%{http_code} %{time_total}" "$URL")
  STATUS=$(echo "$RESP" | awk '{print $1}')
  TIME_S=$(echo "$RESP" | awk '{print $2}')
  LATENCY_MS=$(node -e "console.log(Math.round(parseFloat(process.argv[1])*1000))" "$TIME_S")
  XCACHE=$(grep -i "^x-cache:" "$HEADERS_FILE" | tr -d '\r' | sed 's/.*: //')

  echo "$i,$INVAL_ID,$WAITSEC,$STATUS,$XCACHE,$LATENCY_MS" >> "$OUT"
  echo "cycle $i: wait=${WAITSEC}s status=$STATUS x-cache=$XCACHE latency=${LATENCY_MS}ms"
done

echo "=== all $N cycles complete ==="
