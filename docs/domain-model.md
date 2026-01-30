# Domain model

Sapience models high-level business intents that flow through events:
- Purchase order requested -> integration creates PO -> procurement updates status.
- Low stock detected -> orchestration triggers procurement request.
- Invoice review requested -> finance projects accruals.
