#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# Regression check for the state helpers in files/usr/bin/notifip.
#   sh tests/state.sh
#
# The functions are pulled straight out of the worker, so the test cannot
# drift from the implementation.

set -e

WORKER="${1:-$(dirname "$0")/../files/usr/bin/notifip}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

STATE_FILE="$TMP/state"
eval "$(sed -n '/^state_get()/,/^}/p; /^state_set()/,/^}/p; /^prune_state()/,/^}/p' "$WORKER")"

fail() { echo "FAIL: $1"; exit 1; }
ino()  { ls -i "$STATE_FILE" | awk '{print $1}'; }

printf 'public\t1.2.3.4\t2026-01-01T00:00:00\niface:wan\t10.0.0.1\t2026-01-01T00:00:00\n' \
	> "$STATE_FILE"

# --- state_get
[ "$(state_get public)" = "1.2.3.4" ]    || fail "state_get public"
[ "$(state_get iface:wan)" = "10.0.0.1" ] || fail "state_get iface:wan"
[ -z "$(state_get nope)" ]                || fail "state_get unknown key"

# --- prune_state must NOT rewrite the file when nothing changes.
# It runs on every cron tick and the state lives on the flash overlay; a
# rewrite means an inode swap via mv, which is exactly what we check.
before=$(ino)
prune_state "public iface:wan"
[ "$(ino)" = "$before" ] || fail "prune_state rewrote an unchanged state file"

# --- prune_state drops rows that no longer match the configured mode
prune_state "public"
if grep -q '^iface:wan' "$STATE_FILE"; then fail "prune_state kept a stale row"; fi
[ "$(state_get public)" = "1.2.3.4" ] || fail "prune_state dropped a live row"

# --- pruning everything leaves an empty file, not a stray blank line
prune_state ""
[ ! -s "$STATE_FILE" ] || fail "prune_state left content behind"

# --- state_set appends an unknown key, then updates it in place
state_set public 5.6.7.8
[ "$(state_get public)" = "5.6.7.8" ] || fail "state_set append"
state_set public 9.9.9.9
[ "$(state_get public)" = "9.9.9.9" ] || fail "state_set update"
[ "$(wc -l < "$STATE_FILE")" -eq 1 ]  || fail "state_set duplicated the key"

echo "PASS"
