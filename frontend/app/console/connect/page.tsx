import type { Metadata } from "next";
import { ConnectAgent, AgentLogo } from "@/components/m/connect-agent";
import { PageHeader } from "@/components/m/ui";

export const metadata: Metadata = { title: "Connect an agent — Metabolic AI" };

const LOGOS = ["claudecode-color", "codex", "cursor", "antigravity-color", "windsurf", "githubcopilot", "geminicli-color", "cline", "opencode", "openai"];

export default function ConnectPage() {
  return (
    <div>
      <PageHeader
        title="Connect an agent"
        description="Let the AI tools you already use ask Metabolic AI. They get answers from the best model the business can afford right now, and you can see every request it makes."
      />
      <div className="mb-6 flex flex-wrap items-center gap-2.5" aria-label="Works with">
        {LOGOS.map((l) => (
          <span key={l} className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface">
            <AgentLogo name={l} size={22} />
          </span>
        ))}
        <span className="ml-1 text-[13px] text-muted">and anything that speaks MCP or the OpenAI API</span>
      </div>
      <ConnectAgent />
    </div>
  );
}
