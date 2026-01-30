# Policy replay engine

Purpose: Replay stored intent decisions against a candidate policy without executing downstream actions. Inputs are stored intents + policy decisions, a candidate policy (current/path/inline), and optional filters; outputs are persisted replay runs, replay results, and summary diffs.

Example command:
```bash
curl -s -X POST http://localhost:3000/v1/policy/replay \
  -H 'content-type: application/json' \
  -d '{"candidatePolicy":{"source":"current"},"filters":{"limit":50}}' | jq
```

Self-check:
```bash
curl -s http://localhost:3000/v1/policy/replay/RUN_ID | jq
```
