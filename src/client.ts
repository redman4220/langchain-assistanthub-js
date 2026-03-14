/**
 * HTTP client for Assistant Hub API.
 *
 * Handles authentication (JWT / API key), retries, and typed error responses.
 */

import {
  AssistantHubForbiddenError,
  AssistantHubPaymentRequiredError,
  AssistantHubRateLimitError,
  AssistantHubServerError,
} from "./exceptions.js";
import { DEFAULT_CONFIG } from "./types.js";

export interface ClientConfig {
  apiKey: string;
  baseUrl: string;
  maxRetries: number;
  timeout: number;
}

export class AssistantHubClient {
  private readonly config: ClientConfig;

  constructor(config: Partial<ClientConfig> & { apiKey?: string }) {
    this.config = {
      apiKey: config.apiKey ?? "",
      baseUrl: (config.baseUrl ?? DEFAULT_CONFIG.baseUrl).replace(/\/+$/, ""),
      maxRetries: config.maxRetries ?? DEFAULT_CONFIG.maxRetries,
      timeout: config.timeout ?? DEFAULT_CONFIG.timeout,
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
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
