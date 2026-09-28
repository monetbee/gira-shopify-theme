export class WalletError extends Error {}
export class ValidationError extends WalletError {}
export class InsufficientBalanceError extends WalletError {}
export class IdempotencyConflictError extends WalletError {}
