/** A request the rules refuse. The message is written for the person who made it. */
export class DomainError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const invalid = (message: string): DomainError => new DomainError("INVALID_INPUT", message);
export const notFound = (message: string): DomainError => new DomainError("NOT_FOUND", message);
