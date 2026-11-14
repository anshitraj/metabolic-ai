import type { Metadata } from "next";
import { ContactLines, LegalDoc, Section } from "@/components/legal-doc";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy — Metabolic AI",
  description: "What Metabolic AI collects, what goes to AI providers and to NEAR, how long it is kept, and how to have it deleted.",
};

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy Policy"
      intro={`This policy explains what ${LEGAL.who} collects when you use Metabolic AI, where it goes, and how to have it removed. We collect only what the service needs and never sell your data.`}
    >
      <Section title="What we collect">
        <ul>
          <li><strong>Your NEAR account id and public key</strong>, from the signed sign-in message. We never see your private keys.</li>
          <li><strong>Deposits</strong> — the transaction hash, amount and the NEAR/USD rate used to credit you. These transactions are public on NEAR already.</li>
          <li><strong>Conversations and requests</strong> — your prompts, the answers, and per-request usage (model, tokens, cost, charge, routing decision).</li>
          <li><strong>API keys</strong> — stored only as SHA-256 hashes, with a short prefix so you can tell them apart.</li>
          <li><strong>Operational logs</strong> — request ids, timings and error classes, used to keep the service running.</li>
        </ul>
      </Section>
      <Section title="Where it goes">
        <ul>
          <li><strong>AI providers</strong> (for example Anthropic, DeepSeek or a hosted Llama provider) receive the prompts needed to answer you, under their own terms.</li>
          <li><strong>NEAR</strong> receives only aggregate economic receipts: interval revenue, compute spend, margin, operating state and a hash over ledger entries. No prompts, account ids or keys are ever written on chain.</li>
          <li>Nothing else leaves the service, and no advertising or analytics trackers are used.</li>
        </ul>
      </Section>
      <Section title="How long we keep it">
        <p>Conversations are kept until you ask us to delete them. Usage and ledger records are kept for as long as accounting requires, because they back the receipts committed on chain. Sessions expire after 72 hours.</p>
      </Section>
      <Section title="Your choices">
        <p>You can ask for a copy of your data, a correction, or deletion of your conversations by writing to us. On-chain data (your deposit transactions) can&apos;t be deleted by anyone.</p>
      </Section>
      <Section title="Contact">
        <ContactLines />
      </Section>
    </LegalDoc>
  );
}
