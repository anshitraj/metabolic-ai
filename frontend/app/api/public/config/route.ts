import { config } from "@/server/config";
import { depositTarget } from "@/server/services/treasury";
import { operatorAccounts } from "@/server/services/settings";
import { receiptsConfigured } from "@/server/services/receipts";
import { configuredProviders } from "@/server/economics/registry";
import { json, route } from "@/server/http";

/** Non-secret runtime configuration the browser needs (network, contract, what's set up). */
export const GET = route(async (_req, { requestId }) =>
  json(
    {
      network: config.near.network,
      contractId: config.near.contractId ?? null,
      deposit: await depositTarget(),
      receipts: receiptsConfigured(),
      explorerUrl: config.near.explorerUrl,
      providers: configuredProviders(),
      operators: (await operatorAccounts()).length,
    },
    { requestId },
  ),
);
