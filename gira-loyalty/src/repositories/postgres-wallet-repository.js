import pg from 'pg';

const { Pool } = pg;

const mapBalance = (row) => ({
  shopId: row.shop_id,
  customerId: Number(row.customer_id),
  availableSparks: Number(row.available_sparks),
  reservedSparks: Number(row.reserved_sparks),
  lockVersion: Number(row.lock_version),
});

const mapReservation = (row) => row && ({
  id: row.id,
  shopId: row.shop_id,
  customerId: Number(row.customer_id),
  sparks: Number(row.sparks),
  requestedDiscountMinor: Number(row.requested_discount_minor),
  currency: row.currency,
  status: row.status,
  idempotencyKey: row.idempotency_key,
  expiresAt: row.expires_at,
  cartFingerprint: row.cart_fingerprint,
  consumedSparks: row.consumed_sparks === null ? null : Number(row.consumed_sparks),
  orderId: row.order_id === null ? null : Number(row.order_id),
});

const mapTransaction = (row) => row && ({
  id: row.id,
  shopId: row.shop_id,
  customerId: Number(row.customer_id),
  kind: row.kind,
  deltaAvailable: Number(row.delta_available),
  deltaReserved: Number(row.delta_reserved),
  balanceAfterAvailable: Number(row.balance_after_available),
  balanceAfterReserved: Number(row.balance_after_reserved),
  idempotencyKey: row.idempotency_key,
});

class PostgresWalletTransaction {
  constructor(client) { this.client = client; }

  async lockBalance(shopId, customerId) {
    await this.client.query(
      `INSERT INTO wallet_balances (shop_id, customer_id)
       VALUES ($1, $2) ON CONFLICT (shop_id, customer_id) DO NOTHING`,
      [shopId, customerId],
    );
    const { rows: [row] } = await this.client.query(
      `SELECT * FROM wallet_balances WHERE shop_id = $1 AND customer_id = $2 FOR UPDATE`,
      [shopId, customerId],
    );
    return mapBalance(row);
  }

  async saveBalance(balance) {
    const { rowCount } = await this.client.query(
      `UPDATE wallet_balances
       SET available_sparks = $3, reserved_sparks = $4, lock_version = lock_version + 1, updated_at = now()
       WHERE shop_id = $1 AND customer_id = $2`,
      [balance.shopId, balance.customerId, balance.availableSparks, balance.reservedSparks],
    );
    if (rowCount !== 1) throw new Error('locked wallet balance disappeared');
  }

  async findTransactionByIdempotencyKey(shopId, idempotencyKey) {
    const { rows: [row] } = await this.client.query(
      `SELECT * FROM wallet_transactions WHERE shop_id = $1 AND idempotency_key = $2`, [shopId, idempotencyKey],
    );
    return mapTransaction(row);
  }

  async appendTransaction(transaction) {
    const { rows: [row] } = await this.client.query(
      `INSERT INTO wallet_transactions
        (shop_id, customer_id, kind, delta_available, delta_reserved, balance_after_available,
         balance_after_reserved, idempotency_key, reference_type, reference_id, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        transaction.shopId, transaction.customerId, transaction.kind, transaction.deltaAvailable,
        transaction.deltaReserved, transaction.balanceAfterAvailable, transaction.balanceAfterReserved,
        transaction.idempotencyKey, transaction.reference?.type ?? null, transaction.reference?.id ?? null,
        JSON.stringify(transaction.reference ?? {}), transaction.createdAt,
      ],
    );
    return mapTransaction(row);
  }

  async findReservationByIdempotencyKey(shopId, idempotencyKey) {
    const { rows: [row] } = await this.client.query(
      `SELECT * FROM redemption_reservations WHERE shop_id = $1 AND idempotency_key = $2`, [shopId, idempotencyKey],
    );
    return mapReservation(row);
  }

  async createReservation(reservation) {
    const { rows: [row] } = await this.client.query(
      `INSERT INTO redemption_reservations
        (shop_id, customer_id, sparks, requested_discount_minor, currency, cart_fingerprint,
         status, idempotency_key, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        reservation.shopId, reservation.customerId, reservation.sparks, reservation.requestedDiscountMinor,
        reservation.currency, reservation.cartFingerprint, reservation.status, reservation.idempotencyKey,
        reservation.expiresAt, reservation.createdAt,
      ],
    );
    return mapReservation(row);
  }

  async lockReservation(shopId, reservationId) {
    const { rows: [row] } = await this.client.query(
      `SELECT * FROM redemption_reservations WHERE shop_id = $1 AND id = $2 FOR UPDATE`, [shopId, reservationId],
    );
    if (!row) throw new Error('reservation not found');
    return mapReservation(row);
  }

  async setReservationStatus(shopId, reservationId, status, at, fields = {}) {
    const { rowCount } = await this.client.query(
      `UPDATE redemption_reservations
       SET status = $3, status_updated_at = $4,
           order_id = COALESCE($5, order_id), consumed_sparks = COALESCE($6, consumed_sparks)
       WHERE shop_id = $1 AND id = $2`,
      [shopId, reservationId, status, at, fields.orderId ?? null, fields.consumedSparks ?? null],
    );
    if (rowCount !== 1) throw new Error('reservation not found');
  }
}

export class PostgresWalletRepository {
  constructor(connectionString) {
    this.pool = new Pool({ connectionString });
  }

  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new PostgresWalletTransaction(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close() { await this.pool.end(); }
}
