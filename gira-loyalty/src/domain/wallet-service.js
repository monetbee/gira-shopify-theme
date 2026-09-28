import {
  MINIMUM_REDEMPTION_SPARKS,
  REDEMPTION_INCREMENT_SPARKS,
  ReservationStatus,
  WalletTransactionKind,
} from './constants.js';
import { InsufficientBalanceError, ValidationError } from './errors.js';

function assertPositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive safe integer`);
  }
}

/**
 * All methods execute inside repository.transaction(), which must lock the
 * customer wallet row before it reads or mutates a balance.
 */
export class WalletService {
  constructor(repository, { now = () => new Date() } = {}) {
    this.repository = repository;
    this.now = now;
  }

  async grant({ shopId, customerId, sparks, kind, idempotencyKey, reference = {} }) {
    assertPositiveInteger(sparks, 'sparks');
    if (!idempotencyKey) throw new ValidationError('idempotencyKey is required');
    return this.repository.transaction(async (tx) => {
      const duplicate = await tx.findTransactionByIdempotencyKey(shopId, idempotencyKey);
      if (duplicate) return { transaction: duplicate, idempotent: true };
      const balance = await tx.lockBalance(shopId, customerId);
      const next = { ...balance, availableSparks: balance.availableSparks + sparks };
      await tx.saveBalance(next);
      const transaction = await tx.appendTransaction({
        shopId, customerId, kind, deltaAvailable: sparks, deltaReserved: 0,
        balanceAfterAvailable: next.availableSparks, balanceAfterReserved: next.reservedSparks,
        idempotencyKey, reference, createdAt: this.now(),
      });
      return { transaction, idempotent: false };
    });
  }

  async reserveRedemption({ shopId, customerId, sparks, idempotencyKey, expiresAt, cartFingerprint }) {
    assertPositiveInteger(sparks, 'sparks');
    if (sparks < MINIMUM_REDEMPTION_SPARKS || sparks % REDEMPTION_INCREMENT_SPARKS !== 0) {
      throw new ValidationError(`redemption must be at least ${MINIMUM_REDEMPTION_SPARKS} and divisible by ${REDEMPTION_INCREMENT_SPARKS}`);
    }
    if (!(expiresAt instanceof Date) || expiresAt <= this.now()) throw new ValidationError('expiresAt must be in the future');
    if (!idempotencyKey || !cartFingerprint) throw new ValidationError('idempotencyKey and cartFingerprint are required');

    return this.repository.transaction(async (tx) => {
      const existing = await tx.findReservationByIdempotencyKey(shopId, idempotencyKey);
      if (existing) return { reservation: existing, idempotent: true };
      const balance = await tx.lockBalance(shopId, customerId);
      if (balance.availableSparks < sparks) throw new InsufficientBalanceError('insufficient available SPARKS');
      const next = {
        ...balance,
        availableSparks: balance.availableSparks - sparks,
        reservedSparks: balance.reservedSparks + sparks,
      };
      await tx.saveBalance(next);
      const reservation = await tx.createReservation({
        shopId, customerId, sparks, requestedDiscountMinor: sparks / REDEMPTION_INCREMENT_SPARKS,
        currency: 'JPY', status: ReservationStatus.PENDING, idempotencyKey,
        expiresAt, cartFingerprint, createdAt: this.now(),
      });
      await tx.appendTransaction({
        shopId, customerId, kind: WalletTransactionKind.REDEMPTION_RESERVED,
        deltaAvailable: -sparks, deltaReserved: sparks,
        balanceAfterAvailable: next.availableSparks, balanceAfterReserved: next.reservedSparks,
        idempotencyKey: `reserve:${reservation.id}`, reference: { reservationId: reservation.id }, createdAt: this.now(),
      });
      return { reservation, idempotent: false };
    });
  }

  async releaseReservation({ shopId, reservationId, idempotencyKey, reason = 'released' }) {
    if (!idempotencyKey) throw new ValidationError('idempotencyKey is required');
    return this.repository.transaction(async (tx) => {
      const duplicate = await tx.findTransactionByIdempotencyKey(shopId, idempotencyKey);
      if (duplicate) return { transaction: duplicate, idempotent: true };
      const reservation = await tx.lockReservation(shopId, reservationId);
      if ([ReservationStatus.RELEASED, ReservationStatus.EXPIRED, ReservationStatus.CANCELLED].includes(reservation.status)) {
        return { reservation, idempotent: true };
      }
      if (reservation.status === ReservationStatus.CONSUMED) throw new ValidationError('consumed reservation cannot be released');
      const balance = await tx.lockBalance(shopId, reservation.customerId);
      const next = {
        ...balance,
        availableSparks: balance.availableSparks + reservation.sparks,
        reservedSparks: balance.reservedSparks - reservation.sparks,
      };
      await tx.saveBalance(next);
      const status = reason === 'expired' ? ReservationStatus.EXPIRED : ReservationStatus.RELEASED;
      await tx.setReservationStatus(shopId, reservationId, status, this.now());
      const transaction = await tx.appendTransaction({
        shopId, customerId: reservation.customerId, kind: WalletTransactionKind.REDEMPTION_RELEASED,
        deltaAvailable: reservation.sparks, deltaReserved: -reservation.sparks,
        balanceAfterAvailable: next.availableSparks, balanceAfterReserved: next.reservedSparks,
        idempotencyKey, reference: { reservationId, reason }, createdAt: this.now(),
      });
      return { transaction, idempotent: false };
    });
  }

  async consumeReservation({ shopId, reservationId, consumedSparks, idempotencyKey, orderId }) {
    assertPositiveInteger(consumedSparks, 'consumedSparks');
    if (!idempotencyKey || !orderId) throw new ValidationError('idempotencyKey and orderId are required');
    return this.repository.transaction(async (tx) => {
      const duplicate = await tx.findTransactionByIdempotencyKey(shopId, idempotencyKey);
      if (duplicate) return { transaction: duplicate, idempotent: true };
      const reservation = await tx.lockReservation(shopId, reservationId);
      if (reservation.status === ReservationStatus.CONSUMED) return { reservation, idempotent: true };
      if (![ReservationStatus.PENDING, ReservationStatus.CODE_ISSUED, ReservationStatus.APPLIED].includes(reservation.status)) {
        throw new ValidationError(`reservation in ${reservation.status} cannot be consumed`);
      }
      if (consumedSparks > reservation.sparks || consumedSparks % REDEMPTION_INCREMENT_SPARKS !== 0) {
        throw new ValidationError('consumed SPARKS exceed reservation or increment');
      }
      const balance = await tx.lockBalance(shopId, reservation.customerId);
      const unused = reservation.sparks - consumedSparks;
      const next = {
        ...balance,
        availableSparks: balance.availableSparks + unused,
        reservedSparks: balance.reservedSparks - reservation.sparks,
      };
      await tx.saveBalance(next);
      await tx.setReservationStatus(shopId, reservationId, ReservationStatus.CONSUMED, this.now(), { orderId, consumedSparks });
      const transaction = await tx.appendTransaction({
        shopId, customerId: reservation.customerId, kind: WalletTransactionKind.REDEMPTION_CONSUMED,
        deltaAvailable: unused, deltaReserved: -reservation.sparks,
        balanceAfterAvailable: next.availableSparks, balanceAfterReserved: next.reservedSparks,
        idempotencyKey, reference: { reservationId, orderId, consumedSparks, unusedSparks: unused }, createdAt: this.now(),
      });
      return { transaction, idempotent: false };
    });
  }
}
