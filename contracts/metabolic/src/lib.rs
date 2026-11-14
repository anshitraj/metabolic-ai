//! Metabolic AI treasury contract.
//!
//! Deliberately small and auditable:
//! - `deposit` accepts NEAR, attributes it to the caller and emits a NEP-297 event.
//! - `commit_receipt` stores the hash of an off-chain economic receipt. Only
//!   authorised signers may call it, ids are unique, and commitments are immutable.
//! - `get_receipt` / `verify_receipt` let anyone check a commitment.
//! - The owner manages signers, can pause, and can make capped, logged
//!   withdrawals of operating funds (never customer-attributed balances by itself:
//!   the off-chain ledger is the source of truth for liabilities).

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

const EVENT_STANDARD: &str = "metabolic";
const EVENT_VERSION: &str = "1.0.0";
/// 0.01 NEAR minimum deposit.
const MIN_DEPOSIT: u128 = 10_000_000_000_000_000_000_000;

#[derive(BorshStorageKey, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
enum Key {
    Signers,
    Receipts,
    Deposits,
}

#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct ReceiptCommitment {
    pub hash_hex: String,
    pub interval_start: u64,
    pub interval_end: u64,
    pub policy_version: u32,
    pub committed_at_ns: U64Str,
    pub committed_by: AccountId,
}

/// u64 serialised as a JSON string (JS-safe).
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct U64Str(#[serde(with = "u64_string")] pub u64);

mod u64_string {
    use near_sdk::serde::{de, Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        let s = String::deserialize(d)?;
        s.parse().map_err(de::Error::custom)
    }
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Metabolic {
    owner: AccountId,
    signers: IterableSet<AccountId>,
    receipts: LookupMap<String, ReceiptCommitment>,
    deposits_total: LookupMap<AccountId, u128>,
    receipt_count: u64,
    paused: bool,
    /// Upper bound for a single owner withdrawal, in yocto.
    max_withdrawal: u128,
}

fn emit(event: &str, data: String) {
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"{EVENT_STANDARD}\",\"version\":\"{EVENT_VERSION}\",\"event\":\"{event}\",\"data\":[{data}]}}"
    ));
}

fn json_str(s: &str) -> String {
    near_sdk::serde_json::to_string(s).unwrap()
}

#[near]
impl Metabolic {
    #[init]
    pub fn new(owner: AccountId, max_withdrawal: Option<U128>, receipt_signer: Option<AccountId>) -> Self {
        let mut signers = IterableSet::new(Key::Signers);
        signers.insert(owner.clone());
        if let Some(signer) = receipt_signer { signers.insert(signer); }
        Self {
            owner,
            signers,
            receipts: LookupMap::new(Key::Receipts),
            deposits_total: LookupMap::new(Key::Deposits),
            receipt_count: 0,
            paused: false,
            max_withdrawal: max_withdrawal.map(|v| v.0).unwrap_or(10 * 10u128.pow(24)),
        }
    }

    // ------------------------------------------------------------------ deposits

