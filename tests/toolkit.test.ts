import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  AssistantHubToolkit,
  AssistantHubClient,
  AssistantHubError,
  AssistantHubRateLimitError,
  AssistantHubPaymentRequiredError,
  AssistantHubForbiddenError,
  AssistantHubServerError,
  TOOL_REGISTRY,
  createTools,
} from "../src/index.js";

// ── Toolkit ──────────────────────────────────────────────────────

describe("AssistantHubToolkit", () => {
  beforeEach(() => {
    // Suppress telemetry in tests
    process.env.ASSISTANT_HUB_TELEMETRY_OPT_OUT = "1";
  });

  it("creates toolkit with default config", () => {
    const toolkit = new AssistantHubToolkit();
    expect(toolkit).toBeInstanceOf(AssistantHubToolkit);
  });

  it("creates toolkit from API key", () => {
    const toolkit = AssistantHubToolkit.fromApiKey("ahk_test123");
    expect(toolkit).toBeInstanceOf(AssistantHubToolkit);
  });

  it("fromEnv throws without env var", () => {
    delete process.env.ASSISTANT_HUB_API_KEY;
    expect(() => AssistantHubToolkit.fromEnv()).toThrow(
      "ASSISTANT_HUB_API_KEY not set"
    );
  });

  it("fromEnv works with env var", () => {
    process.env.ASSISTANT_HUB_API_KEY = "ahk_test";
    const toolkit = AssistantHubToolkit.fromEnv();
    expect(toolkit).toBeInstanceOf(AssistantHubToolkit);
    delete process.env.ASSISTANT_HUB_API_KEY;
  });

  it("getTools returns DynamicStructuredTool array", () => {
    const toolkit = new AssistantHubToolkit();
    const tools = toolkit.getTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBe(TOOL_REGISTRY.length);
  });

  it("getTools excludes premium when includePremium=false", () => {
    const toolkit = new AssistantHubToolkit({ includePremium: false });
    const tools = toolkit.getTools();
    const freeCount = TOOL_REGISTRY.filter((d) => !d.premium).length;
    expect(tools.length).toBe(freeCount);
  });

  it("getTools filters by tool names", () => {
    const toolkit = new AssistantHubToolkit({
      tools: ["live_prices", "fear_greed"],
    });
    const tools = toolkit.getTools();
    expect(tools.length).toBe(2);
  });

  it("availableTools lists all tool IDs", () => {
    const toolkit = new AssistantHubToolkit();
    expect(toolkit.availableTools).toContain("live_prices");
    expect(toolkit.availableTools).toContain("ai_forecast");
    expect(toolkit.availableTools.length).toBe(TOOL_REGISTRY.length);
  });

  it("availableTools excludes premium when disabled", () => {
    const toolkit = new AssistantHubToolkit({ includePremium: false });
    expect(toolkit.availableTools).toContain("live_prices");
    expect(toolkit.availableTools).not.toContain("ai_forecast");
  });
});

// ── Tool Metadata ────────────────────────────────────────────────

describe("getToolMetadata", () => {
  const toolkit = new AssistantHubToolkit();

  it("returns metadata for free tool by hubToolId", () => {
    const meta = toolkit.getToolMetadata("live_prices");
    expect(meta.hubToolId).toBe("live_prices");
    expect(meta.tierRequired).toBe(false);
    expect(meta.x402PriceUsdc).toBe(0.0);
    expect(meta.stakingDiscountPct).toBe(50);
  });

  it("returns metadata for premium tool", () => {
    const meta = toolkit.getToolMetadata("ai_forecast");
    expect(meta.hubToolId).toBe("ai_forecast");
    expect(meta.tierRequired).toBe(true);
    expect(meta.x402PriceUsdc).toBe(0.01);
  });

  it("returns metadata by full tool name", () => {
    const meta = toolkit.getToolMetadata("assistant_hub_live_prices");
    expect(meta.hubToolId).toBe("live_prices");
    expect(meta.name).toBe("assistant_hub_live_prices");
  });

  it("throws for unknown tool", () => {
    expect(() => toolkit.getToolMetadata("nonexistent")).toThrow(
      "Tool 'nonexistent' not found"
    );
  });

  it("includes daily limits", () => {
    const meta = toolkit.getToolMetadata("live_prices");
    expect(meta.dailyLimits.anonymous).toBe(10);
    expect(meta.dailyLimits.free).toBe(50);
    expect(meta.dailyLimits.pro).toBe(200);
    expect(meta.dailyLimits.premium).toBe("unlimited");
  });

  it("includes description", () => {
    const meta = toolkit.getToolMetadata("live_prices");
    expect(meta.description).toContain("cryptocurrency prices");
  });
});

