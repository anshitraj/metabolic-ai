import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { nep413Hash, verifyNep413Signature } from "@/server/services/auth";

const sk = ed25519.utils.randomPrivateKey();
const pkB58 = base58.encode(ed25519.getPublicKey(sk));
const nonce = new Uint8Array(32).fill(7);
const base = { message: "Sign in to Metabolic AI (testnet).", nonce, recipient: "metabolic.ai" };
const cb = "http://localhost:3000/login";

describe("NEP-413 verification", () => {
  it("accepts a wallet that signs WITHOUT callbackUrl even when the client sends one (Meteor-style)", () => {
    const sig = Buffer.from(ed25519.sign(nep413Hash({ ...base, callbackUrl: null }), sk)).toString("base64");
    expect(verifyNep413Signature({ ...base, callbackUrl: cb, publicKey: `ed25519:${pkB58}`, signature: sig })).toBe(true);
  });
  it("accepts a wallet that signs WITH callbackUrl (MyNearWallet-style)", () => {
    const sig = Buffer.from(ed25519.sign(nep413Hash({ ...base, callbackUrl: cb }), sk)).toString("base64");
    expect(verifyNep413Signature({ ...base, callbackUrl: cb, publicKey: `ed25519:${pkB58}`, signature: sig })).toBe(true);
  });
  it("accepts base58 signatures and un-prefixed keys", () => {
    const sig = base58.encode(ed25519.sign(nep413Hash({ ...base, callbackUrl: null }), sk));
    expect(verifyNep413Signature({ ...base, publicKey: pkB58, signature: sig })).toBe(true);
  });
  it("rejects a signature over a different nonce or message", () => {
    const sig = Buffer.from(ed25519.sign(nep413Hash({ ...base, nonce: new Uint8Array(32).fill(8), callbackUrl: null }), sk)).toString("base64");
    expect(verifyNep413Signature({ ...base, callbackUrl: cb, publicKey: `ed25519:${pkB58}`, signature: sig })).toBe(false);
    const sig2 = Buffer.from(ed25519.sign(nep413Hash({ ...base, message: "other", callbackUrl: null }), sk)).toString("base64");
    expect(verifyNep413Signature({ ...base, publicKey: `ed25519:${pkB58}`, signature: sig2 })).toBe(false);
  });
});

// Cross-check our hand-written serializer against the same borsh schema the
// NEAR wallet selector uses to build what wallets sign.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

// Use the exact borsh build bundled with the wallet selector (2.x) — that is what wallets run.
const { serialize } = createRequire(import.meta.url)("../../node_modules/@near-wallet-selector/core/node_modules/borsh") as { serialize: (schema: unknown, value: unknown) => Uint8Array };

describe("NEP-413 payload matches the wallet library's encoding", () => {
  const schema = { struct: { tag: "u32", message: "string", nonce: { array: { type: "u8", len: 32 } }, recipient: "string", callbackUrl: { option: "string" } } } as const;
  const sha = (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());
  for (const callbackUrl of [undefined, "http://localhost:3000/login"]) {
    it(`callbackUrl ${callbackUrl ? "present" : "absent"}`, () => {
      const msg = "Sign in to Metabolic AI (testnet). This request does not send a transaction or cost gas. ✓ ünïcödé";
      const payload: Record<string, unknown> = { tag: 2147484061, message: msg, nonce: Array.from(nonce), recipient: "metabolic.ai" };
      if (callbackUrl) payload.callbackUrl = callbackUrl;
      const expected = sha(serialize(schema, payload));
      const ours = nep413Hash({ message: msg, nonce, recipient: "metabolic.ai", callbackUrl: callbackUrl ?? null });
      expect(Buffer.from(ours).toString("hex")).toBe(Buffer.from(expected).toString("hex"));
    });
  }
});
