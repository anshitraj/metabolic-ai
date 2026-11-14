// How each agent / IDE is told about Metabolic AI. Two doors:
//  - MCP (Model Context Protocol) at <origin>/api/mcp  → tools the agent can call
//  - OpenAI-compatible API at <origin>/api/v1          → apps with a custom base URL
// Config formats follow each tool's own documentation. The endpoints are tested
// here; individual clients have not all been run against a live install, and
// tools change their config formats, so snippets are instructions, not certified.

export type AgentId = "claude-code" | "claude-desktop" | "cursor" | "codex" | "antigravity" | "windsurf" | "gemini-cli" | "vscode" | "cline" | "opencode";

export type AgentClient = {
  id: AgentId;
  name: string;
  maker: string;
  /** file in /public/connectors (without .svg) */
  logo: string;
  group: "Coding agents" | "Desktop & IDE";
  where: string;
  blurb: string;
  docs?: string;
};

export const AGENTS: AgentClient[] = [
  { id: "claude-code", name: "Claude Code", maker: "Anthropic", logo: "claudecode-color", group: "Coding agents", where: "Terminal", blurb: "One command in your terminal.", docs: "https://docs.claude.com/en/docs/claude-code/mcp" },
  { id: "codex", name: "Codex", maker: "OpenAI", logo: "codex", group: "Coding agents", where: "~/.codex/config.toml", blurb: "OpenAI's coding agent (CLI and IDE).", docs: "https://developers.openai.com/codex/mcp" },
  { id: "cursor", name: "Cursor", maker: "Anysphere", logo: "cursor", group: "Desktop & IDE", where: "~/.cursor/mcp.json", blurb: "Adds Metabolic AI as a tool in Cursor's agent.", docs: "https://docs.cursor.com/context/mcp" },
  { id: "antigravity", name: "Antigravity", maker: "Google", logo: "antigravity-color", group: "Desktop & IDE", where: "mcp_config.json (Agent panel → MCP)", blurb: "Google's agent-first IDE." },
  { id: "windsurf", name: "Windsurf", maker: "Cognition", logo: "windsurf", group: "Desktop & IDE", where: "~/.codeium/windsurf/mcp_config.json", blurb: "Adds a tool for Cascade." },
  { id: "vscode", name: "VS Code", maker: "GitHub Copilot", logo: "githubcopilot", group: "Desktop & IDE", where: ".vscode/mcp.json", blurb: "Copilot agent mode in VS Code.", docs: "https://code.visualstudio.com/docs/copilot/customization/mcp-servers" },
  { id: "claude-desktop", name: "Claude Desktop", maker: "Anthropic", logo: "claude-color", group: "Desktop & IDE", where: "claude_desktop_config.json", blurb: "The Claude app on Mac and Windows." },
  { id: "gemini-cli", name: "Gemini CLI", maker: "Google", logo: "geminicli-color", group: "Coding agents", where: "~/.gemini/settings.json", blurb: "Google's terminal agent.", docs: "https://github.com/google-gemini/gemini-cli" },
  { id: "cline", name: "Cline", maker: "Cline", logo: "cline", group: "Desktop & IDE", where: "cline_mcp_settings.json", blurb: "Open-source agent for VS Code." },
  { id: "opencode", name: "OpenCode", maker: "SST", logo: "opencode", group: "Coding agents", where: "opencode.json", blurb: "Open-source terminal agent.", docs: "https://opencode.ai/docs/mcp-servers/" },
];

export const ENV_NAME = "METABOLIC_API_KEY";
export const KEY_PLACEHOLDER = "<your Metabolic key>";

export type Snippet = { title: string; code: string; note?: string };

const json = (v: unknown) => JSON.stringify(v, null, 2);

/**
 * `key` is the secret just created on this page (shown once). Without it the
 * snippet uses an environment variable where the tool supports that, otherwise a
 * clearly marked placeholder.
 */
