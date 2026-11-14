# Spend Passes

A workspace is the authenticated NEAR account's existing credit balance. A Spend Pass gives an agent bounded permission to consume those credits. It does not mint credit or transfer ownership of the treasury.

## Credentials and policy

- An **app API key** authenticates the caller. New passes issue a dedicated key, or permanently bind an existing active, unbound key belonging to the same workspace. The secret is returned once; only its hash is stored.
- A **Spend Pass** sets a total customer-charge budget, maximum customer charge per request, allowed tiers, optional model/provider restrictions, and an expiration. Amounts are micro-USD: `1000000 = $1` of application accounting credit.
- A **provider key** remains server-side. Gemini uses the operator-funded Google project. Provider expenses are offchain payables and can differ from customer charges.

Create and inspect passes in **Developer API → Spend Passes**. Budgets, spent, reserved, remaining, expiration, effective restrictions, request activity, blocked attempts and accounting commitments are visible there. Policies are immutable in v1: create a new pass to change limits. No daily sub-limit or automatic top-up is implemented.

## Owner API

These routes require the owner's authenticated session. Mutations require same-origin requests.

```http
POST /api/spend-passes
Content-Type: application/json

{
  "name": "Research allowance",
  "agentName": "Research agent",
  "totalBudget": "200000",
  "maxPerRequest": "50000",
  "allowedTiers": ["premium", "standard", "economy"],
  "allowedProviders": ["gemini"],
  "allowedModels": [],
  "expiresAt": "2026-11-21T12:00:00Z"
}
```

Use a future expiration when reproducing this example. Empty model/provider lists allow any configured model/provider that also satisfies the remaining restrictions. An optional `apiKeyId` binds an existing owned, unbound key instead of creating a new one.

- `GET /api/spend-passes`: list the owner's passes.
- `GET /api/spend-passes/:id`: policy, request activity and blocked attempts. Other workspaces receive 404.
- `DELETE /api/spend-passes/:id`: revoke permission for new reservations.

## Agent API

```bash
curl http://localhost:3002/api/v1/inference \
  -H "Authorization: Bearer $METABOLIC_AGENT_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: research-task-001" \
  -d '{"messages":[{"role":"user","content":"Explain what a spending limit is in one short sentence."}],"max_output_tokens":1024,"stream":true}'
```

The server resolves the pass from the authenticated key. A caller-supplied pass cannot replace or omit that binding. A database trigger prevents detaching or reassigning an already-bound key and prevents binding a key to another workspace's pass. Existing unbound API keys continue to use their existing workspace credits without a pass.

The shared inference service intersects pass restrictions with business policy, model capability and provider health. It filters candidates using the conservative **maximum customer charge**, rather than only the expected answer length. Input reservation uses UTF-8 length plus framing allowance; output is capped by the admitted request. Unexpected provider-reported overages cannot increase the customer/pass charge beyond the reservation and are flagged for the operator.

Credential, pass and credit reservation checks run in one transaction with row locks. Concurrent requests cannot reserve beyond the pass's unreserved total budget or the customer's available credits. The final actual charge and unused reservation release update the pass and customer balance together. Ledger revenue and provider expenses remain separate journal entries.

Revoked, expired or exhausted passes block new work. An already-admitted request, including an eligible fallback, can settle under the original reservation. Failover cannot increase that authorization. Known expenses from failed attempts are recorded separately; unknown expenses require operator reconciliation. A successful fallback may therefore still carry a reconciliation flag.

The caller receives `PASS_REVOKED`, `PASS_EXPIRED`, `PASS_EXHAUSTED`, `PASS_BUDGET`, `PASS_REQUEST_CAP`, `PASS_MODEL`, or `PASS_NO_MODEL` as applicable. Insufficient workspace credits return `INSUFFICIENT_CREDITS`. SSE requests carry these codes in an error event; nonstreaming requests return an appropriate 4xx status.

## Disconnects and restart recovery

Streaming transports keep consuming the inference generator after a client disconnect, cancel the provider request, and finish accounting. Execution is bounded to 90 seconds; persistent reservations have a three-minute lease. The worker reconciles expired leases once: it releases both reservations, marks the request refunded and flags unknown provider expense. It never replays an ambiguous paid request after a crash. Completed or recovered idempotency keys cannot execute a provider call twice.

Do not disable all workers in production without running one standalone worker. This version uses one web replica with the inline worker: rate limits, provider circuit breakers and SSE fan-out are in-process. Horizontal scaling needs shared rate limits/events and coordinated worker leadership.

## Reuse and additions

Reused: the current Metabolic AI ledger, balance reservations, NEP-413 authentication, provider adapters, economic policy, router, receipt commitment and Three.js scene. The legacy Algebra UI supplied conceptual approval terminology (`legacy-algebra/lib/pass-rules.ts`), but had no usable enforcement path in this app. Added here: persisted per-agent authorization, immutable credential binding, locked pass accounting, recovery and overage audit, owner UI/API, and the verified live testnet flow.
