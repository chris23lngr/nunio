#!/usr/bin/env bash
# Spike c measurements against a deployed API (results and procedure: docs/operations/spike-results.md).
#   spike-c-measure.sh health   first /health request, then 10 more
#   spike-c-measure.sh session  first get-session request (signed-in cookie), then 10 more
#   spike-c-measure.sh pool     bursts of get-session; per instance, the pool counts each one reported
# "server ms" is time to first byte after the TLS handshake (starttransfer - appconnect), so it
# excludes DNS and TLS setup on the client side. Whether "first" is a cold start depends on what
# happened before the run (idle, fresh deployment, suspended Neon compute); the script can't tell.
set -euo pipefail
API=${API:-https://api.staging.nunio.app}
APP=${APP:-https://app.staging.nunio.app}
JAR=$(mktemp)
HEADERS=$(mktemp -d)
trap 'rm -rf "$JAR" "$HEADERS"' EXIT

timed() { # timed <label> <path> [curl args...]
  local label=$1 path=$2; shift 2
  curl -s -o /dev/null -D - "$@" -w '%{http_code} %{time_appconnect} %{time_starttransfer}\n' \
    "$API$path" | awk -v label="$label" '
      tolower($1) == "x-vercel-id:" { id = $2 }
      /^[0-9]{3} / { printf "%-6s %s  server %4.0f ms  total %4.0f ms  %s\n", label, $1, ($3 - $2) * 1000, $3 * 1000, id }'
}

sign_up() {
  curl -s -o /dev/null -c "$JAR" -H "origin: $APP" -H 'content-type: application/json' \
    --data "{\"name\":\"spike-c\",\"email\":\"spike-c+$(date +%s)-$RANDOM@example.com\",\"password\":\"correct horse battery staple\"}" \
    "$API/api/auth/sign-up/email"
}

session_headers() { # session_headers <file>: one get-session call, keeping its response headers
  curl -s -o /dev/null -D "$1" -b "$JAR" "$API/api/auth/get-session"
}

# Per instance: requests served, highest pool total after a request, and the counts before its first one.
summarise() {
  awk '
    function flush() {
      if (inst == "") return
      n[inst]++; if (after > max[inst]) max[inst] = after; if (!(inst in first)) first[inst] = before
      inst = ""
    }
    FNR == 1 { flush() }
    { sub(/\r$/, "") }
    tolower($1) == "x-spike-instance:" { inst = substr($2, 1, 8) }
    tolower($1) == "x-spike-pool-before:" { before = $2 " " $3 " " $4 }
    tolower($1) == "x-spike-pool:" { split($2, t, "="); after = t[2] + 0 }
    END {
      flush()
      for (i in n) printf "  %s  requests %3d  max total %d  first before: %s\n", i, n[i], max[i], first[i]
    }' "$HEADERS"/*
  rm -f "$HEADERS"/*
}

case ${1:-} in
  health)
    timed first /health
    for _ in $(seq 10); do timed warm /health; done ;;
  session)
    # Sign-up itself hits the database, so for a first-request reading start from an existing cookie jar.
    if [[ -n ${COOKIE_JAR:-} ]]; then cp "$COOKIE_JAR" "$JAR"; else sign_up; fi
    timed first /api/auth/get-session -b "$JAR"
    for _ in $(seq 10); do timed warm /api/auth/get-session -b "$JAR"; done ;;
  pool)
    sign_up
    for i in $(seq 30); do session_headers "$HEADERS/$(printf %03d "$i")"; done
    echo "30 sequential:"; summarise
    for i in $(seq 20); do session_headers "$HEADERS/$(printf %03d "$i")" & done; wait
    echo "20 parallel:"; summarise
    for r in 1 2 3; do for i in $(seq 20); do session_headers "$HEADERS/$r-$(printf %03d "$i")" & done; wait; done
    echo "3 x 20 parallel:"; summarise
    sleep 7
    for i in $(seq 10); do session_headers "$HEADERS/$(printf %03d "$i")"; done
    echo "10 sequential after 7 s idle (before total=0 means the pool had drained):"; summarise ;;
  *) echo "usage: $0 health|session|pool" >&2; exit 2 ;;
esac
