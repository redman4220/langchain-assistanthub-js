/**
 * Exception hierarchy for Assistant Hub toolkit.
 *
 * Each error includes an actionable CTA so agents and UIs
 * surface a clear path to resolution.
 */

export class AssistantHubError extends Error {
  public detail: string;

  constructor(message = "An error occurred with Assistant Hub.") {
    super(message);
    this.name = "AssistantHubError";
    this.detail = message;
  }
}

export class AssistantHubRateLimitError extends AssistantHubError {
  constructor(detail = "Free tier: 10 calls/day limit reached.") {
    super(
      `${detail} Upgrade to Pro ($1/mo) or stake HUB for 50% off: https://rmassistanthub.io/#payments`
    );
    this.name = "AssistantHubRateLimitError";
    this.detail = detail;
  }
}

export class AssistantHubPaymentRequiredError extends AssistantHubError {
  constructor(detail = "Payment required for this premium tool.") {
    super(
      `${detail} Use x402 USDC on Base or upgrade tier: https://rmassistanthub.io/docs#x402`
    );
    this.name = "AssistantHubPaymentRequiredError";
    this.detail = detail;
  }
}

export class AssistantHubForbiddenError extends AssistantHubError {
  constructor(detail = "Access forbidden — check tier or auth.") {
    super(
      `${detail} Login or upgrade: https://rmassistanthub.io/#payments`
    );
    this.name = "AssistantHubForbiddenError";
    this.detail = detail;
  }
}

export class AssistantHubServerError extends AssistantHubError {
  constructor(detail = "Server error — try again later.") {
    super(
      `${detail} If this persists, report at: https://github.com/redman4220/langchain-assistanthub-js/issues`
    );
    this.name = "AssistantHubServerError";
    this.detail = detail;
  }
}
