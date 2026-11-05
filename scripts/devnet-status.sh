#!/usr/bin/env bash
# One line per node: reachable or not, with its height. Read-only.
for p in 19080 19081 19082 19083; do
  out=$(curl -fsS --max-time 2 "http://127.0.0.1:$p/api/status" 2>/dev/null) && echo "$p: $(echo "$out" | sed -n 's/.*"height":\([0-9]*\).*/height \1/p')" || echo "$p: no answer"
done
