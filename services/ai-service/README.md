# AI Service

## Purpose
Provides a deterministic assistant that maps text into tool calls compatible with the API gateway intent endpoint.

## Inputs/Outputs
- Inputs: JSON payload `{ "text": "..." }`.
- Outputs: `{ "plan": string, "tool_calls": [...] }`.

## Example
```bash
curl -s -X POST http://localhost:8000/v1/assist \
  -H 'content-type: application/json' \
  -d '{"text":"check inventory for laptop"}'
```

## Self-check
```bash
python -m pytest services/ai-service/tests
```
