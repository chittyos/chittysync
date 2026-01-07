/// <reference lib="ES2022" />
/// <reference lib="WebWorker" />

// Cloudflare Workers specific types
export interface ScheduledEvent {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Augment global scope
declare global {
  // Crypto API (available in CF Workers)
  const crypto: Crypto;

  // Console (available in CF Workers)
  const console: Console;

  // TextEncoder/TextDecoder (available in CF Workers)
  const TextEncoder: typeof globalThis.TextEncoder;
  const TextDecoder: typeof globalThis.TextDecoder;

  // btoa/atob (available in CF Workers)
  function btoa(data: string): string;
  function atob(data: string): string;

  // Fetch API (available in CF Workers)
  const fetch: typeof globalThis.fetch;
  const Request: typeof globalThis.Request;
  const Response: typeof globalThis.Response;
  const Headers: typeof globalThis.Headers;
}
