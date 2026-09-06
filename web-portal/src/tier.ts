// Tier computation: pure logic, derives this month's billing figures from the
// month's orders. Used on the company dashboard, the sidebar badge and the
// Billing page. The tier is NEVER stored on the Company model; it is always
// derived from order data so it stays self-correcting on refunds/cancellations.
//
// MARGINAL BANDS, $5 cap in every band, no monthly fee. Must match
// checkout-service/internal/statement/compute.go exactly; if these two drift a
// seller's dashboard estimate contradicts the statement they are actually sent.
//
//   orders 1-100      6%
//   orders 101-1,000  2%
//   orders 1,001+     1%
//
// An order is priced by its own position in the month, so growth never
// re-prices orders already placed, and the $5 cap holds at every volume rather
// than vanishing the moment a seller passes 100 orders.
import { Order } from './types';

export type TierName = 'Starter' | 'Growth' | 'Enterprise';

// The most any single order can cost, in every band.
export const PER_ORDER_CAP = 5;

// Marginal rate for the order at this 1-based position in the month.
export function bandRate(position: number): number {
  if (position <= 100) return 0.06;
  if (position <= 1000) return 0.02;
  return 0.01;
}

export interface TierInfo {
  tier: TierName;
  monthOrderCount: number;
  monthGrandTotal: number;
  nextTierThreshold: number | null;
  nextTierName: TierName | null;
  ordersToNextTier: number | null;
  monthlyFee: number;
  perOrderRate: number;
  perOrderCap: number | null;
  estimatedBill: number;
}

// The billing month is the UTC calendar month, everywhere.
//
// This used to read the LOCAL month, which meant the dashboard estimate and the
// statement could disagree about which month an order fell in: the seller saw an
// order in month N and was billed for it in month N-1. The boundary is now the
// same instant here, on the Billing page and in the snapshot, so the estimate a
// seller reads always covers the period they are invoiced for. The cost is that
// near midnight UTC the dashboard rolls over before local midnight; agreeing
// with the invoice is worth more than agreeing with the wall clock.
export function computeTier(orders: Order[], now: Date = new Date()): TierInfo {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  const monthOrders = orders.filter((o) => {
    if (o.status === 'cancelled') return false;
    const d = new Date(o.createdAt);
    return d.getUTCFullYear() === y && d.getUTCMonth() === m;
  });

  const count = monthOrders.length;
  const grandTotal = monthOrders.reduce((s, o) => s + (o.grandTotal || 0), 0);

  const tier: TierName = count <= 100 ? 'Starter' : count <= 1000 ? 'Growth' : 'Enterprise';
  const nextTierThreshold = count <= 100 ? 100 : count <= 1000 ? 1000 : null;
  const nextTierName: TierName | null = count <= 100 ? 'Growth' : count <= 1000 ? 'Enterprise' : null;

  // Oldest first: position in the month decides the rate, so the array order
  // must come from the order dates, not from however the API returned them.
  const chronological = [...monthOrders].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  // Fees are charged on NET revenue, mirroring Order.NetTotal and the fee loop
  // in compute.go. Clamped at 0 like NetTotal so an over-refund cannot produce a
  // negative fee, and capped at $5 in every band.
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const perOrderFees = chronological.reduce((sum, o, i) => {
    const refunded = (o.refunds || []).reduce((r, x) => r + (x.amount || 0), 0);
    const net = Math.max(0, (o.grandTotal || 0) - refunded);
    return sum + Math.min(bandRate(i + 1) * net, PER_ORDER_CAP);
  }, 0);

  const ordersToNextTier =
    nextTierThreshold !== null ? Math.max(0, nextTierThreshold + 1 - count) : null;

  return {
    tier,
    monthOrderCount: count,
    monthGrandTotal: round2(grandTotal),
    nextTierThreshold,
    nextTierName,
    ordersToNextTier,
    // No monthly fee at any volume. Kept on the shape because the Billing page
    // and the statement email still render the line.
    monthlyFee: 0,
    // The rate the LAST order paid, i.e. the deepest band reached. NOT the next
    // order's rate: at exactly 100 orders this reads 6% while order 101 costs 2%.
    // Callers wanting "what does my next order cost" call bandRate(count + 1),
    // as the dashboard does.
    perOrderRate: bandRate(count),
    perOrderCap: PER_ORDER_CAP,
    estimatedBill: round2(perOrderFees),
  };
}
