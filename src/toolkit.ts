/**
 * AssistantHubToolkit — main entry point for LangChain.js integration.
 *
 * Usage:
 *   import { AssistantHubToolkit } from 'langchain-assistanthub';
 *   const toolkit = AssistantHubToolkit.fromApiKey('your-hub-api-key');
 *   const tools = toolkit.getTools();
 */

import type { DynamicStructuredTool } from "@langchain/core/tools";
import { AssistantHubClient } from "./client.js";
import { createTools } from "./tools.js";
import type {
  AssistantHubConfig,
  ToolDefinition,
  ToolMetadata,
} from "./types.js";
import { DEFAULT_CONFIG, TOOL_REGISTRY } from "./types.js";
import { X402PaymentHandler } from "./x402.js";
import type { X402Config } from "./x402.js";

export class AssistantHubToolkit {
  private readonly client: AssistantHubClient;
  private readonly config: Required<
    Pick<AssistantHubConfig, "includePremium" | "baseUrl">
  > & { toolFilter?: Set<string> };
  private readonly x402Handler: X402PaymentHandler | null;

  constructor(config: AssistantHubConfig = {}) {
    this.client = new AssistantHubClient({
      apiKey: config.apiKey ?? process.env.ASSISTANT_HUB_API_KEY ?? "",
      baseUrl: config.baseUrl ?? DEFAULT_CONFIG.baseUrl,
      maxRetries: config.maxRetries ?? DEFAULT_CONFIG.maxRetries,
      timeout: config.timeout ?? DEFAULT_CONFIG.timeout,
    });

    this.config = {
      baseUrl: (config.baseUrl ?? DEFAULT_CONFIG.baseUrl).replace(/\/+$/, ""),
      includePremium: config.includePremium ?? DEFAULT_CONFIG.includePremium,
      toolFilter: config.tools ? new Set(config.tools) : undefined,
    };

    // Wire up x402 auto-payment if configured
    if (config.x402) {
      this.x402Handler = new X402PaymentHandler(config.x402);
      // Pass telemetry context so payment events can be tracked
      const anonId = Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      this.x402Handler.setContext(this.config.baseUrl, anonId, "0.1.4");
      this.client.setX402Handler(this.x402Handler);
    } else {
      this.x402Handler = null;
    }

    // Fire-and-forget telemetry ping
    this.sendTelemetry(config.apiKey).catch(() => {});
  }

  // ── Factory methods ─────────────────────────────────────────────

  /**
   * Create toolkit from a Hub API key (JWT or ahk_* key).
   *
   * @example
   * const toolkit = AssistantHubToolkit.fromApiKey('ahk_abc123');
   * const tools = toolkit.getTools();
   */
  static fromApiKey(
    apiKey: string,
    config?: Omit<AssistantHubConfig, "apiKey">
  ): AssistantHubToolkit {
    return new AssistantHubToolkit({ ...config, apiKey });
  }

