// Illustrative prices, shared by the lightweight landing demos. The real
// Stress Lab uses the server policy and catalog instead.
export const EXAMPLE_MODELS = [
  { name: "Gemini Pro", provider: "gemini", tier: "Premium", baseMarginBp: 5000 },
  { name: "Claude Sonnet", provider: "anthropic", tier: "Standard", baseMarginBp: 7667 },
  { name: "DeepSeek Chat", provider: "deepseek", tier: "Economy", baseMarginBp: 8792 },
] as const;

export function exampleRouting(stressed: boolean) {
  const multiplier = stressed ? 2.4 : 1;
  const models = EXAMPLE_MODELS.map((m) => ({
    ...m,
    marginBp: 10_000 - Math.round((10_000 - m.baseMarginBp) * multiplier),
  }));
  return { models, selected: models.findIndex((m) => m.marginBp >= 3000) };
}
