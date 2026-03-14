# langchain-assistanthub

> Crypto Intelligence Toolkit for LangChain.js / LangGraph.js agents

[![npm version](https://img.shields.io/npm/v/langchain-assistanthub)](https://www.npmjs.com/package/langchain-assistanthub)
[![npm downloads](https://img.shields.io/npm/dm/langchain-assistanthub)](https://www.npmjs.com/package/langchain-assistanthub)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Add real-time crypto prices, risk scores, AI forecasts, and more to any LangChain.js agent in 3 lines of code. Connects to [Assistant Hub](https://rmassistanthub.io) via MCP (Model Context Protocol).

## Install

```bash
# Recommended: pin to current stable version
npm install langchain-assistanthub@0.1.4

# Or latest
# npm install langchain-assistanthub
```

> We're at v0.1.4 — pinned install recommended for stability. Check the [changelog](https://github.com/redman4220/langchain-assistanthub-js/releases) for updates!

## Quick Start

```typescript
import { AssistantHubToolkit } from 'langchain-assistanthub';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';

// 1. Create toolkit
const toolkit = AssistantHubToolkit.fromApiKey('your-hub-api-key');

// 2. Get tools
const tools = toolkit.getTools();

// 3. Plug into any agent
const model = new ChatOpenAI({ model: 'gpt-4o' });
const agent = createReactAgent({ llm: model, tools });

const result = await agent.invoke({
  messages: [{ role: 'user', content: 'What are the current crypto prices?' }],
});
```

## Authentication

### Option A: API Key

```typescript
const toolkit = AssistantHubToolkit.fromApiKey('ahk_abc123');
```

### Option B: Environment Variable

```bash
export ASSISTANT_HUB_API_KEY=ahk_abc123
```

```typescript
const toolkit = AssistantHubToolkit.fromEnv();
```

### Option C: Login with Credentials

```typescript
const toolkit = await AssistantHubToolkit.fromLogin('user@example.com', 'password');
```

### Option D: Zero-Code MCP (no wrapper needed)

If you already use `@langchain/mcp-adapters`, point directly at the MCP endpoint:

```typescript
import { MultiServerMCPClient } from '@langchain/mcp-adapters';

const client = new MultiServerMCPClient({
  'assistant-hub': {
    transport: 'streamable-http',
    url: 'https://rmassistanthub.io/mcp',
    headers: { 'X-API-Key': 'ahk_abc123' },
  },
});

const tools = await client.getTools();
```

## Available Tools

### Free Tools (no API key required)

| Tool | Description |
|------|-------------|
| `live_prices` | Real-time prices for BTC, ETH, SOL, DOGE, AVAX, LINK, ADA, DOT |
| `fear_greed` | Crypto Fear & Greed Index (0-100) |
| `crypto_news` | Latest 12 crypto headlines from CryptoCompare |
| `risk_scores` | AI-computed risk scores (0-100) per coin |
| `daily_pulse` | Daily Macro Pulse: top 3 threats + top 3 opportunities |

### Premium Tools (Pro/Premium tier or x402 USDC)

| Tool | Description |
|------|-------------|
| `ai_forecast` | AI-powered 24h/7d price predictions |
| `monte_carlo_backtest` | Monte Carlo strategy backtesting |
| `slippage_estimate` | Trade slippage estimation |
| `create_alert` | Price/change alerts |

## Configuration

```typescript
const toolkit = new AssistantHubToolkit({
  apiKey: 'ahk_abc123',          // Hub API key or JWT
  baseUrl: 'https://rmassistanthub.io',  // default
  includePremium: true,           // include premium tools (default: true)
  tools: ['live_prices', 'fear_greed'],  // filter to specific tools
  maxRetries: 2,                  // retry on transient failures (default: 2)
  timeout: 30_000,                // request timeout in ms (default: 30s)
});
```

## Tool Metadata

Query tool info before calling — lets agents decide if they need to pay:

```typescript
const meta = toolkit.getToolMetadata('ai_forecast');
console.log(meta);
// {
//   hubToolId: 'ai_forecast',
//   name: 'assistant_hub_ai_forecast',
//   tierRequired: true,
//   dailyLimits: { anonymous: 10, free: 50, pro: 200, premium: 'unlimited' },
//   x402PriceUsdc: 0.01,
//   stakingDiscountPct: 50,
//   description: '...'
// }
```

## x402 Auto-Payment (USDC on Base)

Premium tools return HTTP 402 when payment is required. With x402 configured, the SDK auto-pays via USDC on Base and retries — zero friction for agents:

### Option A: BANKR Agent Wallet (easiest — no private key needed)

```typescript
const toolkit = new AssistantHubToolkit({
  apiKey: 'ahk_abc123',
  x402: {
    bankrApiKey: 'your-bankr-api-key',
    maxPerCallUsdc: 0.10,     // safety cap per call (default: $0.10)
    maxPerSessionUsdc: 1.00,  // safety cap per session (default: $1.00)
    verbose: true,            // log payments to console
  },
});

// Premium tools now auto-pay — no 402 errors!
const tools = toolkit.getTools();
```

### Option B: Custom Signer (viem, ethers, etc.)

```typescript
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';

const toolkit = new AssistantHubToolkit({
  apiKey: 'ahk_abc123',
  x402: {
    signer: async (payment) => {
      // Build and send USDC transfer, return tx hash
      const txHash = await sendUsdcTransfer(
        payment.recipientAddress,
        payment.amountUsdc
      );
      return txHash;
    },
  },
});
```

### Session Spend Tracking

```typescript
const handler = toolkit.x402;
if (handler) {
  console.log(`Session spend: $${handler.spent}`);
  handler.resetSession(); // Reset counter
}
```

## Error Handling

All errors extend `AssistantHubError` with actionable CTAs:

```typescript
import {
  AssistantHubError,
  AssistantHubRateLimitError,
  AssistantHubPaymentRequiredError,
  AssistantHubForbiddenError,
  AssistantHubServerError,
} from 'langchain-assistanthub';

try {
  await tool.invoke({ coin: 'BTC' });
} catch (e) {
  if (e instanceof AssistantHubRateLimitError) {
    console.log(e.detail);  // "Free tier: 10 calls/day limit reached."
    console.log(e.message); // Includes upgrade CTA
  }
}
```

## Telemetry

Anonymous, privacy-first telemetry ping on toolkit init (no PII, no IP logging).

**Opt out:**

```bash
export ASSISTANT_HUB_TELEMETRY_OPT_OUT=1
```

## Links

- [Assistant Hub](https://rmassistanthub.io) — Live platform
- [Documentation](https://rmassistanthub.io/docs#langchain) — Full API docs
- [Python SDK](https://pypi.org/project/langchain-assistanthub/) — `pip install langchain-assistanthub`
- [GitHub](https://github.com/redman4220/langchain-assistanthub-js) — Source code

## License

MIT — see [LICENSE](./LICENSE)
