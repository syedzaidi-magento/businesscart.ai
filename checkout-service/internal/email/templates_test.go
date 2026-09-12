package email

import (
	"strings"
	"testing"
)

// TestOrderConfirmationTextBreakdown pins the customer-facing receipt content.
// Critical because this is where a customer verifies "did my SAVE10 apply?"
// after checkout. Wrong here = customer pays the discounted total but the
// email gives no signal that the coupon applied, generating support requests.
func TestOrderConfirmationTextBreakdown(t *testing.T) {
	t.Run("with promo discount: shows breakdown + discount line + code", func(t *testing.T) {
		body := orderConfirmationText(OrderConfirmationData{
			OrderID:       "abc123def456",
			Subtotal:      32.97,
			ShippingCost:  15.00,
			TaxAmount:     2.72,
			PromoCode:     "SAVE10",
			PromoDiscount: 3.30,
			GrandTotal:    47.39,
			BrandName:     "Acme",
		})
		mustContain(t, body, "Subtotal: $32.97")
		mustContain(t, body, "Shipping: $15.00")
		mustContain(t, body, "Tax:      $2.72")
		mustContain(t, body, "Discount (SAVE10): -$3.30")
		mustContain(t, body, "Total:    $47.39")
	})

	t.Run("with discount but no code: shows discount line without code label", func(t *testing.T) {
		body := orderConfirmationText(OrderConfirmationData{
			OrderID:       "xyz",
			Subtotal:      50,
			TaxAmount:     0,
			ShippingCost:  0,
			PromoCode:     "",
			PromoDiscount: 5.00,
			GrandTotal:    45,
		})
		mustContain(t, body, "Discount: -$5.00")
		mustNotContain(t, body, "Discount (")
	})

	t.Run("zero promo discount: discount line omitted entirely", func(t *testing.T) {
		body := orderConfirmationText(OrderConfirmationData{
			OrderID:      "xyz",
			Subtotal:     50,
			ShippingCost: 10,
			TaxAmount:    5,
			GrandTotal:   65,
		})
		mustContain(t, body, "Subtotal: $50.00")
		mustContain(t, body, "Total:    $65.00")
		mustNotContain(t, body, "Discount")
	})

	t.Run("legacy single-total fallback when only GrandTotal set", func(t *testing.T) {
		body := orderConfirmationText(OrderConfirmationData{
			OrderID:    "xyz",
			GrandTotal: 100,
		})
		mustContain(t, body, "Total: $100.00")
		mustNotContain(t, body, "Subtotal:")
	})

	t.Run("HTML template renders discount row when PromoDiscount > 0", func(t *testing.T) {
		html := renderHTML(orderConfirmationHTMLTmpl, OrderConfirmationData{
			OrderID:       "abc",
			Subtotal:      32.97,
			ShippingCost:  15.00,
			TaxAmount:     2.72,
			PromoCode:     "SAVE10",
			PromoDiscount: 3.30,
			GrandTotal:    47.39,
		})
		mustContain(t, html, "Discount (SAVE10)")
		mustContain(t, html, "-$3.30")
		mustContain(t, html, "$47.39") // grand total
	})

	t.Run("HTML template omits discount row when PromoDiscount == 0", func(t *testing.T) {
		html := renderHTML(orderConfirmationHTMLTmpl, OrderConfirmationData{
			OrderID:    "abc",
			Subtotal:   32.97,
			GrandTotal: 32.97,
		})
		mustNotContain(t, html, "Discount")
		mustContain(t, html, "$32.97")
	})
}

