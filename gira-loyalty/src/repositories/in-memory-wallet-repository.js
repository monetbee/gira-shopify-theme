import { IdempotencyConflictError } from '../domain/errors.js';

const key = (...parts) => parts.join(':');

/** Test double which implements the same locking transaction boundary expected
 * from the PostgreSQL repository. It serializes transactions deliberately. */
export class InMemoryWalletRepository {
  constructor() {
    this.balances = new Map();
    this.transactions = [];
    this.reservations = new Map();
    this._reservationSequence = 0;
    this._queue = Promise.resolve();
  }

  async transaction(fn) {
    const previous = this._queue;
    let release;
    this._queue = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await fn(this); } finally { release(); }
  }

  async lockBalance(shopId, customerId) {
    const balanceKey = key(shopId, customerId);
    const existing = this.balances.get(balanceKey);
    return structuredClone(existing ?? { shopId, customerId, availableSparks: 0, reservedSparks: 0, lockVersion: 0 });
  }

  async saveBalance(balance) {
    if (balance.availableSparks < 0 || balance.reservedSparks < 0) throw new Error('negative balance invariant');
    this.balances.set(key(balance.shopId, balance.customerId), { ...balance, lockVersion: balance.lockVersion + 1 });
  }

  async appendTransaction(transaction) {
    if (await this.findTransactionByIdempotencyKey(transaction.shopId, transaction.idempotencyKey)) {
      throw new IdempotencyConflictError(`duplicate idempotency key: ${transaction.idempotencyKey}`);
    }
    const record = { id: `txn_${this.transactions.length + 1}`, ...structuredClone(transaction) };
    this.transactions.push(record);
    return structuredClone(record);
  }

  async findTransactionByIdempotencyKey(shopId, idempotencyKey) {
    return structuredClone(this.transactions.find((item) => item.shopId === shopId && item.idempotencyKey === idempotencyKey) ?? null);
  }

  async createReservation(reservation) {
    if (await this.findReservationByIdempotencyKey(reservation.shopId, reservation.idempotencyKey)) {
      throw new IdempotencyConflictError(`duplicate reservation key: ${reservation.idempotencyKey}`);
    }
    const record = { id: `res_${++this._reservationSequence}`, ...structuredClone(reservation) };
    this.reservations.set(key(record.shopId, record.id), record);
    return structuredClone(record);
  }

  async findReservationByIdempotencyKey(shopId, idempotencyKey) {
    return structuredClone([...this.reservations.values()].find((item) => item.shopId === shopId && item.idempotencyKey === idempotencyKey) ?? null);
  }

  async lockReservation(shopId, reservationId) {
    const reservation = this.reservations.get(key(shopId, reservationId));
    if (!reservation) throw new Error('reservation not found');
    return structuredClone(reservation);
  }

  async setReservationStatus(shopId, reservationId, status, at, fields = {}) {
    const reservation = this.reservations.get(key(shopId, reservationId));
    if (!reservation) throw new Error('reservation not found');
    this.reservations.set(key(shopId, reservationId), { ...reservation, status, statusUpdatedAt: at, ...structuredClone(fields) });
  }
}
