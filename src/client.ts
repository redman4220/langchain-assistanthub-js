/**
 * HTTP client for Assistant Hub API.
 *
 * Handles authentication (JWT / API key), retries, typed error responses,
 * and optional x402 auto-payment for premium tools.
 */

import {
  AssistantHubForbiddenError,
  AssistantHubPaymentRequiredError,
  AssistantHubRateLimitError,
  AssistantHubServerError,
} from "./exceptions.js";
import { DEFAULT_CONFIG } from "./types.js";
import type { X402PaymentHandler } from "./x402.js";

export interface ClientConfig {
  apiKey: string;
  baseUrl: string;
  maxRetries: number;
  timeout: number;
}

export class AssistantHubClient {
  private readonly config: ClientConfig;
  private x402Handler: X402PaymentHandler | null = null;

  constructor(config: Partial<ClientConfig> & { apiKey?: string }) {
    this.config = {
      apiKey: config.apiKey ?? "",
      baseUrl: (config.baseUrl ?? DEFAULT_CONFIG.baseUrl).replace(/\/+$/, ""),
      maxRetries: config.maxRetries ?? DEFAULT_CONFIG.maxRetries,
      timeout: config.timeout ?? DEFAULT_CONFIG.timeout,
    };
  }

  /** Attach an x402 payment handler for auto-paying premium tool calls. */
  setX402Handler(handler: X402PaymentHandler): void {
    this.x402Handler = handler;
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...extra,
    };

    if (this.config.apiKey) {
      if (this.config.apiKey.startsWith("ahk_")) {
        headers["X-API-Key"] = this.config.apiKey;
      } else {
        headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      }
    }

    return headers;
  }

  async request(
    method: "GET" | "POST",
    path: string,
    options?: {
      params?: Record<string, string>;
      body?: Record<string, unknown>;
      toolId?: string;
    }
  ): Promise<unknown> {
    const headers = this.buildHeaders();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        let url = `${this.config.baseUrl}${path}`;

        if (options?.params) {
          const searchParams = new URLSearchParams(options.params);
          url += `?${searchParams.toString()}`;
        }

        const fetchOptions: RequestInit = {
          method,
          headers,
          signal: AbortSignal.timeout(this.config.timeout),
        };

        if (options?.body && method === "POST") {
          fetchOptions.body = JSON.stringify(options.body);
        }

        const resp = await fetch(url, fetchOptions);

        if (resp.status === 402) {
          // Try x402 auto-payment if configured
          if (this.x402Handler?.isConfigured) {
            return await this.handleX402Payment(resp, url, fetchOptions, options?.toolId);
          }
          const detail = await this.extractDetail(resp, "Premium tool requires payment.");
          throw new AssistantHubPaymentRequiredError(detail);
        }

        if (resp.status === 403) {
          const detail = await this.extractDetail(resp, "Access forbidden.");
          throw new AssistantHubForbiddenError(detail);
        }

        if (resp.status === 429) {
          if (attempt < this.config.maxRetries) {
            await this.sleep(2 ** attempt * 1000);
            continue;
          }
          const detail = await this.extractDetail(resp, "Rate limit exceeded.");
          throw new AssistantHubRateLimitError(detail);
        }

        if (resp.status >= 500) {
          const detail = await this.extractDetail(resp, "Internal server error.");
          throw new AssistantHubServerError(detail);
        }

        if (!resp.ok) {
          const text = await resp.text();
          return { error: `http_${resp.status}`, message: text.slice(0, 500) };
        }

        return await resp.json();
      } catch (e) {
        // Re-throw our custom errors immediately
        if (
          e instanceof AssistantHubPaymentRequiredError ||
          e instanceof AssistantHubForbiddenError ||
          e instanceof AssistantHubRateLimitError ||
          e instanceof AssistantHubServerError
        ) {
          throw e;
        }

        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < this.config.maxRetries) {
          await this.sleep(2 ** attempt * 1000);
          continue;
        }
      }
    }

    return { error: "connection_failed", message: lastError?.message ?? "Unknown error" };
  }

  // ── x402 auto-payment ───────────────────────────────────────────

  private async handleX402Payment(
    resp402: Response,
    url: string,
    originalFetchOptions: RequestInit,
    toolId?: string
  ): Promise<unknown> {
    let body: Record<string, unknown> = {};
    try {
      body = (await resp402.json()) as Record<string, unknown>;
    } catch {
      // No JSON body — use header-only payment info
    }

    const payment = this.x402Handler!.parsePaymentRequest(
      resp402,
      body,
      toolId ?? "unknown_tool"
    );

    // Execute payment
    const receipt = await this.x402Handler!.pay(payment);

    // Retry original request with payment receipt
    const retryHeaders = this.buildHeaders({
      "X-Payment-Receipt": receipt.txHash,
      "X-Payment-Amount": String(receipt.amountUsdc),
      "X-Payment-Chain": receipt.chain,
    });

    const retryOptions: RequestInit = {
      ...originalFetchOptions,
      headers: retryHeaders,
    };

    const retryResp = await fetch(url, retryOptions);

    if (!retryResp.ok) {
      const detail = await this.extractDetail(
        retryResp,
        `Payment sent (${receipt.txHash}) but request still failed (${retryResp.status}).`
      );
      throw new AssistantHubPaymentRequiredError(detail);
    }

    return await retryResp.json();
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private async extractDetail(resp: Response, fallback: string): Promise<string> {
    try {
      const body = (await resp.json()) as Record<string, unknown>;
      return String(body.detail ?? body.error ?? fallback);
    } catch {
      return fallback;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
