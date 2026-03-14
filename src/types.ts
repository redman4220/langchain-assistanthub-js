/**
 * Zod schemas and TypeScript types for Assistant Hub tool outputs.
 */

import { z } from "zod";

// ── Tool metadata ──────────────────────────────────────────────────

export const ToolMetadataSchema = z.object({
  hubToolId: z.string(),
  name: z.string(),
  tierRequired: z.boolean(),
  dailyLimits: z.object({
    anonymous: z.number(),
    free: z.number(),
    pro: z.number(),
    premium: z.union([z.number(), z.literal("unlimited")]),
  }),
  x402PriceUsdc: z.number(),
  stakingDiscountPct: z.number(),
  description: z.string(),
});

export type ToolMetadata = z.infer<typeof ToolMetadataSchema>;

// ── Tool definitions ───────────────────────────────────────────────

export interface ToolDefinition {
  hubToolId: string;
  name: string;
  description: string;
  endpoint: string;
  method: "GET" | "POST";
  premium: boolean;
}

export const TOOL_REGISTRY: ToolDefinition[] = [
  // Free tools
  {
    hubToolId: "live_prices",
    name: "assistant_hub_live_prices",
    description:
      "Get real-time cryptocurrency prices including BTC, ETH, SOL, DOGE, AVAX, LINK, ADA, DOT. Returns current price, 24h change, volume, and market cap.",
    endpoint: "/api/crypto/prices",
    method: "GET",
    premium: false,
  },
  {
    hubToolId: "fear_greed",
    name: "assistant_hub_fear_greed",
    description:
      "Get the current Crypto Fear & Greed Index (0-100). 0 = Extreme Fear, 100 = Extreme Greed.",
    endpoint: "/api/crypto/fear-greed",
    method: "GET",
    premium: false,
  },
  {
    hubToolId: "crypto_news",
    name: "assistant_hub_crypto_news",
    description:
      "Get the latest cryptocurrency news headlines from CryptoCompare. Returns 12 recent headlines.",
    endpoint: "/api/crypto/news",
    method: "GET",
    premium: false,
  },
  {
    hubToolId: "risk_scores",
    name: "assistant_hub_risk_scores",
    description:
      "Get composite risk scores (0-100) for cryptocurrencies combining technical, economic, and sentiment analysis.",
    endpoint: "/api/risk/scores",
    method: "GET",
    premium: false,
  },
  {
    hubToolId: "daily_pulse",
    name: "assistant_hub_daily_pulse",
    description:
      "Get today's Daily Macro Pulse: AI-generated top 3 macro threats and top 3 crypto opportunities.",
    endpoint: "/api/pulse",
    method: "GET",
    premium: false,
  },
  // Premium tools
  {
    hubToolId: "ai_forecast",
    name: "assistant_hub_ai_forecast",
    description:
      "Get AI-powered price forecast (24h/7d) for a cryptocurrency. PREMIUM: Requires Pro/Premium or x402.",
    endpoint: "/api/crypto/forecast",
    method: "GET",
    premium: true,
  },
  {
    hubToolId: "monte_carlo_backtest",
    name: "assistant_hub_monte_carlo_backtest",
    description:
      "Run Monte Carlo simulation backtest. Returns expected returns, VaR, Sharpe ratio. PREMIUM.",
    endpoint: "/api/backtest/run",
    method: "POST",
    premium: true,
  },
  {
    hubToolId: "slippage_estimate",
    name: "assistant_hub_slippage_estimate",
    description:
      "Estimate trade slippage for a given order size. Returns slippage %, effective price, fees. PREMIUM.",
    endpoint: "/api/v1/slippage",
    method: "GET",
    premium: true,
  },
  {
    hubToolId: "create_alert",
    name: "assistant_hub_create_alert",
    description:
      "Create a price or change alert for a cryptocurrency. PREMIUM.",
    endpoint: "/api/v1/alerts",
    method: "POST",
    premium: true,
  },
];

// ── Auth config ────────────────────────────────────────────────────

import type { X402Config } from "./x402.js";

export interface AssistantHubConfig {
  apiKey?: string;
  baseUrl?: string;
  includePremium?: boolean;
  tools?: string[];
  maxRetries?: number;
  timeout?: number;
  /** x402 auto-payment config for premium tools. */
  x402?: X402Config;
}

export const DEFAULT_CONFIG: Required<
  Pick<AssistantHubConfig, "baseUrl" | "includePremium" | "maxRetries" | "timeout">
> = {
  baseUrl: "https://rmassistanthub.io",
  includePremium: true,
  maxRetries: 2,
  timeout: 30_000,
};
