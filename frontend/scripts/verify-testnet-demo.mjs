// Real testnet transactions + NEP-413 authentication + live streaming inference.
// Generated test wallets use the same authentication/deposit APIs as the browser.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { Account } from "@near-js/accounts";
import { JsonRpcProvider } from "@near-js/providers";
import { KeyPairSigner } from "@near-js/signers";
import { actionCreators } from "@near-js/transactions";
const BASE = process.env.DEMO_BASE_URL || "http://localhost:3002";
if (!/^http:\/\/(localhost|127\.0\.0\.1):3002$/.test(BASE)) throw new Error("This verification script is restricted to the isolated local testnet demo server.");
const deployment = JSON.parse(readFileSync(".data/testnet-deployment.json", "utf8"));
if (deployment.network !== "testnet") throw new Error("Testnet only.");
const privatePath = ".data/testnet-demo-state.json";
const state = existsSync(privatePath) ? JSON.parse(readFileSync(privatePath, "utf8")) : { steps: {}, startedAt: new Date().toISOString() };
const save = () => writeFileSync(privatePath, JSON.stringify(state, null, 2), { mode: 0o600 });
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });
const PROMPT = "Explain what a spending limit is in one short sentence.";
async function request(path, { cookie, key, method = "GET", body, raw = false, idem } = {}) {
  const response = await fetch(BASE + path, { method, headers: { origin: BASE, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(key ? { authorization: `Bearer ${key}` } : {}), ...(idem ? { "idempotency-key": idem } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120_000) });
  if (raw) return response;
  const data = await response.json();
  if (!response.ok) { const e = new Error(data.error?.message || `HTTP ${response.status}`); e.code = data.error?.code; e.httpStatus = response.status; throw e; }
  return data;
}
async function signIn(wallet) {
  const nonce = await request("/api/auth/nonce", { method: "POST" });
  const signer = KeyPairSigner.fromSecretKey(wallet.secretKey);
  const signed = await signer.signNep413Message(nonce.message, wallet.accountId, nonce.recipient, Buffer.from(nonce.nonce, "base64"));
  const response = await request("/api/auth/verify", { method: "POST", raw: true, body: { accountId: wallet.accountId, publicKey: signed.publicKey.toString(), signature: Buffer.from(signed.signature).toString("base64"), nonce: nonce.nonce } });
  if (!response.ok) throw new Error("Test wallet authentication failed: " + response.status);
  const cookie = response.headers.getSetCookie().find((v) => v.startsWith("metabolic_session="))?.split(";")[0];
  if (!cookie) throw new Error("No authenticated session cookie returned.");
  return cookie;
}
async function deposit(wallet, cookie, label, amountNear, purpose) {
  const previous = state.steps[label] ?? {};
  if (!previous.intent) { previous.intent = await request("/api/treasury/deposit-intent", { cookie, method: "POST", body: { amountNear, purpose } }); state.steps[label] = previous; save(); }
  if (!previous.txHash) {
    const intent = previous.intent;
    if (intent.network !== "testnet" || intent.receiverId !== deployment.contract.accountId || intent.method !== "deposit") throw new Error("The deposit intent does not point at the deployed testnet contract.");
    const walletAccount = new Account(wallet.accountId, provider, KeyPairSigner.fromSecretKey(wallet.secretKey));
    const outcome = await walletAccount.signAndSendTransaction({ receiverId: intent.receiverId, waitUntil: "FINAL", actions: [actionCreators.functionCall("deposit", { memo: intent.intentId }, BigInt(intent.gas), BigInt(intent.amountYocto))] });
    previous.txHash = outcome.transaction.hash; save();
  }
  if (!previous.verified) {
    previous.verified = await request("/api/treasury/verify-deposit", { cookie, method: "POST", body: { txHash: previous.txHash, intentId: previous.intent.intentId, purpose } }); save();
  }
  return previous;
}
async function stream(key, label) {
  if (state.steps[label]) return state.steps[label];
  const response = await request("/api/v1/inference", { key, method: "POST", raw: true, idem: `verified-${label}-${deployment.contract.accountId}`, body: { messages: [{ role: "user", content: PROMPT }], max_output_tokens: 1024, stream: true } });
  const events = [];
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      const data = frame.split("\n").find((line) => line.startsWith("data: "));
      if (data) events.push(JSON.parse(data.slice(6)));
    }
  }
  const error = events.find((e) => e.type === "error"); if (error) throw new Error(`${label}: ${error.code}: ${error.message}`);
  const meta = events.find((e) => e.type === "meta"), final = events.find((e) => e.type === "final");
  const output = events.filter((e) => e.type === "text").map((e) => e.text).join("");
  if (!meta || !final || !output.trim() || final.providerCostSource !== "provider_usage") throw new Error("Live stream did not include text and provider-reported usage.");
  if (BigInt(final.charge) > BigInt(meta.reserved)) throw new Error("Customer charge exceeded the admitted reservation.");
  const result = { model: meta.model.label, modelId: meta.model.id, tier: final.tier, output, textFrames: events.filter((e) => e.type === "text").length, reserved: meta.reserved, charge: final.charge, providerCost: final.cost, providerCostSource: final.providerCostSource, usageId: final.usageId, explanation: final.explanation, spendPass: final.spendPass };
  state.steps[label] = result; save(); console.log(`${label}: ${result.model}, ${result.textFrames} text frames, charge ${result.charge} micro-USD`);
  return result;
}

