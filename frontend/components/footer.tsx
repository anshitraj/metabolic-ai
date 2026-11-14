import Link from "next/link";
import { LogoMark } from "./logo";

export function Footer() {
  return (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto max-w-[1200px] px-4 pb-10 pt-16 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5 text-[15px] font-semibold"><LogoMark /> Metabolic AI</div>
            <p className="mt-3 max-w-xs text-[13.5px] text-ink-2">Intelligence that earns. Adapts. Survives. An AI service run by its own economics, on NEAR.</p>
          </div>
          <FooterCol title="Product" links={[["Command Center", "/console"], ["AI Workspace", "/console/workspace"], ["Stress Lab", "/console/stress-lab"], ["Guided demo", "/demo"]]} />
          <FooterCol title="Proof" links={[["Treasury", "/console/treasury"], ["Decisions", "/console/decisions"], ["Receipts", "/console/receipts"], ["Verify a receipt", "/verify"]]} />
          <FooterCol title="Company" links={[["Developer API", "/console/developers"], ["Contact", "/contact"], ["Privacy", "/privacy"], ["Terms", "/terms"]]} />
        </div>
        <div className="mt-16 select-none font-serif text-[clamp(64px,15vw,190px)] leading-[0.85] tracking-[-0.035em] text-ink" aria-hidden>
          Metabolic
        </div>
        <div className="mt-6 flex flex-wrap justify-between gap-3 text-[12.5px] text-muted">
          <span>Running on NEAR testnet. Testnet tokens have no monetary value.</span>
          <span>Simulated figures are always labelled.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="m-label text-muted">{title}</div>
      <ul className="mt-3 space-y-2 text-[14px]">
        {links.map(([l, h]) => (
          <li key={h}>
            <Link href={h} className="text-ink-2 hover:text-ink">{l}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
