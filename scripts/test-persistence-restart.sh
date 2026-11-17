#!/usr/bin/env bash
# Restart-persistence proof (file driver, mock embeddings, zero paid calls):
#   start server -> upload + index -> kill server -> start again
#   -> /api/docs still lists the doc -> /api/query still grounds in it.
# On serverless the file driver's dir is /tmp (wiped on cold start); the same
# code path runs on the Neon driver where rows survive everything. This
# script proves the persistence mechanics themselves.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=3210
BASE="http://localhost:$PORT"
SESSION="persist-$(date +%s)"
export RAG_MOCK=1
export NEXT_PUBLIC_RAG_MOCK=1

start_server() {
  npx next dev -p $PORT >/tmp/persist-server.log 2>&1 &
  SERVER_PID=$!
  for i in $(seq 1 60); do
    curl -s -o /dev/null "$BASE/" && return 0
    sleep 1
  done
  echo "server did not start" >&2; exit 1
}
stop_server() { kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true; }
trap stop_server EXIT

echo "== boot 1: upload + index =="
start_server
UPLOAD=$(curl -s -F "sessionId=$SESSION" -F "file=@tests/fixtures/sample.txt" "$BASE/api/upload")
echo "upload: $UPLOAD"
URL=$(echo "$UPLOAD" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).url))")
EMBED=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SESSION\",\"docs\":[{\"url\":\"$URL\",\"name\":\"sample.txt\"}]}" "$BASE/api/embed")
echo "embed: $EMBED"
stop_server

echo "== boot 2: docs survive restart =="
start_server
DOCS=$(curl -s "$BASE/api/docs?session=$SESSION")
echo "docs: $DOCS"
echo "$DOCS" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(!j.docs||j.docs.length!==1||j.totalChunks<1){console.error('FAIL: doc did not survive restart');process.exit(1)}console.log('PASS: doc +',j.totalChunks,'chunks survived restart')})"

echo "== boot 2: query still grounds in the doc =="
ANSWER=$(curl -s -N -X POST -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SESSION\",\"query\":\"what is this document about?\",\"expectContext\":true}" "$BASE/api/query")
echo "$ANSWER" | grep -q '__SOURCES__' && echo "PASS: citations present after restart" || { echo "FAIL: no citations after restart"; echo "$ANSWER" | tail -5; exit 1; }
echo "$ANSWER" | grep -q 'sample.txt' && echo "PASS: citation names the doc" || { echo "FAIL: doc not cited"; exit 1; }

echo "== removal is real (DELETE then re-list) =="
curl -s -X DELETE "$BASE/api/docs?session=$SESSION&url=$(node -e "console.log(encodeURIComponent('$URL'))")" >/dev/null
DOCS2=$(curl -s "$BASE/api/docs?session=$SESSION")
echo "$DOCS2" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(j.docs.length!==0||j.totalChunks!==0){console.error('FAIL: doc not removed');process.exit(1)}console.log('PASS: doc + chunks removed')})"
echo "ALL RESTART-PERSISTENCE CHECKS PASSED"
