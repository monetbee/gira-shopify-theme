import test from 'node:test';
import assert from 'node:assert/strict';
import { WalletService } from '../src/domain/wallet-service.js';
import { InMemoryWalletRepository } from '../src/repositories/in-memory-wallet-repository.js';
import { InsufficientBalanceError, ValidationError } from '../src/domain/errors.js';
import { WalletTransactionKind } from '../src/domain/constants.js';

const shopId = 'giragiraglasses.myshopify.com';
const customerId = 1001;
const expiry = () => new Date(Date.now() + 60_000);

function setup() {
  const repository = new InMemoryWalletRepository();
  return { repository, service: new WalletService(repository) };
}

test('welcome bonus is immutable, idempotent, and updates the materialized balance', async () => {
  const { repository, service } = setup();
  const input = { shopId, customerId, sparks: 1000, kind: WalletTransactionKind.WELCOME_BONUS, idempotencyKey: 'customer:1001:welcome' };
  const first = await service.grant(input);
  const retry = await service.grant(input);
  assert.equal(first.idempotent, false);
  assert.equal(retry.idempotent, true);
  assert.equal(repository.transactions.length, 1);
  assert.equal((await repository.lockBalance(shopId, customerId)).availableSparks, 1000);
});

test('redemption reservation requires 20-SPARK increments and never makes balance negative', async () => {
  const { repository, service } = setup();
  await service.grant({ shopId, customerId, sparks: 1000, kind: WalletTransactionKind.WELCOME_BONUS, idempotencyKey: 'bonus' });
  await assert.rejects(
    service.reserveRedemption({ shopId, customerId, sparks: 19, idempotencyKey: 'bad', expiresAt: expiry(), cartFingerprint: 'cart-a' }),
    ValidationError,
  );
  await assert.rejects(
    service.reserveRedemption({ shopId, customerId, sparks: 1020, idempotencyKey: 'too-much', expiresAt: expiry(), cartFingerprint: 'cart-a' }),
    InsufficientBalanceError,
  );
  const { reservation } = await service.reserveRedemption({ shopId, customerId, sparks: 400, idempotencyKey: 'reserve-a', expiresAt: expiry(), cartFingerprint: 'cart-a' });
  assert.equal(reservation.requestedDiscountMinor, 20);
  const balance = await repository.lockBalance(shopId, customerId);
  assert.equal(balance.availableSparks, 600);
  assert.equal(balance.reservedSparks, 400);
  assert.equal(balance.lockVersion, 2);
});

test('concurrent reservation requests cannot double-spend a wallet', async () => {
  const { repository, service } = setup();
  await service.grant({ shopId, customerId, sparks: 1000, kind: WalletTransactionKind.WELCOME_BONUS, idempotencyKey: 'bonus' });
  const attempts = await Promise.allSettled([
    service.reserveRedemption({ shopId, customerId, sparks: 800, idempotencyKey: 'reserve-one', expiresAt: expiry(), cartFingerprint: 'cart-1' }),
    service.reserveRedemption({ shopId, customerId, sparks: 800, idempotencyKey: 'reserve-two', expiresAt: expiry(), cartFingerprint: 'cart-2' }),
  ]);
  assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((item) => item.status === 'rejected').length, 1);
  const balance = await repository.lockBalance(shopId, customerId);
  assert.equal(balance.availableSparks, 200);
  assert.equal(balance.reservedSparks, 800);
});

test('payment consumes actual used SPARKS and atomically releases unused reservation', async () => {
  const { repository, service } = setup();
  await service.grant({ shopId, customerId, sparks: 1000, kind: WalletTransactionKind.WELCOME_BONUS, idempotencyKey: 'bonus' });
  const { reservation } = await service.reserveRedemption({ shopId, customerId, sparks: 1000, idempotencyKey: 'reserve', expiresAt: expiry(), cartFingerprint: 'cart' });
  await service.consumeReservation({ shopId, reservationId: reservation.id, consumedSparks: 600, idempotencyKey: 'paid:order:22', orderId: 22 });
  const balance = await repository.lockBalance(shopId, customerId);
  assert.equal(balance.availableSparks, 400);
  assert.equal(balance.reservedSparks, 0);
  const reservationAfter = await repository.lockReservation(shopId, reservation.id);
  assert.equal(reservationAfter.status, 'consumed');
  assert.equal(reservationAfter.consumedSparks, 600);
});

test('expired reservation returns reserved SPARKS exactly once', async () => {
  const { repository, service } = setup();
  await service.grant({ shopId, customerId, sparks: 1000, kind: WalletTransactionKind.WELCOME_BONUS, idempotencyKey: 'bonus' });
  const { reservation } = await service.reserveRedemption({ shopId, customerId, sparks: 200, idempotencyKey: 'reserve', expiresAt: expiry(), cartFingerprint: 'cart' });
  const first = await service.releaseReservation({ shopId, reservationId: reservation.id, idempotencyKey: 'expire:res_1', reason: 'expired' });
  const retry = await service.releaseReservation({ shopId, reservationId: reservation.id, idempotencyKey: 'expire:res_1', reason: 'expired' });
  assert.equal(first.idempotent, false);
  assert.equal(retry.idempotent, true);
  const balance = await repository.lockBalance(shopId, customerId);
  assert.equal(balance.availableSparks, 1000);
  assert.equal(balance.reservedSparks, 0);
});