try {
  const operatorCookie = await signIn(deployment.operator), customerCookie = await signIn(deployment.customer);
  // Isolated demo policy: a $0.10 reserve and 5s dwell keep a short live walkthrough practical.
  if (!state.policy) {
    const old = await request("/api/admin/policy");
    state.policy = await request("/api/admin/policy", { cookie: operatorCookie, method: "PUT", body: { ...old, hardReserveMicro: "100000", minDwellSeconds: 5, recoveryDwellSeconds: 5 } }); save();
  }
  await deposit(deployment.operator, operatorCookie, "capital", "0.8", "capital");
  for (let i = 0; i < 30; i++) {
    const view = await request("/api/dashboard/overview");
    if (view.state === "ABUNDANCE") break;
    if (i === 29) throw new Error("The funded business did not reach Abundance within the configured dwell window.");
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!state.normal) { state.normal = await request("/api/spend-passes", { cookie: customerCookie, method: "POST", body: { name: "Verified research allowance", agentName: "Research demo agent", totalBudget: "200000", maxPerRequest: "50000", allowedProviders: ["gemini"], allowedTiers: ["premium", "standard", "economy"], expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() } }); save(); }
  if (!state.steps.zeroCredit) {
    const me = await request("/api/auth/me", { cookie: customerCookie });
    if (me.credits.available !== "0") throw new Error("The test customer must have zero credits before the first request.");
    const response = await request("/api/v1/inference", { key: state.normal.secret, method: "POST", raw: true, body: { messages: [{ role: "user", content: PROMPT }], max_output_tokens: 1024 } });
    const data = await response.json();
    if (response.status !== 402 || data.error?.code !== "INSUFFICIENT_CREDITS") throw new Error("A zero-credit request was not rejected before inference.");
    state.steps.zeroCredit = { status: response.status, code: data.error.code, available: me.credits.available }; save(); console.log("Zero-credit request rejected before provider execution.");
  }
  await deposit(deployment.customer, customerCookie, "customerDeposit", "0.2", "credits");
  if (!state.steps.duplicateDeposit) {
    const before = await request("/api/auth/me", { cookie: customerCookie });
    const response = await request("/api/treasury/verify-deposit", { cookie: customerCookie, method: "POST", raw: true, body: { txHash: state.steps.customerDeposit.txHash, intentId: state.steps.customerDeposit.intent.intentId } });
    const duplicate = await response.json();
    const after = await request("/api/auth/me", { cookie: customerCookie });
    if (response.ok || !["DUPLICATE", "INTENT_USED"].includes(duplicate.error?.code) || before.credits.available !== after.credits.available) throw new Error("Duplicate deposit verification changed credits.");
    state.steps.duplicateDeposit = { code: duplicate.error.code, balanceUnchanged: true }; save();
  }
  const normal = await stream(state.normal.secret, "normalRequest");
  if (!state.tight) { state.tight = await request("/api/spend-passes", { cookie: customerCookie, method: "POST", body: { name: "Verified tighter allowance", agentName: "Budget demo agent", totalBudget: "200000", maxPerRequest: "6000", allowedProviders: ["gemini"], allowedTiers: ["premium", "standard", "economy"], expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() } }); save(); }
  const tight = await stream(state.tight.secret, "tightRequest");
  if (normal.tier === tight.tier || BigInt(tight.reserved) >= BigInt(normal.reserved)) throw new Error("The tighter authorized cap did not select a cheaper eligible model.");
  if (!state.steps.revoked) {
    await request(`/api/spend-passes/${state.normal.pass.id}`, { cookie: customerCookie, method: "DELETE" });
    const before = await request("/api/auth/me", { cookie: customerCookie });
    const response = await request("/api/v1/inference", { key: state.normal.secret, method: "POST", raw: true, body: { messages: [{ role: "user", content: PROMPT }], max_output_tokens: 1024 } });
    const data = await response.json();
    const after = await request("/api/auth/me", { cookie: customerCookie });
    if (data.error?.code !== "PASS_REVOKED" || before.credits.available !== after.credits.available) throw new Error("Revoked pass was not blocked without a charge.");
    state.steps.revoked = { code: data.error.code, status: response.status, balanceUnchanged: true }; save();
  }
  if (!state.steps.receipt) { state.steps.receipt = await request("/api/receipts", { cookie: customerCookie, method: "POST" }); save(); }
  const verification = await request(`/api/receipts/${state.steps.receipt.receiptId}`);
  if (!verification.match || !verification.onChainHash) throw new Error("The independent receipt verification did not match.");
  const [normalActivity, tightActivity, treasury, readiness] = await Promise.all([request(`/api/spend-passes/${state.normal.pass.id}`, { cookie: customerCookie }), request(`/api/spend-passes/${state.tight.pass.id}`, { cookie: customerCookie }), request("/api/treasury", { cookie: customerCookie }), request("/api/admin/readiness", { cookie: operatorCookie })]);
  if (normalActivity.pass.reserved !== "0" || tightActivity.pass.reserved !== "0") throw new Error("A completed pass still has reserved funds.");
  const evidence = { network: "testnet", owner: deployment.owner, contractId: deployment.contract.accountId, customerAccountId: deployment.customer.accountId, signedBy: "Fresh testnet wallets using NEP-413 and locally held test-only keys; user wallet UI signing was not exercised.", policy: state.policy, zeroCredit: state.steps.zeroCredit, capital: { txHash: state.steps.capital.txHash, explorer: state.steps.capital.verified.explorer, usd: state.steps.capital.verified.usd }, deposit: { txHash: state.steps.customerDeposit.txHash, explorer: state.steps.customerDeposit.verified.explorer, usd: state.steps.customerDeposit.verified.usd }, duplicateDeposit: state.steps.duplicateDeposit, normalRequest: normal, tightRequest: tight, revoked: state.steps.revoked, receipt: state.steps.receipt, independentVerification: { match: verification.match, storedHash: verification.storedHash, recomputedHash: verification.recomputedHash, onChainHash: verification.onChainHash }, reservationsReleased: true, treasury: { onChain: treasury.onChain, recordedYocto: treasury.recordedYocto, note: "The contract also holds faucet setup funds for storage and gas; on-chain balance and credited deposit totals are different measures. Provider expenses are offchain accruals, not on-chain provider payments." }, readiness, completedAt: new Date().toISOString() };
  mkdirSync("../artifacts/testnet-verification", { recursive: true });
  writeFileSync("../artifacts/testnet-verification/demo.json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ verified: true, normalModel: normal.model, tighterModel: tight.model, receipt: evidence.receipt.explorer, commitmentMatch: true, report: "artifacts/testnet-verification/demo.json" }, null, 2));
} catch (e) {
  console.error("Verification stopped at a recoverable checkpoint:", e.code || e.name, e.message);
  process.exitCode = 1;
}
