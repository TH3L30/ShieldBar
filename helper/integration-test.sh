#!/usr/bin/env bash
set -euo pipefail

# Destructive test for the helper protocol. It only ever touches a dummy
# interface named sbtest0, never the runner's management interface.

if [[ "$(id -u)" -ne 0 ]]; then
  echo "must run as root (sudo)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
HELPER_PID=""
INTERFACE_CREATED=0

cleanup() {
  if [[ -n "$HELPER_PID" ]]; then
    kill "$HELPER_PID" 2>/dev/null || true
    wait "$HELPER_PID" 2>/dev/null || true
  fi
  if [[ "$INTERFACE_CREATED" -eq 1 ]]; then
    ip link del sbtest0 2>/dev/null || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

if ip link show sbtest0 >/dev/null 2>&1; then
  echo "sbtest0 already exists; refusing to touch it" >&2
  exit 1
fi

ip link add sbtest0 type dummy
INTERFACE_CREATED=1
ip link set sbtest0 up

cat >"$TMP/config.json" <<EOF
{"protocol":1,"allowedUid":0,"allowedGid":0,"socket":"$TMP/helper.sock","stateDir":"$TMP/state"}
EOF

CGO_ENABLED=0 go build -tags testmode -trimpath -o "$TMP/helper" "$ROOT"
SHIELDBAR_HELPER_CONFIG="$TMP/config.json" "$TMP/helper" serve >"$TMP/helper.log" 2>&1 &
HELPER_PID=$!

for _ in $(seq 1 30); do
  [[ -S "$TMP/helper.sock" ]] && break
  sleep 0.1
done
if [[ ! -S "$TMP/helper.sock" ]]; then
  echo "helper did not create its socket" >&2
  cat "$TMP/helper.log" >&2
  exit 1
fi

request() {
  python3 - "$TMP/helper.sock" "$1" <<'PY'
import json
import socket
import sys

path, command = sys.argv[1], sys.argv[2]
connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
connection.settimeout(5)
connection.connect(path)
connection.sendall((json.dumps({"command": command, "protocol": 1}) + "\n").encode())
data = b""
while b"\n" not in data:
    chunk = connection.recv(65536)
    if not chunk:
        break
    data += chunk
connection.close()
print(data.decode().strip())
PY
}

status="$(request status)"
echo "status: $status"
echo "$status" | grep -q '"triggered":false' || {
  echo "expected ready state" >&2
  exit 1
}
echo "$status" | grep -q 'sbtest0' || {
  echo "test interface missing from status" >&2
  exit 1
}

disabled="$(request disable)"
echo "disable: $disabled"
echo "$disabled" | grep -q '"triggered":true' || {
  echo "disable did not report triggered" >&2
  exit 1
}

if ip -o link show sbtest0 | grep -q '<[^>]*UP'; then
  echo "sbtest0 is still up after disable" >&2
  exit 1
fi

triggered="$(request status)"
echo "triggered status: $triggered"
echo "$triggered" | grep -q '"triggered":true' || {
  echo "status did not report triggered" >&2
  exit 1
}

restored="$(request restore)"
echo "restore: $restored"
echo "$restored" | grep -q '"triggered":false' || {
  echo "restore did not clear the triggered state" >&2
  exit 1
}

if ! ip -o link show sbtest0 | grep -q '<[^>]*UP'; then
  echo "sbtest0 was not restored" >&2
  exit 1
fi

echo "PASS: helper disabled and restored only the test interface."
