/** Rate limit exceeded for generation batches. */
export class RateLimitError extends Error {
  constructor(message = "Too many generation requests. Please wait and try again.") {
    super(message);
    this.name = "RateLimitError";
  }
}

/** Upstream OpenRouter HTTP error (non-2xx response or network failure). */
export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

/** AI returned invalid/unparseable JSON after exhausting all retries. */
export class AiParseError extends Error {
  constructor(message = "AI returned an invalid response after maximum retries.") {
    super(message);
    this.name = "AiParseError";
  }
}

/** User has reached their question storage limit. */
export class StorageLimitError extends Error {
  constructor(message = "Question storage limit reached.") {
    super(message);
    this.name = "StorageLimitError";
  }
}

/** A resource with the same unique key already exists. */
export class ConflictError extends Error {
  constructor(message = "A resource with this identifier already exists.") {
    super(message);
    this.name = "ConflictError";
  }
}
