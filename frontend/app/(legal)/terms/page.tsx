import type { Metadata } from "next";
import { ContactLines, LegalDoc, Section } from "@/components/legal-doc";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service — Metabolic AI",
  description: "The terms for using Metabolic AI, its prepaid credits and its developer API.",
};

export default function TermsPage() {
  return (
    <LegalDoc
      title="Terms of Service"
      intro={`These terms govern your use of Metabolic AI, operated by ${LEGAL.who}. By signing in or calling the API you agree to them.`}
    >
      <Section title="The service">
        <p>Metabolic AI answers requests using third-party AI models chosen automatically by an economic policy. Which model serves a request depends on the business&apos;s operating state; each response tells you which model ran and why. Answers can be wrong — check anything important.</p>
      </Section>
      <Section title="Testnet and simulations">
        <ul>
          <li>The service currently runs on <strong>NEAR testnet</strong>. Testnet tokens have no monetary value.</li>
          <li>The Stress Lab and the guided demo use <strong>simulated</strong> numbers, always labelled as such. They never change real balances.</li>
        </ul>
      </Section>
      <Section title="Credits and billing">
        <ul>
          <li>Deposits become prepaid credit at the NEAR/USD rate observed when the server verifies the finalized transaction.</li>
          <li>Each request reserves the most it can cost, then charges actual usage at the published per-token price for the model tier that served it. Unused reservations are released.</li>
          <li>If a provider fails before producing output, you are not charged. Partial answers are charged for the tokens delivered.</li>
          <li>The business may decline requests to protect its reserve (Survival mode) or when the operator pauses the service.</li>
        </ul>
      </Section>
      <Section title="Acceptable use">
        <p>Don&apos;t use the service to break the law, attack other systems, or violate the usage policies of the AI providers it relies on. Keep your API keys secret; you are responsible for usage under your keys.</p>
      </Section>
      <Section title="Liability">
        <p>The service is provided as is, without warranties. To the extent the law allows, our liability is limited to the amount of credit you deposited in the previous three months.{LEGAL.jurisdiction ? ` Disputes are heard by the courts of ${LEGAL.jurisdiction}.` : ""}</p>
      </Section>
      <Section title="Contact">
        <ContactLines />
      </Section>
    </LegalDoc>
  );
}
