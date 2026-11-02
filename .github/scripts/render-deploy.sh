#!/usr/bin/env bash
# Deploys one commit to a Render service and waits until it is live (plan, Phase 2 CI step 5).
#   RENDER_API_KEY=… render-deploy.sh <service-id> <commit-sha>
set -euo pipefail
service=$1 commit=$2
api=https://api.render.com/v1
auth=(-H "Authorization: Bearer $RENDER_API_KEY" -H "content-type: application/json")

# Fails with Render's own error body rather than an unrelated JSON traceback.
render() {
  local body
  if ! body=$(curl -sS --fail-with-body "${auth[@]}" "$@"); then
    echo "::error::Render API request failed: $body" >&2; return 1
  fi
  printf '%s' "$body"
}

started=$(render -X POST -d "{\"commitId\":\"$commit\",\"clearCache\":\"do_not_clear\"}" "$api/services/$service/deploys")
deploy=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<<"$started")
echo "deploy $deploy of $commit started"

for _ in $(seq 120); do
  current=$(render "$api/services/$service/deploys/$deploy")
  status=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])' <<<"$current")
  case $status in
    live) echo "deploy $deploy is live"; exit 0 ;;
    *failed|canceled|deactivated) echo "::error::deploy $deploy ended as $status"; exit 1 ;;
  esac
  sleep 10
done
echo "::error::deploy $deploy not live after 20 minutes"; exit 1
