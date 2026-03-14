/**
 * LangChain.js tool wrappers for Assistant Hub API endpoints.
 *
 * Each tool extends DynamicStructuredTool with typed Zod input schemas.
 */

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { AssistantHubClient } from "./client.js";
import type { ToolDefinition } from "./types.js";
import { TOOL_REGISTRY } from "./types.js";

// ── Input schemas ──────────────────────────────────────────────────

const EmptyInput = z.object({});

const CoinInput = z.object({
  coin: z
    .string()
    .default("BTC")
    .describe("Cryptocurrency symbol (e.g., BTC, ETH, SOL, DOGE)"),
});

const OptionalCoinInput = z.object({
  coin: z
    .string()
    .optional()
    .describe("Optional cryptocurrency symbol to filter results"),
});

const BacktestInput = z.object({
  coin: z.string().describe("Cryptocurrency symbol"),
  strategy: z
    .enum(["momentum", "mean_reversion", "breakout", "rsi"])
    .default("momentum")
    .describe("Strategy type"),
  periodDays: z.number().default(90).describe("Backtest period in days (30-365)"),
  simulations: z.number().default(1000).describe("Monte Carlo simulations (100-10000)"),
});

const SlippageInput = z.object({
  coin: z.string().describe("Cryptocurrency symbol"),
  amountUsd: z.number().describe("Trade size in USD"),
  side: z.enum(["buy", "sell"]).default("buy").describe("Trade side"),
});

const AlertInput = z.object({
  coin: z.string().describe("Cryptocurrency symbol"),
  condition: z
    .enum(["above", "below", "change_pct"])
    .describe("Alert condition"),
  value: z.number().describe("Trigger value (price in USD or percentage)"),
});

// ── Schema mapping ─────────────────────────────────────────────────

const INPUT_SCHEMAS: Record<string, z.ZodObject<z.ZodRawShape>> = {
  live_prices: EmptyInput,
  fear_greed: EmptyInput,
  crypto_news: EmptyInput,
  daily_pulse: EmptyInput,
  risk_scores: OptionalCoinInput,
  ai_forecast: CoinInput,
  monte_carlo_backtest: BacktestInput,
  slippage_estimate: SlippageInput,
  create_alert: AlertInput,
};

// ── Tool factory ───────────────────────────────────────────────────

function buildParams(
  def: ToolDefinition,
  input: Record<string, unknown>
): { params?: Record<string, string>; body?: Record<string, unknown> } {
  if (def.method === "POST") {
    return { body: input };
  }

  // GET — convert to query params
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined && v !== null) {
      params[k] = typeof v === "string" ? v.toUpperCase() : String(v);
    }
  }
  return Object.keys(params).length > 0 ? { params } : {};
}

export function createTools(client: AssistantHubClient, options?: {
  includePremium?: boolean;
  toolFilter?: Set<string>;
}): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [];

  for (const def of TOOL_REGISTRY) {
    if (def.premium && options?.includePremium === false) {
      continue;
    }
    if (options?.toolFilter && !options.toolFilter.has(def.hubToolId)) {
      continue;
    }

    const schema = INPUT_SCHEMAS[def.hubToolId] ?? EmptyInput;

    const tool = new DynamicStructuredTool({
      name: def.name,
      description: def.description,
      schema,
      func: async (input: Record<string, unknown>) => {
        const reqParams = buildParams(def, input);
        const result = await client.request(def.method, def.endpoint, reqParams);
        return JSON.stringify(result, null, 2);
      },
    });

    tools.push(tool);
  }

  return tools;
}
