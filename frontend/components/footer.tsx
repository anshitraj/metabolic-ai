import Link from "next/link";
import { LogoMark } from "./logo";

export function Footer() {
  return (
    <footer className="ml-footer">
      <div className="ml-container">
        <div className="ml-footer-invitation">
          <div>
            <span className="ml-eyebrow">
              Let intelligence find its balance.
            </span>
            <h2>
              Made to think.
              <br />
              <em>Built to keep going.</em>
            </h2>
            <Link href="/console" className="ml-footer-cta">
              Meet your little AI business <span aria-hidden>↗</span>
            </Link>
          </div>
          <FooterSculpture />
        </div>
        <div className="ml-footer-links">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 text-[16px] font-semibold"
            >
              <LogoMark /> Metabolic AI
            </Link>
            <p>
              An AI service that earns, adapts and protects its runway. Its
              economics are yours to inspect.
            </p>
          </div>
          <FooterCol
            title="Explore"
            links={[
              ["Command Center", "/console"],
              ["AI Workspace", "/console/workspace"],
              ["Stress Lab", "/console/stress-lab"],
              ["Guided demo", "/demo"],
            ]}
          />
          <FooterCol
            title="Check its work"
            links={[
              ["Treasury", "/console/treasury"],
              ["AI models", "/console/models"],
              ["Receipts", "/console/receipts"],
              ["Verify a receipt", "/verify"],
            ]}
          />
          <FooterCol
            title="Build & learn"
            links={[
              ["Developer API", "/console/developers"],
              ["Questions", "/#faq"],
              ["Contact", "/contact"],
              ["Privacy", "/privacy"],
              ["Terms", "/terms"],
            ]}
          />
        </div>
        <div className="ml-footer-wordmark" aria-hidden>
          metabolic.
        </div>
        <div className="ml-footer-legal">
          <span>© {new Date().getFullYear()} Metabolic AI</span>
          <span>NEAR testnet · Testnet tokens have no monetary value.</span>
          <span>Examples and simulations are always labelled.</span>
        </div>
      </div>
    </footer>
  );
}
function FooterCol({
  title,
  links,
}: {
  title: string;
  links: [string, string][];
}) {
  return (
    <div>
      <div className="m-label">{title}</div>
      <ul>
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href}>{label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
function FooterSculpture() {
  return (
    <svg
      className="ml-footer-sculpture"
      viewBox="0 0 600 450"
      fill="none"
      aria-hidden
    >
      <defs>
        <radialGradient id="footer-core">
          <stop stopColor="var(--m-g-200)" />
          <stop offset=".45" stopColor="var(--m-g-500)" />
          <stop offset="1" stopColor="var(--m-g-900)" />
        </radialGradient>
        <linearGradient
          id="footer-rib"
          x1="80"
          y1="20"
          x2="510"
          y2="420"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--m-g-200)" stopOpacity=".08" />
          <stop offset=".45" stopColor="var(--m-g-200)" stopOpacity=".8" />
          <stop offset="1" stopColor="var(--m-g-500)" stopOpacity=".2" />
        </linearGradient>
      </defs>
      <g transform="translate(300 230) rotate(-28)">
        <ellipse rx="203" ry="174" fill="url(#footer-core)" opacity=".22" />
        {Array.from({ length: 28 }, (_, i) => (
          <ellipse
            key={i}
            rx={28 + i * 6.5}
            ry="174"
            transform={`rotate(${i * 6.4})`}
            stroke="url(#footer-rib)"
            strokeWidth=".8"
          />
        ))}
        <ellipse rx="240" ry="74" stroke="var(--m-g-200)" strokeOpacity=".35" />
        <circle r="53" fill="url(#footer-core)" opacity=".8" />
        <circle r="75" stroke="var(--m-g-200)" strokeOpacity=".2" />
        <circle cx="211" cy="-37" r="7" fill="var(--m-g-200)" />
        <circle cx="-212" cy="28" r="4" fill="var(--m-g-500)" />
      </g>
    </svg>
  );
}