// TestNewOrderToCompanyTextBreakdown pins the merchant-facing notification.
// Critical because the merchant needs to reconcile a discounted GrandTotal
// against list price; without the breakdown they cannot tell why a $50 cart
// is being recorded as $45.
func TestNewOrderToCompanyTextBreakdown(t *testing.T) {
	t.Run("with promo: breakdown + discount line", func(t *testing.T) {
		body := newOrderToCompanyText(NewOrderToCompanyData{
			OrderID:       "abc",
			CustomerEmail: "buyer@example.com",
			Subtotal:      32.97,
			ShippingCost:  15.00,
			TaxAmount:     2.72,
			PromoCode:     "SAVE10",
			PromoDiscount: 3.30,
			GrandTotal:    47.39,
		})
		mustContain(t, body, "Subtotal: $32.97")
		mustContain(t, body, "Discount (SAVE10): -$3.30")
		mustContain(t, body, "Total:    $47.39")
	})

	t.Run("zero discount: no discount line", func(t *testing.T) {
		body := newOrderToCompanyText(NewOrderToCompanyData{
			OrderID:    "xyz",
			Subtotal:   50,
			GrandTotal: 50,
		})
		mustContain(t, body, "Subtotal: $50.00")
		mustNotContain(t, body, "Discount")
	})

	t.Run("legacy fallback: only GrandTotal set", func(t *testing.T) {
		body := newOrderToCompanyText(NewOrderToCompanyData{
			OrderID:    "xyz",
			GrandTotal: 100,
		})
		mustContain(t, body, "Total: $100.00")
		mustNotContain(t, body, "Subtotal:")
	})

	t.Run("HTML renders discount row when promo present", func(t *testing.T) {
		html := renderHTML(newOrderToCompanyHTMLTmpl, NewOrderToCompanyData{
			OrderID:       "abc",
			CustomerEmail: "buyer@example.com",
			Subtotal:      32.97,
			ShippingCost:  15.00,
			TaxAmount:     2.72,
			PromoCode:     "SAVE10",
			PromoDiscount: 3.30,
			GrandTotal:    47.39,
		})
		mustContain(t, html, "Discount (SAVE10)")
		mustContain(t, html, "-$3.30")
	})
}

func mustContain(t *testing.T, body, want string) {
	t.Helper()
	if !strings.Contains(body, want) {
		t.Errorf("body missing %q\nfull body:\n%s", want, body)
	}
}

func mustNotContain(t *testing.T, body, banned string) {
	t.Helper()
	if strings.Contains(body, banned) {
		t.Errorf("body unexpectedly contains %q\nfull body:\n%s", banned, body)
	}
}

// Roadmap #9: the statement gained refund + net rows. Both bodies are rendered
// here because an HTML template error is a RUNTIME failure that compiles fine and
// would ship a broken or blank statement to a paying seller. Also pins that a
// period with no refunds renders exactly as it did before.
func TestMonthlyStatementRefundRows(t *testing.T) {
	base := MonthlyStatementData{
		CompanyName: "uSetGo", PeriodLabel: "June 2026", Tier: "Starter",
		OrderCount: 3, TotalGrandTotal: 209.97, MonthlyFee: 0,
		PerOrderRateStr: "6%, capped at $5/order", TransactionFees: 2.10, TotalDue: 2.10,
	}

	clean := MonthlyStatementMessage("a@b.com", base)
	if !strings.Contains(clean.HTMLBody, "209.97") {
		t.Errorf("HTML did not render gross revenue; template likely errored:\n%s", clean.HTMLBody)
	}
	if strings.Contains(clean.HTMLBody, "Refunds issued") || strings.Contains(clean.TextBody, "Refunds issued") {
		t.Error("a period with no refunds must not show refund rows")
	}

	withRefund := base
	withRefund.TotalRefunded = 174.98
	r := MonthlyStatementMessage("a@b.com", withRefund)
	for _, want := range []string{"Refunds issued", "174.98", "Net revenue", "34.99"} {
		if !strings.Contains(r.HTMLBody, want) {
			t.Errorf("HTML body missing %q:\n%s", want, r.HTMLBody)
		}
		if !strings.Contains(r.TextBody, want) {
			t.Errorf("text body missing %q:\n%s", want, r.TextBody)
		}
	}
}

