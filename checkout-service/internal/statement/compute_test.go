package statement

import (
	"testing"
	"time"

	"github.com/syed/businesscart/checkout-service/internal/order"
)

var (
	from = time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	to   = time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
)

// makeOrders builds n identical orders, each one minute apart so the sort in
// Compute has a stable, meaningful order to work with.
func makeOrders(n int, total float64) []*order.Order {
	out := make([]*order.Order, n)
	for i := range out {
		out[i] = &order.Order{GrandTotal: total, CreatedAt: from.Add(time.Duration(i) * time.Minute)}
	}
	return out
}

// TestCompute pins the billing math. This is what we charge sellers; a
// regression here invoices customers wrong.
//
// Marginal bands, $5 cap in every band, no monthly fee (must match
// web-portal/src/tier.ts):
//
//	orders 1-100      6%
//	orders 101-1,000  2%
//	orders 1,001+     1%
func TestCompute(t *testing.T) {
	cases := []struct {
		name         string
		orders       []*order.Order
		wantTier     string
		wantFees     float64
		wantTotalDue float64
	}{
		{"no orders", nil, "Starter", 0, 0},
		{"1 small order, 6% under cap", makeOrders(1, 50), "Starter", 3.00, 3.00},
		{"1 large order, capped at $5", makeOrders(1, 1000), "Starter", 5.00, 5.00},
		{"at-cap boundary, 6% of $83.33", makeOrders(1, 83.33), "Starter", 5.00, 5.00},
		{"100 orders, still entry band", makeOrders(100, 50), "Starter", 300.00, 300.00},
		// 100 x $3.00 + 1 x $1.00. The first hundred are NOT re-priced.
		{"101 orders, only the 101st is at 2%", makeOrders(101, 50), "Growth", 301.00, 301.00},
		// 100 x 3.00 + 900 x 1.00
		{"1000 orders", makeOrders(1000, 50), "Growth", 1200.00, 1200.00},
		// 100 x 3.00 + 900 x 1.00 + 1 x 0.50
		{"1001 orders crosses into the 1% band", makeOrders(1001, 50), "Enterprise", 1200.50, 1200.50},
		// Cap binds in every band: 6%/2%/1% of $2,000 all exceed $5.
		{"wholesale, capped in all three bands", makeOrders(1001, 2000), "Enterprise", 5005.00, 5005.00},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Compute("seller1", from, to, tc.orders)

			if got.OrderCount != len(tc.orders) {
				t.Errorf("OrderCount = %d, want %d", got.OrderCount, len(tc.orders))
			}
			if got.Tier != tc.wantTier {
				t.Errorf("Tier = %q, want %q", got.Tier, tc.wantTier)
			}
			if got.TransactionFees != tc.wantFees {
				t.Errorf("TransactionFees = %v, want %v", got.TransactionFees, tc.wantFees)
			}
			if got.TotalDue != tc.wantTotalDue {
				t.Errorf("TotalDue = %v, want %v", got.TotalDue, tc.wantTotalDue)
			}
			// The platform's stated rule: no monthly fee at any volume.
			if got.MonthlyFee != 0 {
				t.Errorf("MonthlyFee = %v, want 0 at every volume", got.MonthlyFee)
			}
			// The cap must be present in every band, not just the entry one.
			if got.PerOrderCap == nil || *got.PerOrderCap != 5.0 {
				t.Errorf("PerOrderCap = %v, want $5 in every band", got.PerOrderCap)
			}
		})
	}
}

// Growth must never re-price orders already placed. Under the old flat tiers the
// 101st order added a $499 monthly fee AND re-rated the previous hundred, so one
// extra order could cost a wholesaler $2,000. The marginal step must be the
// price of exactly one order.
func TestCompute_GrowthIsNeverPunished(t *testing.T) {
	for _, aov := range []float64{50, 200, 2000} {
		at100 := Compute("s", from, to, makeOrders(100, aov)).TotalDue
		at101 := Compute("s", from, to, makeOrders(101, aov)).TotalDue

		step := round2(at101 - at100)
		wantStep := round2(min5(0.02 * aov))
		if step != wantStep {
			t.Errorf("AOV %.0f: order 101 cost %v, want %v (one order at the 2%% band rate)", aov, step, wantStep)
		}
		if at101 < at100 {
			t.Errorf("AOV %.0f: bill went DOWN crossing a band, %v -> %v", aov, at100, at101)
		}
	}
}

// The $5 cap used to exist only in the entry band, so growing past 100 orders
// silently removed it and a $10,000 order jumped from $5 to $100. Every band
// caps now, which is what the marketing has always promised.
func TestCompute_CapHoldsInEveryBand(t *testing.T) {
	big := 10000.0
	for _, n := range []int{1, 101, 1001} {
		orders := makeOrders(n, big)
		got := Compute("s", from, to, orders)
		want := round2(float64(n) * 5.0)
		if got.TotalDue != want {
			t.Errorf("%d orders of $%.0f: TotalDue = %v, want %v ($5 each)", n, big, got.TotalDue, want)
		}
	}
	// The headline claim, stated as a test: one $10,000 order costs $5 no matter
	// how many orders came before it.
	last := Compute("s", from, to, makeOrders(1001, big))
	prev := Compute("s", from, to, makeOrders(1000, big))
	if step := round2(last.TotalDue - prev.TotalDue); step != 5.0 {
		t.Errorf("a $10,000 order in the top band cost %v, want 5.00", step)
	}
}

