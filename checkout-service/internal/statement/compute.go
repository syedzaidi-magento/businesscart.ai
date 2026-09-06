package statement

import (
	"math"
	"sort"
	"time"

	"github.com/syed/businesscart/checkout-service/internal/order"
)

// round2 snaps a money figure to whole cents.
//
// Every value this package produces is a dollar amount held in float64, and the
// fee is a raw product (rate * net) that lands on fractions of a cent: 6% of a
// $0.90 order is 0.054. That value was being stored on the snapshot and emailed
// as "$0.05", so the billing record and the invoice disagreed, and a column of
// such rows in the portal summed to a total that did not match the rows above
// it. Rounding once, here, where the figures are produced, keeps the snapshot,
// the email, the portal and any export agreeing to the cent.
//
// The SUM of the per-order fees is rounded, not each order, because the
// statement bills one aggregate "transaction fees" line rather than per-order
// lines. Rounding per order would drift from that line by a cent per order.
func round2(f float64) float64 {
	return math.Round(f*100) / 100
}

// Compute derives the billing figures from a period's orders.
//
// MARGINAL BANDS, like tax brackets. An order is priced by its own position in
// the month, not by the band the whole month lands in:
//
//	orders 1-100      6%
//	orders 101-1,000  2%
//	orders 1,001+     1%
//
// Every order is capped at $5 in EVERY band, and there is NO monthly fee at any
// volume.
//
// Three deliberate properties, each of which replaced a real defect:
//
//  1. Marginal, so growth is never punished. Under the old flat tiers the 101st
//     order of the month re-priced the previous hundred and added a $499 monthly
//     fee: a wholesaler crossing that line went from $500 to $2,519 for one extra
//     order. Now the 101st order costs what the 101st order costs.
//  2. The cap applies in every band. It used to exist only in Starter, so growing
//     past 100 orders silently removed it and a $10,000 order jumped from $5 to
//     $100. "$5 max per order" is now true at any volume, which is what the
//     marketing has always claimed.
//  3. No monthly fee anywhere, which is the platform's stated rule. The old
//     $499 and $1,999 tiers contradicted it.
//
// Pure function, no DB calls. Mirrors web-portal/src/tier.ts; keep them
// synchronized so admin and company always see the same numbers.
func Compute(sellerID string, from, to time.Time, orders []*order.Order) Computed {
	count := len(orders)

	// Position decides the rate, so the order the slice arrives in would
	// otherwise decide the bill. Sorted oldest first: the month's first hundred
	// orders are the ones that pay the entry rate.
	sorted := make([]*order.Order, len(orders))
	copy(sorted, orders)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].CreatedAt.Before(sorted[j].CreatedAt) })

	var grandTotal, refunded, fees float64
	for i, o := range sorted {
		grandTotal += o.GrandTotal
		refunded += o.TotalRefunded()
		// Fees are charged on NetTotal, not GrandTotal: a seller must not pay a
		// percentage on money they handed back. NetTotal is clamped at 0, so a
		// fully refunded order contributes a fee of 0 rather than being dropped,
		// and OrderCount (which sets the band) is untouched by refunds.
		fee := BandRate(i+1) * o.NetTotal()
		if fee > PerOrderCap {
			fee = PerOrderCap
		}
		fees += fee
	}

	roundedFees := round2(fees)
	cap := PerOrderCap

	return Computed{
		SellerID:    sellerID,
		PeriodStart: from,
		PeriodEnd:   to,
		OrderCount:  count,
		// GrandTotal stays GROSS on purpose: the statement email labels this line
		// "gross revenue", so netting it here would make that label a lie. Refunds
		// are reported alongside it and the fee above is what actually uses net.
		TotalGrandTotal: round2(grandTotal),
		TotalRefunded:   round2(refunded),
		Tier:            TierName(count),
		MonthlyFee:      0,
		// The rate the LAST order in the period paid, i.e. the deepest band the
		// seller reached. Not the next order's rate: at exactly 100 orders this
		// reads 6% while order 101 would cost 2%. There is no single blended rate
		// to report under marginal bands, so callers wanting "what does my next
		// order cost" must call BandRate(count+1) themselves, as the dashboard does.
		PerOrderRate:    BandRate(count),
		PerOrderCap:     &cap,
		TransactionFees: roundedFees,
		TotalDue:        roundedFees,
	}
}

// PerOrderCap is the most any single order can ever cost, in every band.
const PerOrderCap = 5.0

// BandRate is the marginal rate for the order at this 1-based position in the
// month. Position 0 or less is treated as the entry band.
func BandRate(position int) float64 {
	switch {
	case position <= 100:
		return 0.06
	case position <= 1000:
		return 0.02
	default:
		return 0.01
	}
}

// TierName labels the highest band a seller reached in the period. With no
// monthly fee it is display only: it changes no figure on the statement, and is
// kept because snapshots, the portal badge and the email all carry it.
func TierName(count int) string {
	switch {
	case count <= 100:
		return "Starter"
	case count <= 1000:
		return "Growth"
	default:
		return "Enterprise"
	}
}