  /**
   * Create toolkit from ASSISTANT_HUB_API_KEY env var.
   *
   * @example
   * process.env.ASSISTANT_HUB_API_KEY = 'ahk_abc123';
   * const toolkit = AssistantHubToolkit.fromEnv();
   */
  static fromEnv(
    config?: Omit<AssistantHubConfig, "apiKey">
  ): AssistantHubToolkit {
    const apiKey = process.env.ASSISTANT_HUB_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ASSISTANT_HUB_API_KEY not set. Get your key at https://rmassistanthub.io/#payments"
      );
    }
    return new AssistantHubToolkit({ ...config, apiKey });
  }

  /**
   * Create toolkit by logging in with email/password.
   * Returns the toolkit with the JWT token from login.
   *
   * @example
   * const toolkit = await AssistantHubToolkit.fromLogin('user@example.com', 'pass');
   */
  static async fromLogin(
    email: string,
    password: string,
    config?: Omit<AssistantHubConfig, "apiKey">
  ): Promise<AssistantHubToolkit> {
    const baseUrl = (config?.baseUrl ?? DEFAULT_CONFIG.baseUrl).replace(
      /\/+$/,
      ""
    );
    const resp = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!resp.ok) {
      let detail: string;
      try {
        const body = (await resp.json()) as Record<string, unknown>;
        detail = String(body.error ?? body.detail ?? `HTTP ${resp.status}`);
      } catch {
        detail = `HTTP ${resp.status}`;
      }
      throw new Error(
        `Login failed: ${detail}. Check credentials or sign up at https://rmassistanthub.io`
      );
    }

    const data = (await resp.json()) as Record<string, unknown>;
    const token = data.token as string | undefined;
    if (!token) {
      throw new Error("Login response missing token. Check API version.");
    }

    return new AssistantHubToolkit({ ...config, apiKey: token, baseUrl });
  }

  /**
   * Auto-discover tools via MCP protocol (requires @langchain/mcp-adapters).
   *
   * Returns raw LangChain tools from the MCP server — useful when the
   * server adds tools not yet in this package.
   *
   * @example
   * const tools = await AssistantHubToolkit.fromMcp({ apiKey: 'ahk_abc123' });
   */
  static async fromMcp(config?: {
    url?: string;
    apiKey?: string;
  }): Promise<DynamicStructuredTool[]> {
    // Dynamic import — only loads if @langchain/mcp-adapters is installed
    const { MultiServerMCPClient } = await import("@langchain/mcp-adapters");

    const url = config?.url ?? "https://rmassistanthub.io/mcp";
    const headers: Record<string, string> = {};
    if (config?.apiKey) {
      if (config.apiKey.startsWith("ahk_")) {
        headers["X-API-Key"] = config.apiKey;
      } else {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
      }
    }

    const client = new MultiServerMCPClient({
      "assistant-hub": {
        transport: "streamable-http",
        url,
        headers,
      } as Record<string, unknown>,
    });

    const tools = await client.getTools();
    return tools as unknown as DynamicStructuredTool[];
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Return all LangChain DynamicStructuredTools.
   *
   * @example
   * const tools = toolkit.getTools();
   * // Pass to create_react_agent, AgentExecutor, etc.
   */
  getTools(): DynamicStructuredTool[] {
    return createTools(this.client, {
      includePremium: this.config.includePremium,
      toolFilter: this.config.toolFilter,
    });
  }

  /**
   * Get metadata for a specific tool: tier, daily limits, x402 price.
   *
   * Lets agents self-query "is this premium? do I need to pay?"
   * before invoking a tool.
   *
   * @example
   * const meta = toolkit.getToolMetadata('ai_forecast');
   * if (meta.tierRequired) {
   *   console.log(`Premium — x402 price: $${meta.x402PriceUsdc}`);
   * }
   */
  getToolMetadata(toolName: string): ToolMetadata {
    for (const def of TOOL_REGISTRY) {
      if (toolName !== def.hubToolId && toolName !== def.name) {
        continue;
      }
      if (def.premium && !this.config.includePremium) {
        continue;
      }

      return {
        hubToolId: def.hubToolId,
        name: def.name,
        tierRequired: def.premium,
        dailyLimits: {
          anonymous: 10,
          free: 50,
          pro: 200,
          premium: "unlimited",
        },
        x402PriceUsdc: def.premium ? 0.01 : 0.0,
        stakingDiscountPct: 50,
        description: def.description,
      };
    }

    const available = TOOL_REGISTRY.map((d) => d.hubToolId);
    throw new Error(
      `Tool '${toolName}' not found. Available: ${available.join(", ")}`
    );
  }

  /**
   * List all available tool IDs.
   */
  get availableTools(): string[] {
    return TOOL_REGISTRY.filter(
      (d) => !d.premium || this.config.includePremium
    ).map((d) => d.hubToolId);
  }

  /**
   * Get the x402 payment handler (if configured).
   * Useful for checking session spend or resetting the counter.
   *
   * @example
   * const handler = toolkit.x402;
   * if (handler) {
   *   console.log(`Session spend: $${handler.spent}`);
   *   handler.resetSession();
   * }
   */
  get x402(): X402PaymentHandler | null {
    return this.x402Handler;
  }

  // ── Private ─────────────────────────────────────────────────────

  private async sendTelemetry(apiKey?: string): Promise<void> {
    if (process.env.ASSISTANT_HUB_TELEMETRY_OPT_OUT) return;

    try {
      const anonId = Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      await fetch(`${this.config.baseUrl}/api/telemetry/toolkit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "init",
          version: "0.1.4",
          platform: "javascript",
          anon_id: anonId,
          auth_type: apiKey ? "api_key" : "anonymous",
        }),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      // Telemetry is fire-and-forget
    }
  }
}
