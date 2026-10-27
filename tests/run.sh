#!/usr/bin/env bash
# Plain-bash test runner. Every test_* function runs in a subshell with a throwaway HOME.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
export REPO

assert_eq()       { [ "$1" = "$2" ] || { echo "expected [$2] got [$1]" >&2; return 1; }; }
assert_contains() { case "$1" in *"$2"*) ;; *) echo "missing [$2] in: $1" >&2; return 1 ;; esac; }
assert_absent()   { case "$1" in *"$2"*) echo "unexpected [$2] in: $1" >&2; return 1 ;; esac; }
export -f assert_eq assert_contains assert_absent 2>/dev/null || true

for f in "$REPO"/tests/t_*.sh; do
  # shellcheck disable=SC1090
  . "$f"
done

pass=0 fail=0
for t in $(compgen -A function test_); do
  home="$(mktemp -d)"
  log="$home.log"
  set +e
  ( set -e; export HOME="$home"; cd "$REPO"; "$t" ) >"$log" 2>&1
  rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then echo "PASS $t"; pass=$((pass + 1))
  else echo "FAIL $t"; sed 's/^/    /' "$log"; fail=$((fail + 1)); fi
  rm -rf "$home" "$log"
done
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
