#!/usr/bin/env bash
# Spike c measurements against a deployed API (results: docs/operations/spike-results.md).
#   spike-c-measure.sh health   first /health request, then 10 more
#   spike-c-measure.sh session  first get-session request (signed-in cookie), then 10 more
#   spike-c-measure.sh pool     bursts of get-session, reading /spike/pool between them
# "server ms" is time to first byte after the TLS handshake (starttransfer - appconnect), so it
# excludes DNS and TLS setup on the client side. Run health/session after the API has been idle.
set -euo pipefail
API=${API:-https://api.staging.nunio.app}
APP=${APP:-https://app.staging.nunio.app}
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

timed() { # timed <label> <path> [curl args...]
  local label=$1 path=$2; shift 2
  curl -s -o /dev/null -D - "$@" -w '%{http_code} %{time_appconnect} %{time_starttransfer}\n' \
    "$API$path" | awk -v label="$label" '
      tolower($1) == "x-vercel-id:" { id = $2 }
      /^[0-9]{3} / { printf "%-8s %s  server %4.0f ms  total %4.0f ms  %s\n", label, $1, ($3 - $2) * 1000, $3 * 1000, id }'
}

sign_up() {
  curl -s -o /dev/null -c "$JAR" -H "origin: $APP" -H 'content-type: application/json' \
    --data "{\"name\":\"spike-c\",\"email\":\"spike-c+$(date +%s%N)@example.com\",\"password\":\"correct horse battery staple\"}" \
    "$API/api/auth/sign-up/email"
}

pool() { curl -s "$API/spike/pool"; echo; }

case ${1:-} in
  health)
    timed cold /health
    for _ in $(seq 10); do timed warm /health; done ;;
  session)
    # Sign-up itself hits the database, so for a cold reading start from an existing cookie jar.
    if [[ -n ${COOKIE_JAR:-} ]]; then cp "$COOKIE_JAR" "$JAR"; else sign_up; fi
    timed cold /api/auth/get-session -b "$JAR"
    for _ in $(seq 10); do timed warm /api/auth/get-session -b "$JAR"; done ;;
  pool)
    sign_up
    echo "before:        $(pool)"
    for _ in $(seq 30); do curl -s -o /dev/null -b "$JAR" "$API/api/auth/get-session"; done
    echo "after 30 seq:  $(pool)"
    for _ in $(seq 20); do curl -s -o /dev/null -b "$JAR" "$API/api/auth/get-session" & done; wait
    echo "after 20 par:  $(pool)"
    for _ in $(seq 3); do
      for _ in $(seq 20); do curl -s -o /dev/null -b "$JAR" "$API/api/auth/get-session" & done; wait
    done
    echo "after 3x20 par: $(pool)"
    sleep 7
    echo "after 7 s idle: $(pool)" ;;
  *) echo "usage: $0 health|session|pool" >&2; exit 2 ;;
esac
