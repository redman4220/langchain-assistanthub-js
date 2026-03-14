/**
 * x402 Auto-Payment Module — USDC micropayments for premium tools.
 *
 * When a tool call returns HTTP 402, this module can automatically
 * pay via USDC on Base and retry the request.
 *
 * Two payment modes:
 *   1. BANKR API — uses BANKR agent wallet (server-side, no private key needed)
 *   2. Custom signer — you provide a callback that returns a tx hash
 *
 * @example
 * // Mode 1: BANKR (easiest)
 * const toolkit = new AssistantHubToolkit({
 *   apiKey: 'ahk_abc123',
 *   x402: { bankrApiKey: 'your-bankr-key' },
 * });
 *
 * // Mode 2: Custom signer (e.g., viem/ethers)
 * const toolkit = new AssistantHubToolkit({
 *   apiKey: 'ahk_abc123',
 *   x402: {
 *     signer: async (payment) => {
 *       // Build + sign USDC transfer, return tx hash
 *       return '0xabc123...';
 *     },
 *   },
 * });
 */

// ── Types ─────────────────────────────────────────────────────────

/** Payment details extracted from a 402 response. */
export interface X402PaymentRequest {
  /** Amount in USDC (e.g., 0.01) */
  amountUsdc: number;
  /** Recipient wallet address */
  recipientAddress: string;
  /** Chain name (e.g., "base") */
  chain: string;
  /** Tool that triggered the payment */
  toolId: string;
  /** Human-readable description */
  description: string;
}

/** Receipt after a successful payment. */
export interface X402PaymentReceipt {
  /** Transaction hash on-chain */
  txHash: string;
  /** Amount paid in USDC */
  amountUsdc: number;
  /** Chain the payment was made on */
  chain: string;
}

/** Custom signer function — return a tx hash after paying. */
export type X402Signer = (payment: X402PaymentRequest) => Promise<string>;

/** x402 configuration options. */
export interface X402Config {
  /** BANKR API key — uses BANKR agent wallet for auto-payment. */
  bankrApiKey?: string;
  /** Custom signer function (e.g., viem/ethers wallet). Takes priority over BANKR. */
  signer?: X402Signer;
  /** Maximum USDC to auto-pay per call (default: 0.10). Safety cap. */
  maxPerCallUsdc?: number;
  /** Maximum USDC to auto-pay per session (default: 1.00). Safety cap. */
  maxPerSessionUsdc?: number;
  /** If true, log payment details to console (default: false). */
  verbose?: boolean;
}

// ── Default payment wallet (Assistant Hub) ────────────────────────

const PAYMENT_WALLET = "0xb21bed8c8338b943912f3c2fc2a84c9b883a3776";
const USDC_BASE_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_CHAIN_ID = 8453;
const BANKR_API_URL = "https://api.bankr.bot";

// ── Payment handler ───────────────────────────────────────────────

export class X402PaymentHandler {
  private readonly config: X402Config;
  private sessionSpent = 0;
  private baseUrl = "https://rmassistanthub.io";
  private anonId = "";
  private sdkVersion = "0.1.4";

  constructor(config: X402Config) {
    this.config = {
      maxPerCallUsdc: 0.10,
      maxPerSessionUsdc: 1.00,
      verbose: false,
      ...config,
    };
  }

  get isConfigured(): boolean {
    return !!(this.config.signer || this.config.bankrApiKey);
  }

  /**
   * Parse a 402 response into a payment request.
   * Falls back to sensible defaults if headers are missing.
   */
  parsePaymentRequest(
    resp: Response,
    body: Record<string, unknown>,
    toolId = "unknown"
  ): X402PaymentRequest {
    return {
      amountUsdc: Number(
        resp.headers.get("X-Payment-Amount") ??
        body.x402_amount ??
        body.price_usdc ??
        0.01
      ),
      recipientAddress: String(
        resp.headers.get("X-Payment-Address") ??
        body.x402_address ??
        PAYMENT_WALLET
      ),
      chain: String(
        resp.headers.get("X-Payment-Chain") ??
        body.x402_chain ??
        "base"
      ),
      toolId,
      description: `x402 payment for ${toolId}`,
    };
  }