export function mcpSnippet(id: AgentId, url: string, key?: string): Snippet {
  const bearer = `Bearer ${key ?? KEY_PLACEHOLDER}`;
  const keepPrivate = key ? "The key is in this file. Keep it out of version control." : undefined;
  switch (id) {
    case "claude-code":
      return {
        title: "Run in your terminal",
        code: `claude mcp add --transport http metabolic "${url}" \\\n  --header "Authorization: ${bearer}"`,
        note: key ? "Then run /mcp inside Claude Code to confirm it shows “metabolic” as connected." : "Replace the placeholder with your key, or create one above and it fills in.",
      };
    case "codex":
      return {
        title: "Add to config.toml",
        code: key
          ? `[mcp_servers.metabolic]\nurl = "${url}"\nhttp_headers = { "Authorization" = "${bearer}" }`
          : `[mcp_servers.metabolic]\nurl = "${url}"\nbearer_token_env_var = "${ENV_NAME}"`,
        note: key ? keepPrivate : `Codex reads the key from the ${ENV_NAME} environment variable. Set it, then restart Codex.`,
      };
    case "cursor":
      return {
        title: "Add to mcp.json",
        code: json({ mcpServers: { metabolic: { url, headers: { Authorization: key ? bearer : "Bearer ${env:" + ENV_NAME + "}" } } } }),
        note: key ? keepPrivate : `Cursor reads ${ENV_NAME} from the environment it was started in. Set it, then restart Cursor.`,
      };
    case "antigravity":
      return {
        title: "Add to mcp_config.json",
        code: json({ mcpServers: { metabolic: { serverUrl: url, headers: { Authorization: bearer } } } }),
        note: key ? keepPrivate : "Antigravity reads the key from this file: put your key in place of the placeholder and keep the file private.",
      };
    case "windsurf":
      return {
        title: "Add to mcp_config.json",
        code: json({ mcpServers: { metabolic: { serverUrl: url, headers: { Authorization: key ? bearer : "Bearer ${env:" + ENV_NAME + "}" } } } }),
        note: key ? keepPrivate : `Windsurf can read ${ENV_NAME} from your environment. Set it, then refresh the MCP list in Cascade.`,
      };
    case "vscode":
      return {
        title: "Add to .vscode/mcp.json",
        code: json({ servers: { metabolic: { type: "http", url, headers: { Authorization: key ? bearer : "Bearer ${env:" + ENV_NAME + "}" } } } }),
        note: key ? keepPrivate : `VS Code can read ${ENV_NAME} from your environment. Then use Copilot in Agent mode and enable the tool.`,
      };
    case "claude-desktop":
      // Claude Desktop's remote connectors UI can't send a custom header, so use the mcp-remote bridge.
      // The header has no space after the colon and the key sits in env, so Windows doesn't split the argument.
      return {
        title: "Add to claude_desktop_config.json",
        code: json({
          mcpServers: {
            metabolic: {
              command: "npx",
              args: ["-y", "mcp-remote", url, "--header", "Authorization:${AUTH_HEADER}"],
              env: { AUTH_HEADER: bearer },
            },
          },
        }),
        note: "Needs Node.js (it runs the small mcp-remote bridge). Leave the header exactly as written, with no space after the colon, then restart Claude Desktop.",
      };
    case "gemini-cli":
      return {
        title: "Add to settings.json",
        code: json({ mcpServers: { metabolic: { httpUrl: url, headers: { Authorization: bearer } } } }),
        note: key ? keepPrivate : "Put your key in place of the placeholder. Run /mcp in Gemini CLI to check.",
      };
    case "cline":
      return {
        title: "Add to cline_mcp_settings.json",
        code: json({ mcpServers: { metabolic: { url, type: "streamableHttp", headers: { Authorization: bearer } } } }),
        note: key ? keepPrivate : "Open Cline → MCP Servers → Configure. Put your key in place of the placeholder.",
      };
    case "opencode":
      return {
        title: "Add to opencode.json",
        code: json({ $schema: "https://opencode.ai/config.json", mcp: { metabolic: { type: "remote", url, enabled: true, headers: { Authorization: bearer } } } }),
        note: key ? keepPrivate : "Put your key in place of the placeholder.",
      };
  }
}

/** A good first message to try once connected. */
export function firstPrompt(): string {
  return "Use the metabolic ask tool to explain, in two sentences, why an AI business would switch to a cheaper model when its margin drops.";
}

export type OpenAiSnippet = { id: "curl" | "python" | "javascript"; label: string; code: string };

/** For apps with a custom OpenAI base URL, and for code. */
export function openAiSnippets(base: string, key?: string): OpenAiSnippet[] {
  const k = key ?? KEY_PLACEHOLDER;
  return [
    {
      id: "curl",
      label: "curl",
      code: `curl ${base}/chat/completions \\\n  -H "Authorization: Bearer ${k}" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "metabolic-auto",\n    "messages": [{"role": "user", "content": "Say hello in five words."}]\n  }'`,
    },
    {
      id: "python",
      label: "Python",
      code: `from openai import OpenAI\n\nclient = OpenAI(base_url="${base}", api_key="${k}")\nreply = client.chat.completions.create(\n    model="metabolic-auto",\n    messages=[{"role": "user", "content": "Say hello in five words."}],\n)\nprint(reply.choices[0].message.content)`,
    },
    {
      id: "javascript",
      label: "JavaScript",
      code: `import OpenAI from "openai";\n\nconst client = new OpenAI({ baseURL: "${base}", apiKey: "${k}" });\nconst reply = await client.chat.completions.create({\n  model: "metabolic-auto",\n  messages: [{ role: "user", content: "Say hello in five words." }],\n});\nconsole.log(reply.choices[0].message.content);`,
    },
  ];
}

export const OPENAI_APPS: { name: string; logo: string; where: string }[] = [
  { name: "Cursor", logo: "cursor", where: "Settings → Models → Override OpenAI Base URL" },
  { name: "Cline", logo: "cline", where: "API Provider → OpenAI Compatible" },
  { name: "OpenCode", logo: "opencode", where: "Provider → custom OpenAI-compatible" },
  { name: "Any OpenAI SDK app", logo: "openai", where: "Set base URL and API key" },
];

export const MODEL_CHOICES: [string, string][] = [
  ["metabolic-auto", "Router picks the best model the business can afford (recommended)"],
  ["metabolic-premium", "Prefer the top tier (still subject to current policy)"],
  ["metabolic-standard", "Prefer the middle tier"],
  ["metabolic-economy", "Prefer the cheapest tier"],
];