// ── Exception Hierarchy ──────────────────────────────────────────

describe("Exception hierarchy", () => {
  it("AssistantHubError is base class", () => {
    const err = new AssistantHubError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AssistantHubError");
    expect(err.detail).toBeDefined();
  });

  it("RateLimitError extends AssistantHubError", () => {
    const err = new AssistantHubRateLimitError();
    expect(err).toBeInstanceOf(AssistantHubError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("Upgrade to Pro");
    expect(err.detail).toContain("10 calls/day");
  });

  it("PaymentRequiredError has x402 CTA", () => {
    const err = new AssistantHubPaymentRequiredError();
    expect(err).toBeInstanceOf(AssistantHubError);
    expect(err.message).toContain("x402");
  });

  it("ForbiddenError has login CTA", () => {
    const err = new AssistantHubForbiddenError();
    expect(err).toBeInstanceOf(AssistantHubError);
    expect(err.message).toContain("Login or upgrade");
  });

  it("ServerError has GitHub issues link", () => {
    const err = new AssistantHubServerError();
    expect(err).toBeInstanceOf(AssistantHubError);
    expect(err.message).toContain("github.com");
  });

  it("custom detail propagates", () => {
    const err = new AssistantHubRateLimitError("Custom limit message");
    expect(err.detail).toBe("Custom limit message");
    expect(err.message).toContain("Custom limit message");
  });
});

// ── Tool Registry ────────────────────────────────────────────────

describe("TOOL_REGISTRY", () => {
  it("has 9 tools", () => {
    expect(TOOL_REGISTRY.length).toBe(9);
  });

  it("has 5 free and 4 premium tools", () => {
    const free = TOOL_REGISTRY.filter((d) => !d.premium);
    const premium = TOOL_REGISTRY.filter((d) => d.premium);
    expect(free.length).toBe(5);
    expect(premium.length).toBe(4);
  });

  it("every tool has required fields", () => {
    for (const def of TOOL_REGISTRY) {
      expect(def.hubToolId).toBeTruthy();
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.endpoint).toBeTruthy();
      expect(["GET", "POST"]).toContain(def.method);
      expect(typeof def.premium).toBe("boolean");
    }
  });

  it("tool names follow snake_case convention", () => {
    for (const def of TOOL_REGISTRY) {
      expect(def.name).toMatch(/^assistant_hub_[a-z_]+$/);
    }
  });
});

// ── Client ───────────────────────────────────────────────────────

describe("AssistantHubClient", () => {
  it("creates client with defaults", () => {
    const client = new AssistantHubClient({});
    expect(client).toBeInstanceOf(AssistantHubClient);
  });

  it("creates client with API key", () => {
    const client = new AssistantHubClient({ apiKey: "ahk_test" });
    expect(client).toBeInstanceOf(AssistantHubClient);
  });

  it("creates client with JWT", () => {
    const client = new AssistantHubClient({ apiKey: "eyJhbGciOiJ..." });
    expect(client).toBeInstanceOf(AssistantHubClient);
  });
});

// ── createTools ──────────────────────────────────────────────────

describe("createTools", () => {
  it("creates all tools by default", () => {
    const client = new AssistantHubClient({});
    const tools = createTools(client);
    expect(tools.length).toBe(TOOL_REGISTRY.length);
  });

  it("excludes premium tools", () => {
    const client = new AssistantHubClient({});
    const tools = createTools(client, { includePremium: false });
    const freeCount = TOOL_REGISTRY.filter((d) => !d.premium).length;
    expect(tools.length).toBe(freeCount);
  });

  it("filters by tool IDs", () => {
    const client = new AssistantHubClient({});
    const tools = createTools(client, {
      toolFilter: new Set(["live_prices"]),
    });
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("assistant_hub_live_prices");
  });

  it("tools have name and description", () => {
    const client = new AssistantHubClient({});
    const tools = createTools(client);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
    }
  });
});

// ── Telemetry ────────────────────────────────────────────────────

describe("Telemetry", () => {
  it("respects ASSISTANT_HUB_TELEMETRY_OPT_OUT", () => {
    process.env.ASSISTANT_HUB_TELEMETRY_OPT_OUT = "1";
    // Should not throw — telemetry is suppressed
    const toolkit = new AssistantHubToolkit();
    expect(toolkit).toBeInstanceOf(AssistantHubToolkit);
  });
});
