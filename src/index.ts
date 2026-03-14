/**
 * langchain-assistanthub — Crypto Intelligence Toolkit for LangChain.js
 *
 * The easiest way to add real-time crypto intelligence to any
 * LangChain.js / LangGraph.js agent.
 *
 * @example
 * import { AssistantHubToolkit } from 'langchain-assistanthub';
 *
 * const toolkit = AssistantHubToolkit.fromApiKey('your-hub-api-key');
 * const tools = toolkit.getTools();
 *
 * // Plug into any LangGraph agent:
 * import { createReactAgent } from '@langchain/langgraph/prebuilt';
 * const agent = createReactAgent({ llm: model, tools });
 */

// Main toolkit
export { AssistantHubToolkit } from "./toolkit.js";

// HTTP client (for advanced usage)
export { AssistantHubClient } from "./client.js";
export type { ClientConfig } from "./client.js";

// Tool factory
export { createTools } from "./tools.js";

// Types & registry
export type { AssistantHubConfig, ToolDefinition, ToolMetadata } from "./types.js";
export { DEFAULT_CONFIG, TOOL_REGISTRY, ToolMetadataSchema } from "./types.js";

// Exceptions
export {
  AssistantHubError,
  AssistantHubForbiddenError,
  AssistantHubPaymentRequiredError,
  AssistantHubRateLimitError,
  AssistantHubServerError,
} from "./exceptions.js";
