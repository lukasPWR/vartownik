/** Rate limit exceeded for generation batches. */
export class RateLimitError extends Error {
  constructor(message = "Too many generation requests. Please wait and try again.") {
    super(message);
    this.name = "RateLimitError";
  }
}

/** Upstream AI provider HTTP error (non-2xx response or network failure). */
export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "AiProviderError";
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

/** The requested resource does not exist or is not accessible by the current user. */
export class NotFoundError extends Error {
  constructor(message = "Resource not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Generation batch does not exist or belongs to a different user. */
export class BatchNotFoundError extends Error {
  constructor(message = "Generation batch not found.") {
    super(message);
    this.name = "BatchNotFoundError";
  }
}

/** Generation batch exists but its status is not "success". */
export class BatchNotSuccessError extends Error {
  constructor(message = "Generation batch is not completed successfully.") {
    super(message);
    this.name = "BatchNotSuccessError";
  }
}

/** Request is syntactically valid but violates business rules (e.g. invalid state transition). */
export class BadRequestError extends Error {
  constructor(message = "Bad request.") {
    super(message);
    this.name = "BadRequestError";
  }
}

/** Request payload or referenced data is structurally invalid for the requested operation. */
export class UnprocessableEntityError extends Error {
  constructor(message = "Unprocessable entity.") {
    super(message);
    this.name = "UnprocessableEntityError";
  }
}

export type GenerationGuardrailErrorCode =
  | "admission_rejected"
  | "deadline_exceeded"
  | "client_cancelled"
  | "budget_exhausted"
  | "persistence_failed";

/** A generation request does not match the allowlisted production contract. */
export class GenerationAdmissionError extends Error {
  readonly code = "admission_rejected" as const;

  constructor(message = "Generation request was rejected by the admission policy.") {
    super(message);
    this.name = "GenerationAdmissionError";
  }
}

/** The aggregate generation deadline elapsed before the batch completed. */
export class GenerationDeadlineError extends Error {
  readonly code = "deadline_exceeded" as const;

  constructor(message = "Generation deadline exceeded.") {
    super(message);
    this.name = "GenerationDeadlineError";
  }
}

/** The caller cancelled generation before the batch completed. */
export class GenerationCancelledError extends Error {
  readonly code = "client_cancelled" as const;

  constructor(message = "Generation was cancelled.") {
    super(message);
    this.name = "GenerationCancelledError";
  }
}

/** A batch would exceed, or has exhausted, one of its execution budgets. */
export class GenerationBudgetExceededError extends Error {
  readonly code = "budget_exhausted" as const;

  constructor(message = "Generation budget exhausted.") {
    super(message);
    this.name = "GenerationBudgetExceededError";
  }
}

/** A durable generation lifecycle transition could not be persisted. */
export class GenerationPersistenceError extends Error {
  readonly code = "persistence_failed" as const;

  constructor(message = "Generation state could not be persisted.") {
    super(message);
    this.name = "GenerationPersistenceError";
  }
}
