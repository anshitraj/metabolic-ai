// Creates fresh faucet-funded test accounts. Never touches mainnet or an existing wallet key.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { KeyPair } from "@near-js/crypto";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators as actions } from "@near-js/transactions";

const RPC = "https://rpc.testnet.near.org";
const statePath = resolve(".data/testnet-deployment.json");
const owner = process.env.TESTNET_OWNER_ACCOUNT_ID || "solrishu.testnet";
if (!owner.endsWith(".testnet")) throw new Error("This setup script only accepts testnet owners.");
if (!process.argv.includes("--execute")) {
  console.log("Dry run: creates two fresh faucet accounts, deploys the contract owned by " + owner + ", and installs a receipt-only function-call key. Run with --execute to submit testnet transactions.");
  process.exit(0);
}
mkdirSync(resolve(".data"), { recursive: true });
let state;
if (existsSync(statePath)) state = JSON.parse(readFileSync(statePath, "utf8"));
else {
  const suffix = randomBytes(5).toString("hex");
  const make = (name) => { const key = KeyPair.fromRandom("ed25519"); return { accountId: `${name}-${suffix}.testnet`, publicKey: key.getPublicKey().toString(), secretKey: key.toString() }; };
  state = { network: "testnet", owner, contract: make("metabolic"), customer: make("metabolic-customer"), receipt: make("receipt"), transactions: {} };
  writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}
if (state.network !== "testnet" || state.owner !== owner) throw new Error("Saved testnet deployment belongs to another owner/network. Review the state file before continuing.");
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
const provider = new JsonRpcProvider({ url: RPC });
for (const item of [state.contract, state.customer]) {
  let present = false;
  try { await provider.query({ request_type: "view_account", finality: "final", account_id: item.accountId }); present = true; } catch { /* fresh account */ }
  if (!present) {
    const result = await fetch("https://helper.testnet.near.org/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newAccountId: item.accountId, newAccountPublicKey: item.publicKey }), signal: AbortSignal.timeout(45_000) });
    const text = await result.text();
    if (!result.ok) throw new Error(`Testnet faucet returned HTTP ${result.status}. No retry or bypass attempted. ${text.slice(0, 160)}`);
    item.faucetCreated = true; save();
    console.log("Created fresh testnet account: " + item.accountId);
  }
}
const account = new Account(state.contract.accountId, provider, KeyPairSigner.fromSecretKey(state.contract.secretKey));
if (!state.operator) {
  const key = KeyPair.fromRandom("ed25519");
  state.operator = { accountId: `operator.${state.contract.accountId}`, publicKey: key.getPublicKey().toString(), secretKey: key.toString() }; save();
}
let operatorExists = false;
try { await provider.query({ request_type: "view_account", finality: "final", account_id: state.operator.accountId }); operatorExists = true; } catch { /* new subaccount */ }
if (!operatorExists) {
  const created = await account.createSubAccount(state.operator.accountId, state.operator.publicKey, 1_000_000_000_000_000_000_000_000n);
  state.transactions.operatorAccount = created.transaction.hash; save();
}
const wasm = readFileSync(resolve("../contracts/metabolic/target/wasm32-unknown-unknown/release/metabolic.wasm"));
const wasmHash = createHash("sha256").update(wasm).digest("hex");
if (state.transactions.deploy && state.wasmSha256 !== wasmHash) throw new Error("The local contract binary changed after deployment. Review and explicitly plan an upgrade; this script will not overwrite the deployed contract.");
if (!state.transactions.deploy) {
  const result = await account.signAndSendTransaction({ receiverId: account.accountId, waitUntil: "FINAL", actions: [
    actions.deployContract(wasm),
    actions.functionCall("new", { owner, max_withdrawal: "1000000000000000000000000", receipt_signer: state.contract.accountId }, 50_000_000_000_000n, 0n),
    actions.addKey(KeyPair.fromString(state.receipt.secretKey).getPublicKey(), actions.functionCallAccessKey(state.contract.accountId, ["commit_receipt"], 200_000_000_000_000_000_000_000n)),
  ] });
  if (!result.status || typeof result.status !== "object" || !("SuccessValue" in result.status)) throw new Error("Contract deployment failed; inspect the transaction before retrying.");
  state.transactions.deploy = result.transaction.hash; state.wasmSha256 = wasmHash; save();
}
const view = async (method) => { const result = await provider.query({ request_type: "call_function", finality: "final", account_id: state.contract.accountId, method_name: method, args_base64: "e30=" }); return JSON.parse(Buffer.from(result.result).toString("utf8")); };
const observedOwner = await view("owner");
const signers = await view("signers");
if (observedOwner !== owner || !signers.includes(state.contract.accountId)) throw new Error("Contract owner or receipt signer differs from the expected configuration.");
const key = await provider.query({ request_type: "view_access_key", finality: "final", account_id: state.contract.accountId, public_key: state.receipt.publicKey });
const permission = key.permission?.FunctionCall;
if (!permission || permission.receiver_id !== state.contract.accountId || permission.method_names.length !== 1 || permission.method_names[0] !== "commit_receipt") throw new Error("Receipt key is not restricted to commit_receipt.");
// Keep generated credentials under ignored .data; runtime receives only the restricted receipt key.
const env = ["NEAR_NETWORK=testnet", `NEAR_RPC_URL=${RPC}`, `NEAR_CONTRACT_ID=${state.contract.accountId}`, `NEAR_RECEIPT_SIGNER_ID=${state.contract.accountId}`, `NEAR_RECEIPT_SIGNER_KEY=${state.receipt.secretKey}`, `OPERATOR_ACCOUNT_IDS=${owner},${state.operator.accountId}`, "PGLITE_DIR=.data/testnet-verified", "PUBLIC_WEB_URL=http://localhost:3002", "WORKER_INLINE=true", "NEXT_DIST_DIR=.next-testnet-demo"].join("\n") + "\n";
writeFileSync(resolve(".data/testnet-demo.env"), env, { mode: 0o600 });
const evidence = { network: "testnet", owner: observedOwner, contractId: state.contract.accountId, operatorAccountId: state.operator.accountId, customerAccountId: state.customer.accountId, receiptPublicKey: state.receipt.publicKey, receiptPermission: permission, deployTx: state.transactions.deploy, deployExplorer: `https://testnet.nearblocks.io/txns/${state.transactions.deploy}`, wasmSha256: wasmHash, observedAt: new Date().toISOString() };
mkdirSync(resolve("../artifacts/testnet-verification"), { recursive: true });
writeFileSync(resolve("../artifacts/testnet-verification/deployment.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
