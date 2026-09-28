export const SPARKS_PER_JPY = 20;
export const MINIMUM_REDEMPTION_SPARKS = 20;
export const REDEMPTION_INCREMENT_SPARKS = 20;

export const ReservationStatus = Object.freeze({
  PENDING: 'pending',
  CODE_ISSUED: 'code_issued',
  APPLIED: 'applied',
  CONSUMED: 'consumed',
  RELEASED: 'released',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
});

export const WalletTransactionKind = Object.freeze({
  WELCOME_BONUS: 'welcome_bonus',
  ORDER_EARNED: 'order_earned',
  EARN_REVERSAL: 'earn_reversal',
  REDEMPTION_RESERVED: 'redemption_reserved',
  REDEMPTION_RELEASED: 'redemption_released',
  REDEMPTION_CONSUMED: 'redemption_consumed',
  REDEMPTION_RESTORED: 'redemption_restored',
  MANUAL_ADJUSTMENT: 'manual_adjustment',
});