  /**
   * Execute payment and return a receipt.
   * Uses custom signer if provided, otherwise falls back to BANKR.
   */
  async pay(payment: X402PaymentRequest): Promise<X402PaymentReceipt> {
    // Safety checks
    const maxPerCall = this.config.maxPerCallUsdc ?? 0.10;
    const maxPerSession = this.config.maxPerSessionUsdc ?? 1.00;

    if (payment.amountUsdc > maxPerCall) {
      throw new Error(
        `x402: Payment $${payment.amountUsdc} exceeds maxPerCallUsdc ($${maxPerCall}). ` +
        `Increase limit or pay manually.`
      );
    }

    if (this.sessionSpent + payment.amountUsdc > maxPerSession) {
      throw new Error(
        `x402: Session spending would reach $${(this.sessionSpent + payment.amountUsdc).toFixed(4)} ` +
        `(limit: $${maxPerSession}). Increase maxPerSessionUsdc or start a new session.`
      );
    }

    if (this.config.verbose) {
      console.log(
        `[x402] Paying $${payment.amountUsdc} USDC for ${payment.toolId} → ${payment.recipientAddress}`
      );
    }

    let txHash: string;

    if (this.config.signer) {
      // Custom signer takes priority
      txHash = await this.config.signer(payment);
    } else if (this.config.bankrApiKey) {
      // BANKR agent wallet
      txHash = await this.payViaBankr(payment);
    } else {
      throw new Error("x402: No signer or BANKR API key configured.");
    }

    this.sessionSpent += payment.amountUsdc;

    if (this.config.verbose) {
      console.log(
        `[x402] Payment confirmed: ${txHash} ($${this.sessionSpent.toFixed(4)} spent this session)`
      );
    }

    const receipt: X402PaymentReceipt = {
      txHash,
      amountUsdc: payment.amountUsdc,
      chain: payment.chain,
    };

    // Fire-and-forget x402 telemetry
    this.sendX402Telemetry(payment, receipt).catch(() => {});

    return receipt;
  }

  /** Set context for telemetry (called by toolkit). */
  setContext(baseUrl: string, anonId: string, version: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.anonId = anonId;
    this.sdkVersion = version;
  }

  /** Current session spend total in USDC. */
  get spent(): number {
    return this.sessionSpent;
  }

  /** Reset session spending counter. */
  resetSession(): void {
    this.sessionSpent = 0;
  }

  // ── BANKR payment flow ────────────────────────────────────────

  private async payViaBankr(payment: X402PaymentRequest): Promise<string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-API-Key": this.config.bankrApiKey!,
    };

    // Step 1: Ask BANKR to prepare a USDC transfer
    const prompt = `Send ${payment.amountUsdc} USDC to ${payment.recipientAddress} on Base. This is an x402 micropayment for tool access.`;

    const promptRes = await fetch(`${BANKR_API_URL}/agent/prompt`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt }),
    });

    if (!promptRes.ok) {
      const text = await promptRes.text();
      throw new Error(`x402 BANKR prompt failed (${promptRes.status}): ${text}`);
    }

    const { jobId } = (await promptRes.json()) as { jobId: string; threadId: string };

    // Step 2: Poll for completion
    const maxPolls = 30;
    const pollInterval = 2000;

    for (let i = 0; i < maxPolls; i++) {
      const pollRes = await fetch(`${BANKR_API_URL}/agent/job/${jobId}`, { headers });

      if (!pollRes.ok) {
        throw new Error(`x402 BANKR poll failed (${pollRes.status})`);
      }

      const job = (await pollRes.json()) as {
        status: string;
        transactions?: { metadata: { hash?: string } }[];
        error?: string;
      };

      if (job.status === "completed") {
        const txHash = job.transactions?.[0]?.metadata?.hash;
        if (!txHash) {
          throw new Error("x402 BANKR: Payment completed but no tx hash returned.");
        }
        return txHash;
      }

      if (job.status === "failed" || job.status === "cancelled") {
        throw new Error(`x402 BANKR payment ${job.status}: ${job.error || "unknown error"}`);
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    throw new Error("x402 BANKR: Payment timed out (60s).");
  }

  // ── x402 telemetry ──────────────────────────────────────────────

  private async sendX402Telemetry(
    payment: X402PaymentRequest,
    receipt: X402PaymentReceipt
  ): Promise<void> {
    if (process.env.ASSISTANT_HUB_TELEMETRY_OPT_OUT) return;
    try {
      await fetch(`${this.baseUrl}/api/telemetry/x402`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          anon_id: this.anonId,
          platform: "javascript",
          version: this.sdkVersion,
          tool_id: payment.toolId,
          amount_usdc: receipt.amountUsdc,
          tx_hash: receipt.txHash,
          chain: receipt.chain,
          success: true,
        }),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      // Fire-and-forget — never block
    }
  }
}