// A cancellation is not a receipt. The confirmation itemises subtotal, shipping,
// tax and discount because the customer is being charged and needs the maths;
// a cancelled order charges nothing, so repeating that breakdown would read as a
// bill for money nobody is taking. This pins the difference, because the obvious
// way to write these templates is to copy the confirmation.
func TestOrderCancelledIsNotAReceipt(t *testing.T) {
	body := orderCancelledText(OrderCancelledData{
		OrderID:    "abc123def456",
		GrandTotal: 47.39,
		Items: []OrderItemView{
			{Name: "Sourdough Loaf", Quantity: 2, Price: 15.04},
		},
		BrandName:  "Solomon's Bakery",
		BrandEmail: "info@solomonsbakery.com",
	})

	mustContain(t, body, "has been cancelled")
	mustContain(t, body, "def456") // order identified by its last six
	mustContain(t, body, "Sourdough Loaf x2")
	mustContain(t, body, "Order value: $47.39")
	mustContain(t, body, "Solomon's Bakery")

	for _, banned := range []string{"Subtotal:", "Shipping:", "Tax:", "Discount"} {
		mustNotContain(t, body, banned)
	}
	// Refunds belong to the "refunded" status, which has its own email to both
	// parties. A cancellation guessing at refund state would either duplicate
	// that or contradict it.
	mustNotContain(t, body, "refund")
}

// The merchant's copy answers a different question than the customer's: which
// order, whose, and is the stock free again.
func TestOrderCancelledToCompanyText(t *testing.T) {
	body := orderCancelledToCompanyText(OrderCancelledToCompanyData{
		OrderID:       "abc123def456",
		CustomerEmail: "dana@corner-cafe.test",
		GrandTotal:    47.39,
		Items: []OrderItemView{
			{Name: "Sourdough Loaf", Quantity: 2, Price: 15.04},
		},
	})

	mustContain(t, body, "was cancelled")
	mustContain(t, body, "def456")
	mustContain(t, body, "dana@corner-cafe.test") // merchant can identify the buyer
	mustContain(t, body, "Cancelled items")
	mustContain(t, body, "Sourdough Loaf x2")
	mustContain(t, body, "Order value: $47.39")
	mustContain(t, body, "businesscart.ai/orders")
}

// Both HTML bodies are rendered because a template error is a RUNTIME failure
// that compiles fine: a bad field name yields an empty or half-written email
// that nothing catches until a customer gets it. Same reason the statement
// templates are rendered in this file.
func TestOrderCancelledHTMLRenders(t *testing.T) {
	cust := OrderCancelledMessage("buyer@test.com", OrderCancelledData{
		OrderID:    "abc123def456",
		GrandTotal: 47.39,
		Items:      []OrderItemView{{Name: "Sourdough Loaf", Quantity: 2}},
		BrandName:  "Solomon's Bakery",
	})
	if cust.Subject != "Your order #def456 has been cancelled" {
		t.Errorf("customer subject = %q", cust.Subject)
	}
	mustContain(t, cust.HTMLBody, "Your order has been cancelled")
	mustContain(t, cust.HTMLBody, "Sourdough Loaf")
	mustContain(t, cust.HTMLBody, "47.39")
	mustNotContain(t, cust.HTMLBody, "{{") // unrendered action = broken template

	owner := OrderCancelledToCompanyMessage("owner@test.com", OrderCancelledToCompanyData{
		OrderID:       "abc123def456",
		CustomerEmail: "buyer@test.com",
		GrandTotal:    47.39,
		Items:         []OrderItemView{{Name: "Sourdough Loaf", Quantity: 2}},
	})
	if owner.Subject != "Order cancelled on your store #def456 ($47.39)" {
		t.Errorf("owner subject = %q", owner.Subject)
	}
	mustContain(t, owner.HTMLBody, "Order cancelled")
	mustContain(t, owner.HTMLBody, "buyer@test.com")
	mustNotContain(t, owner.HTMLBody, "{{")
}

// An order with no items must still produce a usable email rather than an empty
// shell. Cancellations happen on odd records, including legacy ones.
func TestOrderCancelledWithNoItems(t *testing.T) {
	body := orderCancelledText(OrderCancelledData{OrderID: "abc123def456", GrandTotal: 0})
	mustContain(t, body, "has been cancelled")
	mustContain(t, body, "reply to this email")
}
