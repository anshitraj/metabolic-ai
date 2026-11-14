# metabolic — NEAR contract

Minimal, auditable treasury contract for Metabolic AI.

| Method | Who | What |
|---|---|---|
| `new(owner, max_withdrawal?, receipt_signer?)` | init | Owner is a receipt signer; an optional separate receipt signer can be installed at deployment. Default withdrawal cap 10 NEAR. |
| `deposit(memo?)` *payable* | anyone | ≥ 0.01 NEAR. Tracks per-account totals, emits NEP-297 `deposit`. |
| `commit_receipt(id, hash_hex, interval_start, interval_end, policy_version)` | signers | Stores a 64-char lowercase SHA-256. Unique ids, immutable. Emits `receipt_committed`. |
| `get_receipt(id)` / `verify_receipt(id, hash_hex)` / `receipt_count()` | view | Anyone can check a commitment. |
| `deposits_of(account_id)` | view | Total deposited by an account. |
| `add_signer` / `remove_signer` / `signers()` | owner / view | Manage who may commit receipts. |
| `set_paused(bool)` / `is_paused()` | owner / view | Emergency pause blocks deposits, receipts and withdrawals. |
| `withdraw_operating(amount, to)` | owner | Capped, logged transfer of operating funds (e.g. to pay provider bills). |

Events follow NEP-297: `EVENT_JSON:{"standard":"metabolic","version":"1.0.0","event":"…","data":[…]}`.

The contract does **not** know about customer credit balances — those are liabilities in the app's double-entry ledger. On-chain, a receipt proves that a hash of the books was committed at a given time; it does not prove that an AI provider was paid.

## Build and test

```bash
cargo test
cargo build --target wasm32-unknown-unknown --release
```

The crate declares `rust-version = 1.92` and `.cargo/config.toml` enables Cargo's MSRV-aware resolver, so it builds on Rust 1.92 by picking compatible `near-sdk` releases. With Rust ≥ 1.95 you can also use `cargo near build` for a reproducible, ABI-embedded build.

## Deploy to testnet

Requires [near-cli-rs](https://github.com/near/near-cli-rs) and a funded testnet account (`you.testnet`).

```bash
# 1. Create a sub-account for the contract and fund it
near account create-account fund-myself metabolic.you.testnet '5 NEAR' autogenerate-new-keypair save-to-keychain sign-as you.testnet network-config testnet sign-with-keychain send

# 2. Deploy and initialise (owner = you)
near contract deploy metabolic.you.testnet use-file target/wasm32-unknown-unknown/release/metabolic.wasm with-init-call new json-args '{"owner":"you.testnet"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send

# 3. Create a function-call key the server uses ONLY for commit_receipt
near account add-key metabolic.you.testnet grant-function-call-access --allowance '1 NEAR' --contract-account-id metabolic.you.testnet --function-names commit_receipt autogenerate-new-keypair print-to-terminal network-config testnet sign-with-keychain send
#    → copy the printed private key (ed25519:…) into NEAR_RECEIPT_SIGNER_KEY

# 4. That key belongs to the contract account, so make the contract account a receipt signer
#    (only the owner is a signer after init):
near contract call-function as-transaction metabolic.you.testnet add_signer json-args '{"account_id":"metabolic.you.testnet"}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as you.testnet network-config testnet sign-with-keychain send
```

Then in `frontend/.env.local`:

```
NEAR_CONTRACT_ID=metabolic.you.testnet
NEAR_RECEIPT_SIGNER_ID=metabolic.you.testnet
NEAR_RECEIPT_SIGNER_KEY=ed25519:…        # the function-call key from step 3
OPERATOR_ACCOUNT_IDS=you.testnet
```

Restart the app. Deposits now call `deposit()` on the contract, the worker commits a receipt every `RECEIPT_INTERVAL_MIN` minutes when there was activity, and `/verify` checks receipts against `get_receipt`.

The function-call key can only call `commit_receipt` on this contract and only spend its gas allowance, so a leaked key cannot move funds.

For the verified automated testnet deployment, `new` received `owner: "solrishu.testnet"` and a separate receipt signer equal to the fresh contract account. This lets a newly created faucet-funded deployment initialize the owner's public account and a restricted receipt key without accessing the owner's private key. See [the verification report](../../docs/10-DEPLOYMENT-VERIFICATION.md) for actual transaction evidence and the test-only wallet limitations.
