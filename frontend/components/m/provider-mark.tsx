import Image from "next/image";
import { cx } from "./ui";

const marks: Record<string, { src: string; name: string }> = {
  gemini: { src: "gemini-color", name: "Gemini" },
  anthropic: { src: "claude-color", name: "Claude" },
  claude: { src: "claude-color", name: "Claude" },
  openai: { src: "openai", name: "OpenAI" },
  deepseek: { src: "deepseek-color", name: "DeepSeek" },
  llama: { src: "meta-color", name: "Llama" },
};

/** Local, licensed brand assets; connection status is always separate from identity. */
export function ProviderMark({
  provider,
  size = 24,
  className,
}: {
  provider: string;
  size?: number;
  className?: string;
}) {
  const mark = marks[provider.toLowerCase()];
  return mark ? (
    <Image
      src={`/connectors/${mark.src}.svg`}
      alt={mark.name}
      width={size}
      height={size}
      className={cx("shrink-0 object-contain", className)}
    />
  ) : (
    <span
      className={cx(
        "grid shrink-0 place-items-center rounded-lg bg-paper-sunken text-xs font-semibold uppercase",
        className,
      )}
      style={{ width: size, height: size }}
      aria-label={provider}
    >
      {provider.slice(0, 2)}
    </span>
  );
}