// Position sets the rate, so the slice arriving in a different order must not
// change the bill.
func TestCompute_OrderingIsDeterministic(t *testing.T) {
	orders := makeOrders(150, 50)
	forward := Compute("s", from, to, orders).TotalDue

	reversed := make([]*order.Order, len(orders))
	for i, o := range orders {
		reversed[len(orders)-1-i] = o
	}
	if got := Compute("s", from, to, reversed).TotalDue; got != forward {
		t.Errorf("reversed input gave %v, want %v; position must come from date, not slice order", got, forward)
	}
}

// Roadmap #9: fees are charged on NET revenue. A seller who refunded most of an
// order must not pay the percentage on the pre-refund figure.
func TestCompute_FeesChargedOnNetNotGross(t *testing.T) {
	orders := []*order.Order{
		{GrandTotal: 209.97, Refunds: []order.Refund{{Amount: 174.98}}, CreatedAt: from},
	}
	got := Compute("seller1", from, to, orders)

	// 6% of net 34.99 = 2.0994, billed as 2.10. 6% of gross would be 12.60,
	// which the $5 cap would then mask as 5.00, so this asserts on the uncapped
	// side of the boundary where the difference is actually visible.
	if got.TransactionFees != 2.10 {
		t.Errorf("TransactionFees = %v, want exactly 2.10 (6%% of net 34.99, rounded)", got.TransactionFees)
	}
	// Gross stays gross: the email labels this line "gross revenue".
	if got.TotalGrandTotal != 209.97 {
		t.Errorf("TotalGrandTotal = %v, want 209.97 (gross, not netted)", got.TotalGrandTotal)
	}
	if got.TotalRefunded != 174.98 {
		t.Errorf("TotalRefunded = %v, want 174.98", got.TotalRefunded)
	}
	if got.OrderCount != 1 {
		t.Errorf("OrderCount = %v, want 1 (refunds do not remove an order)", got.OrderCount)
	}
}

// A fully refunded order contributes no fee but is still a counted order, so it
// still consumes a position in the band schedule.
func TestCompute_FullyRefundedOrderCostsNoFee(t *testing.T) {
	orders := []*order.Order{
		{GrandTotal: 100, Refunds: []order.Refund{{Amount: 100}}, CreatedAt: from},
	}
	got := Compute("seller1", from, to, orders)

	if got.TransactionFees != 0 {
		t.Errorf("TransactionFees = %v, want 0 for a fully refunded order", got.TransactionFees)
	}
	if got.OrderCount != 1 {
		t.Errorf("OrderCount = %v, want 1", got.OrderCount)
	}
}

// Money is rounded to whole cents at the point it is produced.
//
// The production shape that exposed it: uSetGo's May 2026 statement, one $0.90
// order, where 6% is 0.054. That was stored on the snapshot and emailed as
// "$0.05", so the record and the invoice disagreed.
//
// Guard when touching Compute: revert round2 and this fails with
// 0.054000000000000006, which is why it asserts equality, not a tolerance.
// Run with -count=1; Go caches passes.
func TestCompute_MoneyRoundedToCents(t *testing.T) {
	got := Compute("seller1", from, to, []*order.Order{{GrandTotal: 0.90, CreatedAt: from}})
	if got.TransactionFees != 0.05 {
		t.Errorf("TransactionFees = %v, want exactly 0.05 (6%% of 0.90 = 0.054)", got.TransactionFees)
	}
	if got.TotalDue != 0.05 {
		t.Errorf("TotalDue = %v, want exactly 0.05", got.TotalDue)
	}

	up := Compute("seller1", from, to, []*order.Order{{GrandTotal: 1.30, CreatedAt: from}})
	if up.TransactionFees != 0.08 {
		t.Errorf("TransactionFees = %v, want exactly 0.08 (6%% of 1.30 = 0.078)", up.TransactionFees)
	}

	// KNOWN LIMIT, asserted so it cannot change unnoticed. A decimal half-cent is
	// NOT resolved by a decimal rounding rule, because the binary product is
	// already off: 6% of 2.75 is 0.16499999999999998, not 0.165, so it rounds
	// DOWN to 0.16 where round-half-up would give 0.17. A half cent, on a
	// boundary, in the platform's favour. The real fix is integer cents end to
	// end, a money-model change touching every read path.
	half := Compute("seller1", from, to, []*order.Order{{GrandTotal: 2.75, CreatedAt: from}})
	if half.TransactionFees != 0.16 {
		t.Errorf("TransactionFees = %v, want 0.16 (binary 6%% of 2.75 is just under the half cent)", half.TransactionFees)
	}
	if half.TotalDue != half.MonthlyFee+half.TransactionFees {
		t.Errorf("TotalDue %v != MonthlyFee %v + TransactionFees %v", half.TotalDue, half.MonthlyFee, half.TransactionFees)
	}
}

func min5(f float64) float64 {
	if f > 5.0 {
		return 5.0
	}
	return f
}