    /// Deposit NEAR into the treasury. `memo` links the deposit to an off-chain intent.
    #[payable]
    pub fn deposit(&mut self, memo: Option<String>) {
        require!(!self.paused, "Contract is paused");
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount >= MIN_DEPOSIT, "Minimum deposit is 0.01 NEAR");
        if let Some(m) = &memo {
            require!(m.len() <= 64, "Memo too long");
        }
        let account = env::predecessor_account_id();
        let total = self.deposits_total.get(&account).copied().unwrap_or(0) + amount;
        self.deposits_total.insert(account.clone(), total);
        emit(
            "deposit",
            format!(
                "{{\"account_id\":{},\"amount\":\"{}\",\"memo\":{}}}",
                json_str(account.as_str()),
                amount,
                memo.as_deref().map(json_str).unwrap_or_else(|| "null".into())
            ),
        );
    }

    pub fn deposits_of(&self, account_id: AccountId) -> U128 {
        U128(self.deposits_total.get(&account_id).copied().unwrap_or(0))
    }

    // ------------------------------------------------------------------ receipts

    /// Commit the hash of an economic receipt. Signer-only, unique id, immutable.
    pub fn commit_receipt(&mut self, id: String, hash_hex: String, interval_start: u64, interval_end: u64, policy_version: u32) {
        require!(!self.paused, "Contract is paused");
        let caller = env::predecessor_account_id();
        require!(self.signers.contains(&caller), "Not an authorised receipt signer");
        require!(!id.is_empty() && id.len() <= 64, "Invalid receipt id");
        require!(hash_hex.len() == 64 && hash_hex.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()), "hash_hex must be 64 lowercase hex chars");
        require!(interval_end >= interval_start, "Invalid interval");
        require!(self.receipts.get(&id).is_none(), "Receipt id already committed");
        let commitment = ReceiptCommitment {
            hash_hex: hash_hex.clone(),
            interval_start,
            interval_end,
            policy_version,
            committed_at_ns: U64Str(env::block_timestamp()),
            committed_by: caller.clone(),
        };
        self.receipts.insert(id.clone(), commitment);
        self.receipt_count += 1;
        emit(
            "receipt_committed",
            format!(
                "{{\"id\":{},\"hash_hex\":{},\"interval_start\":{},\"interval_end\":{},\"policy_version\":{},\"signer\":{}}}",
                json_str(&id),
                json_str(&hash_hex),
                interval_start,
                interval_end,
                policy_version,
                json_str(caller.as_str())
            ),
        );
    }

    pub fn get_receipt(&self, id: String) -> Option<ReceiptCommitment> {
        self.receipts.get(&id).cloned()
    }

    pub fn verify_receipt(&self, id: String, hash_hex: String) -> bool {
        self.receipts.get(&id).map(|r| r.hash_hex == hash_hex).unwrap_or(false)
    }

    pub fn receipt_count(&self) -> u64 {
        self.receipt_count
    }

    // ------------------------------------------------------------------ admin

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Owner only");
    }

    pub fn add_signer(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.signers.insert(account_id.clone());
        emit("signer_added", format!("{{\"account_id\":{}}}", json_str(account_id.as_str())));
    }

    pub fn remove_signer(&mut self, account_id: AccountId) {
        self.assert_owner();
        self.signers.remove(&account_id);
        emit("signer_removed", format!("{{\"account_id\":{}}}", json_str(account_id.as_str())));
    }

    pub fn signers(&self) -> Vec<AccountId> {
        self.signers.iter().cloned().collect()
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.assert_owner();
        self.paused = paused;
        emit("paused", format!("{{\"paused\":{paused}}}"));
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    /// Owner-only, capped withdrawal of operating funds (e.g. to pay provider bills).
    /// Logged on chain; the off-chain ledger records the matching entry.
    pub fn withdraw_operating(&mut self, amount: U128, to: AccountId) -> Promise {
        self.assert_owner();
        require!(!self.paused, "Contract is paused");
        require!(amount.0 > 0 && amount.0 <= self.max_withdrawal, "Amount exceeds the per-withdrawal cap");
        let available = env::account_balance().as_yoctonear().saturating_sub(env::storage_byte_cost().as_yoctonear() * env::storage_usage() as u128);
        require!(amount.0 <= available, "Insufficient unlocked balance");
        emit("withdrawal", format!("{{\"to\":{},\"amount\":\"{}\"}}", json_str(to.as_str()), amount.0));
        Promise::new(to).transfer(NearToken::from_yoctonear(amount.0))
    }

    pub fn owner(&self) -> AccountId {
        self.owner.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    fn acct(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(predecessor: &str, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(acct(predecessor)).attached_deposit(NearToken::from_yoctonear(deposit)).account_balance(NearToken::from_near(100));
        testing_env!(b.build());
    }
    const HASH: &str = "9f3c1d2e4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff0";


    #[test]
    fn deployer_can_initialize_separate_owner_and_receipt_signer() {
        ctx("deployment.testnet", 0);
        let mut c = Metabolic::new(acct("owner.testnet"), None, Some(acct("deployment.testnet")));
        assert_eq!(c.owner(), acct("owner.testnet"));
        c.commit_receipt("rcpt_separate".into(), HASH.into(), 10, 20, 1);
        assert!(c.verify_receipt("rcpt_separate".into(), HASH.into()));
    }

    #[test]
    fn deposit_records_and_emits_event() {
        ctx("owner.testnet", 0);
        let mut c = Metabolic::new(acct("owner.testnet"), None, None);
        ctx("alice.testnet", 2 * 10u128.pow(24));
        c.deposit(Some("intent-1".into()));
        assert_eq!(c.deposits_of(acct("alice.testnet")).0, 2 * 10u128.pow(24));
        let logs = get_logs();
        assert!(logs[0].starts_with("EVENT_JSON:{\"standard\":\"metabolic\""));
        assert!(logs[0].contains("\"event\":\"deposit\""));
        assert!(logs[0].contains("\"memo\":\"intent-1\""));
    }

    #[test]
    #[should_panic(expected = "Minimum deposit is 0.01 NEAR")]
    fn deposit_requires_minimum() {
        ctx("owner.testnet", 0);
        let mut c = Metabolic::new(acct("owner.testnet"), None, None);
        ctx("alice.testnet", 1);
        c.deposit(None);
    }

    #[test]
    fn signer_commits_and_anyone_verifies() {
        ctx("owner.testnet", 0);
        let mut c = Metabolic::new(acct("owner.testnet"), None, None);
        c.add_signer(acct("signer.testnet"));
        ctx("signer.testnet", 0);
        c.commit_receipt("rcpt_1".into(), HASH.into(), 10, 20, 1);
        ctx("anyone.testnet", 0);
        assert!(c.verify_receipt("rcpt_1".into(), HASH.into()));
        assert!(!c.verify_receipt("rcpt_1".into(), HASH.replace('9', "8")));
        assert_eq!(c.get_receipt("rcpt_1".into()).unwrap().policy_version, 1);
        assert_eq!(c.receipt_count(), 1);
    }

    #[test]
    #[should_panic(expected = "Receipt id already committed")]
    fn duplicate_receipt_rejected() {
        ctx("owner.testnet", 0);
        let mut c = Metabolic::new(acct("owner.testnet"), None, None);
        c.commit_receipt("rcpt_1".into(), HASH.into(), 10, 20, 1);
        c.commit_receipt("rcpt_1".into(), HASH.into(), 10, 20, 1);
    }

    #[test]
    #[should_panic(expected = "Not an authorised receipt signer")]
    fn non_signer_cannot_commit() {
        ctx("owner.testnet", 0);
        let mut c = Metabolic::new(acct("owner.testnet"), None, None);
        ctx("mallory.testnet", 0);
        c.commit_receipt("rcpt_x".into(), HASH.into(), 1, 2, 1);
    }

    #[test]
    #[should_panic(expected = "Contract is paused")]
    fn paused_blocks_deposits() {
        ctx("owner.testnet", 0);
        let mut c = Metabolic::new(acct("owner.testnet"), None, None);
        c.set_paused(true);
        ctx("alice.testnet", 10u128.pow(24));
        c.deposit(None);
    }

    #[test]
    #[should_panic(expected = "Owner only")]
    fn only_owner_manages_signers() {
        ctx("owner.testnet", 0);
        let mut c = Metabolic::new(acct("owner.testnet"), None, None);
        ctx("mallory.testnet", 0);
        c.add_signer(acct("mallory.testnet"));
    }

    #[test]
    #[should_panic(expected = "Amount exceeds the per-withdrawal cap")]
    fn withdrawal_is_capped() {
        ctx("owner.testnet", 0);
        let mut c = Metabolic::new(acct("owner.testnet"), Some(U128(10u128.pow(24))), None);
        let _ = c.withdraw_operating(U128(2 * 10u128.pow(24)), acct("owner.testnet"));
    }
}
