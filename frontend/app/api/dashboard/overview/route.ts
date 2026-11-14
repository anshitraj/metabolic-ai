import { overview } from "@/server/services/economy";
import { json, route } from "@/server/http";

// The business's own economy is public: anyone can watch it breathe.
export const GET = route(async (_req, { requestId }) => json(await overview(), { requestId }));
