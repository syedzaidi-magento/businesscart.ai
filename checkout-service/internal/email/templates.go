package email

import (
	"bytes"
	"fmt"
	"html/template"
	"log"
)

// renderHTML safely renders an HTML template with auto-escaping for variables.
func renderHTML(tmplStr string, data interface{}) string {
	t, err := template.New("").Parse(tmplStr)
	if err != nil {
		log.Printf("email: html template parse failed: %v", err)
		return ""
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		log.Printf("email: html template execute failed: %v", err)
		return ""
	}
	return buf.String()
}

// ─────────────────────── Order Confirmation ───────────────────────

type OrderConfirmationData struct {
	OrderID         string
	Subtotal        float64
	ShippingCost    float64
	TaxAmount       float64
	PromoCode       string  // populated when a coupon was applied; empty otherwise
	PromoDiscount   float64 // omit the discount row when zero
	GrandTotal      float64
	Items           []OrderItemView
	BrandName       string
	BrandEmail      string
	DeliveryAddress *DeliveryAddressView // nil for pickup or legacy orders; "Ship to" block omitted when nil
}

// DeliveryAddressView is the email-side view of the order's snapshotted shipping
// address. Fields mirror order.DeliveryAddress; defined locally so the email
// package stays independent of the order package.
type DeliveryAddressView struct {
	RecipientName string
	Street        string
	City          string
	State         string
	Zip           string
	PhoneNumber   string
}

// brandFooterText renders the text-body sign-off. Falls back to "BusinessCart" when no brand.
func brandFooterText(name, email string) string {
	if name == "" {
		name = "BusinessCart"
	}
	if email == "" {
		return "— " + name
	}
	return "— " + name + " · " + email
}

type OrderItemView struct {
	Name     string
	Quantity int
	Price    float64
	Image    string
}

// OrderConfirmationMessage builds the order confirmation email sent to the customer.
func OrderConfirmationMessage(to string, data OrderConfirmationData) Message {
	return Message{
		To:       to,
		Subject:  fmt.Sprintf("Order confirmation #%s", lastSix(data.OrderID)),
		HTMLBody: renderHTML(orderConfirmationHTMLTmpl, data),
		TextBody: orderConfirmationText(data),
	}
}

func orderConfirmationText(d OrderConfirmationData) string {
	var b bytes.Buffer
	fmt.Fprintf(&b, "Thank you for your order!\n\n")
	fmt.Fprintf(&b, "Order #%s\n\n", lastSix(d.OrderID))
	for _, it := range d.Items {
		fmt.Fprintf(&b, "  - %s x%d  $%.2f\n", it.Name, it.Quantity, it.Price)
	}
	// Render full breakdown only when the data is meaningful (any sub-total
	// is non-zero). Older callers that only set GrandTotal still get the
	// legacy single-line total (backward compat).
	if d.Subtotal > 0 || d.TaxAmount > 0 || d.ShippingCost > 0 || d.PromoDiscount > 0 {
		fmt.Fprintf(&b, "\nSubtotal: $%.2f\n", d.Subtotal)
		if d.ShippingCost > 0 {
			fmt.Fprintf(&b, "Shipping: $%.2f\n", d.ShippingCost)
		}
		if d.TaxAmount > 0 {
			fmt.Fprintf(&b, "Tax:      $%.2f\n", d.TaxAmount)
		}
		if d.PromoDiscount > 0 {
			if d.PromoCode != "" {
				fmt.Fprintf(&b, "Discount (%s): -$%.2f\n", d.PromoCode, d.PromoDiscount)
			} else {
				fmt.Fprintf(&b, "Discount: -$%.2f\n", d.PromoDiscount)
			}
		}
		fmt.Fprintf(&b, "Total:    $%.2f\n", d.GrandTotal)
	} else {
		fmt.Fprintf(&b, "\nTotal: $%.2f\n", d.GrandTotal)
	}
	if d.DeliveryAddress != nil {
		fmt.Fprintf(&b, "\nShip to:\n")
		if d.DeliveryAddress.RecipientName != "" {
			fmt.Fprintf(&b, "  %s\n", d.DeliveryAddress.RecipientName)
		}
		if d.DeliveryAddress.Street != "" {
			fmt.Fprintf(&b, "  %s\n", d.DeliveryAddress.Street)
		}
		stateZip := ""
		if d.DeliveryAddress.State != "" && d.DeliveryAddress.Zip != "" {
			stateZip = d.DeliveryAddress.State + " " + d.DeliveryAddress.Zip
		} else if d.DeliveryAddress.State != "" {
			stateZip = d.DeliveryAddress.State
		} else if d.DeliveryAddress.Zip != "" {
			stateZip = d.DeliveryAddress.Zip
		}
		switch {
		case d.DeliveryAddress.City != "" && stateZip != "":
			fmt.Fprintf(&b, "  %s, %s\n", d.DeliveryAddress.City, stateZip)
		case d.DeliveryAddress.City != "":
			fmt.Fprintf(&b, "  %s\n", d.DeliveryAddress.City)
		case stateZip != "":
			fmt.Fprintf(&b, "  %s\n", stateZip)
		}
		if d.DeliveryAddress.PhoneNumber != "" {
			fmt.Fprintf(&b, "  %s\n", d.DeliveryAddress.PhoneNumber)
		}
	}
	fmt.Fprintf(&b, "\n%s\n", brandFooterText(d.BrandName, d.BrandEmail))
	return b.String()
}

const orderConfirmationHTMLTmpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Order confirmation</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="color:#0d9488;margin-bottom:8px">Thank you for your order!</h1>
  <p style="font-size:14px;color:#64748b">Order ID: <strong>{{.OrderID}}</strong></p>
  <table style="width:100%;border-collapse:collapse;margin:24px 0">
    <tbody>
      {{range .Items}}
      <tr>
        <td style="padding:8px 8px 8px 0;border-bottom:1px solid #f1f5f9;width:64px;vertical-align:top">
          {{if .Image}}<img src="{{.Image}}" alt="{{.Name}}" width="56" height="56" style="width:56px;height:56px;border-radius:6px;border:1px solid #e2e8f0;object-fit:cover;display:block" />{{else}}<div style="width:56px;height:56px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px"></div>{{end}}
        </td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;vertical-align:top">
          <div style="font-size:14px;color:#1e293b;font-weight:600">{{.Name}}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">Qty {{.Quantity}}</div>
        </td>
        <td style="padding:8px 0 8px 8px;border-bottom:1px solid #f1f5f9;text-align:right;vertical-align:top;font-size:14px;font-weight:600">${{printf "%.2f" .Price}}</td>
      </tr>
      {{end}}
    </tbody>
  </table>
  {{if or (gt .Subtotal 0.0) (gt .TaxAmount 0.0) (gt .ShippingCost 0.0) (gt .PromoDiscount 0.0)}}
  <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
    <tr><td style="padding:4px 0;color:#64748b">Subtotal</td><td style="padding:4px 0;text-align:right">${{printf "%.2f" .Subtotal}}</td></tr>
    {{if gt .ShippingCost 0.0}}<tr><td style="padding:4px 0;color:#64748b">Shipping</td><td style="padding:4px 0;text-align:right">${{printf "%.2f" .ShippingCost}}</td></tr>{{end}}
    {{if gt .TaxAmount 0.0}}<tr><td style="padding:4px 0;color:#64748b">Tax</td><td style="padding:4px 0;text-align:right">${{printf "%.2f" .TaxAmount}}</td></tr>{{end}}
    {{if gt .PromoDiscount 0.0}}<tr><td style="padding:4px 0;color:#059669">Discount{{if .PromoCode}} ({{.PromoCode}}){{end}}</td><td style="padding:4px 0;text-align:right;color:#059669">-${{printf "%.2f" .PromoDiscount}}</td></tr>{{end}}
    <tr><td style="padding:8px 0 0;font-weight:bold;border-top:1px solid #e2e8f0;font-size:16px">Total</td><td style="padding:8px 0 0;font-weight:bold;border-top:1px solid #e2e8f0;text-align:right;font-size:16px;color:#0d9488">${{printf "%.2f" .GrandTotal}}</td></tr>
  </table>
  {{else}}
  <p style="font-size:18px;font-weight:bold;text-align:right;margin-top:16px">
    Total: <span style="color:#0d9488">${{printf "%.2f" .GrandTotal}}</span>
  </p>
  {{end}}
  {{if .DeliveryAddress}}
  <div style="margin-top:32px;padding:16px;background:#f8fafc;border-radius:8px;font-size:14px;line-height:1.5">
    <div style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Ship to</div>
    {{if .DeliveryAddress.RecipientName}}<div style="color:#0f172a">{{.DeliveryAddress.RecipientName}}</div>{{end}}
    {{if .DeliveryAddress.Street}}<div style="color:#0f172a">{{.DeliveryAddress.Street}}</div>{{end}}
    {{if or .DeliveryAddress.City .DeliveryAddress.State .DeliveryAddress.Zip}}<div style="color:#0f172a">{{.DeliveryAddress.City}}{{if and .DeliveryAddress.City (or .DeliveryAddress.State .DeliveryAddress.Zip)}}, {{end}}{{.DeliveryAddress.State}}{{if and .DeliveryAddress.State .DeliveryAddress.Zip}} {{end}}{{.DeliveryAddress.Zip}}</div>{{end}}
    {{if .DeliveryAddress.PhoneNumber}}<div style="color:#64748b;font-size:12px;margin-top:4px">{{.DeliveryAddress.PhoneNumber}}</div>{{end}}
  </div>
  {{end}}
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0">
  <p style="color:#64748b;font-size:12px">— {{.BrandName}}{{if .BrandEmail}} · <a href="mailto:{{.BrandEmail}}" style="color:#64748b;text-decoration:none">{{.BrandEmail}}</a>{{end}}</p>
</body>
</html>`

// ─────────────────────── New Order Notification (to company owner) ───────────────────────

type NewOrderToCompanyData struct {
	OrderID         string
	CustomerEmail   string
	Subtotal        float64
	ShippingCost    float64
	TaxAmount       float64
	PromoCode       string
	PromoDiscount   float64
	GrandTotal      float64
	Items           []OrderItemView
	DeliveryAddress *DeliveryAddressView // nil for pickup or legacy orders; "Ship to" block omitted when nil
}

// NewOrderToCompanyMessage is sent to the company owner when a customer places an order
// on their storefront. Always sent via the platform sender (BusinessCart SES).
func NewOrderToCompanyMessage(to string, data NewOrderToCompanyData) Message {
	return Message{
		To:       to,
		Subject:  fmt.Sprintf("New order on your store #%s ($%.2f)", lastSix(data.OrderID), data.GrandTotal),
		HTMLBody: renderHTML(newOrderToCompanyHTMLTmpl, data),
		TextBody: newOrderToCompanyText(data),
	}
}

func newOrderToCompanyText(d NewOrderToCompanyData) string {
	var b bytes.Buffer
	fmt.Fprintf(&b, "New order on your storefront.\n\n")
	fmt.Fprintf(&b, "Order #%s\n", lastSix(d.OrderID))
	fmt.Fprintf(&b, "Customer: %s\n\n", d.CustomerEmail)
	for _, it := range d.Items {
		fmt.Fprintf(&b, "  - %s x%d  $%.2f\n", it.Name, it.Quantity, it.Price)
	}
	// Show breakdown when any sub-total is non-zero so the merchant can
	// reconcile a discounted Total against list price. Falls through to the
	// legacy single-line total when only GrandTotal is set (backward compat).
	if d.Subtotal > 0 || d.TaxAmount > 0 || d.ShippingCost > 0 || d.PromoDiscount > 0 {
		fmt.Fprintf(&b, "\nSubtotal: $%.2f\n", d.Subtotal)
		if d.ShippingCost > 0 {
			fmt.Fprintf(&b, "Shipping: $%.2f\n", d.ShippingCost)
		}
		if d.TaxAmount > 0 {
			fmt.Fprintf(&b, "Tax:      $%.2f\n", d.TaxAmount)
		}
		if d.PromoDiscount > 0 {
			if d.PromoCode != "" {
				fmt.Fprintf(&b, "Discount (%s): -$%.2f\n", d.PromoCode, d.PromoDiscount)
			} else {
				fmt.Fprintf(&b, "Discount: -$%.2f\n", d.PromoDiscount)
			}
		}
		fmt.Fprintf(&b, "Total:    $%.2f\n", d.GrandTotal)
	} else {
		fmt.Fprintf(&b, "\nTotal: $%.2f\n", d.GrandTotal)
	}
	if d.DeliveryAddress != nil {
		fmt.Fprintf(&b, "\nShip to:\n")
		if d.DeliveryAddress.RecipientName != "" {
			fmt.Fprintf(&b, "  %s\n", d.DeliveryAddress.RecipientName)
		}
		if d.DeliveryAddress.Street != "" {
			fmt.Fprintf(&b, "  %s\n", d.DeliveryAddress.Street)
		}
		stateZip := ""
		if d.DeliveryAddress.State != "" && d.DeliveryAddress.Zip != "" {
			stateZip = d.DeliveryAddress.State + " " + d.DeliveryAddress.Zip
		} else if d.DeliveryAddress.State != "" {
			stateZip = d.DeliveryAddress.State
		} else if d.DeliveryAddress.Zip != "" {
			stateZip = d.DeliveryAddress.Zip
		}
		switch {
		case d.DeliveryAddress.City != "" && stateZip != "":
			fmt.Fprintf(&b, "  %s, %s\n", d.DeliveryAddress.City, stateZip)
		case d.DeliveryAddress.City != "":
			fmt.Fprintf(&b, "  %s\n", d.DeliveryAddress.City)
		case stateZip != "":
			fmt.Fprintf(&b, "  %s\n", stateZip)
		}
		if d.DeliveryAddress.PhoneNumber != "" {
			fmt.Fprintf(&b, "  %s\n", d.DeliveryAddress.PhoneNumber)
		}
	}
	fmt.Fprintf(&b, "\nView in dashboard: https://businesscart.ai/orders\n\nBusinessCart\n")
	return b.String()
}

const newOrderToCompanyHTMLTmpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>New order on your store</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="color:#0d9488;margin-bottom:8px">New order on your store</h1>
  <p style="font-size:14px;color:#64748b">Order ID: <strong>{{.OrderID}}</strong></p>
  <p style="font-size:14px;color:#64748b">Customer: <strong>{{.CustomerEmail}}</strong></p>
  <table style="width:100%;border-collapse:collapse;margin:24px 0">
    <tbody>
      {{range .Items}}
      <tr>
        <td style="padding:8px 8px 8px 0;border-bottom:1px solid #f1f5f9;width:64px;vertical-align:top">
          {{if .Image}}<img src="{{.Image}}" alt="{{.Name}}" width="56" height="56" style="width:56px;height:56px;border-radius:6px;border:1px solid #e2e8f0;object-fit:cover;display:block" />{{else}}<div style="width:56px;height:56px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px"></div>{{end}}
        </td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;vertical-align:top">
          <div style="font-size:14px;color:#1e293b;font-weight:600">{{.Name}}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">Qty {{.Quantity}}</div>
        </td>
        <td style="padding:8px 0 8px 8px;border-bottom:1px solid #f1f5f9;text-align:right;vertical-align:top;font-size:14px;font-weight:600">${{printf "%.2f" .Price}}</td>
      </tr>
      {{end}}
    </tbody>
  </table>
  {{if or (gt .Subtotal 0.0) (gt .TaxAmount 0.0) (gt .ShippingCost 0.0) (gt .PromoDiscount 0.0)}}
  <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
    <tr><td style="padding:4px 0;color:#64748b">Subtotal</td><td style="padding:4px 0;text-align:right">${{printf "%.2f" .Subtotal}}</td></tr>
    {{if gt .ShippingCost 0.0}}<tr><td style="padding:4px 0;color:#64748b">Shipping</td><td style="padding:4px 0;text-align:right">${{printf "%.2f" .ShippingCost}}</td></tr>{{end}}
    {{if gt .TaxAmount 0.0}}<tr><td style="padding:4px 0;color:#64748b">Tax</td><td style="padding:4px 0;text-align:right">${{printf "%.2f" .TaxAmount}}</td></tr>{{end}}
    {{if gt .PromoDiscount 0.0}}<tr><td style="padding:4px 0;color:#059669">Discount{{if .PromoCode}} ({{.PromoCode}}){{end}}</td><td style="padding:4px 0;text-align:right;color:#059669">-${{printf "%.2f" .PromoDiscount}}</td></tr>{{end}}
    <tr><td style="padding:8px 0 0;font-weight:bold;border-top:1px solid #e2e8f0;font-size:16px">Total</td><td style="padding:8px 0 0;font-weight:bold;border-top:1px solid #e2e8f0;text-align:right;font-size:16px;color:#0d9488">${{printf "%.2f" .GrandTotal}}</td></tr>
  </table>
  {{else}}
  <p style="font-size:18px;font-weight:bold;text-align:right;margin-top:16px">
    Total: <span style="color:#0d9488">${{printf "%.2f" .GrandTotal}}</span>
  </p>
  {{end}}
  {{if .DeliveryAddress}}
  <div style="margin-top:24px;padding:16px;background:#f8fafc;border-radius:8px;font-size:14px;line-height:1.5">
    <div style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Ship to</div>
    {{if .DeliveryAddress.RecipientName}}<div style="color:#0f172a;font-weight:600">{{.DeliveryAddress.RecipientName}}</div>{{end}}
    {{if .DeliveryAddress.Street}}<div style="color:#0f172a">{{.DeliveryAddress.Street}}</div>{{end}}
    {{if or .DeliveryAddress.City .DeliveryAddress.State .DeliveryAddress.Zip}}<div style="color:#0f172a">{{.DeliveryAddress.City}}{{if and .DeliveryAddress.City (or .DeliveryAddress.State .DeliveryAddress.Zip)}}, {{end}}{{.DeliveryAddress.State}}{{if and .DeliveryAddress.State .DeliveryAddress.Zip}} {{end}}{{.DeliveryAddress.Zip}}</div>{{end}}
    {{if .DeliveryAddress.PhoneNumber}}<div style="color:#64748b;font-size:12px;margin-top:4px">{{.DeliveryAddress.PhoneNumber}}</div>{{end}}
  </div>
  {{end}}
  <p style="margin:24px 0">
    <a href="https://businesscart.ai/orders" style="background:#0d9488;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:16px">View in Dashboard</a>
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0">
  <p style="color:#64748b;font-size:12px">— BusinessCart (notification from your platform)</p>
</body>
</html>`

// ─────────────────────── Quote Requested ───────────────────────

type QuoteRequestedData struct {
	QuoteID    string
	BrandName  string
	BrandEmail string
}

// QuoteRequestedMessage builds the email sent to the customer when they create a negotiable quote.
func QuoteRequestedMessage(to string, data QuoteRequestedData) Message {
	return Message{
		To:       to,
		Subject:  fmt.Sprintf("Quote request received #%s", lastSix(data.QuoteID)),
		HTMLBody: renderHTML(quoteRequestedHTMLTmpl, data),
		TextBody: fmt.Sprintf("Your quote request has been received.\n\nQuote ID: %s\n\nThe seller will review and respond shortly. You'll receive another email when there's an update.\n\n%s\n", data.QuoteID, brandFooterText(data.BrandName, data.BrandEmail)),
	}
}

const quoteRequestedHTMLTmpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Quote request received</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="color:#0d9488;margin-bottom:8px">Quote request received</h1>
  <p style="font-size:14px;color:#64748b">Quote ID: <strong>{{.QuoteID}}</strong></p>
  <p style="font-size:16px;line-height:1.5">The seller will review your request and respond shortly.</p>
  <p style="font-size:16px;line-height:1.5">You'll receive another email when there's an update on your quote.</p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0">
  <p style="color:#64748b;font-size:12px">— {{.BrandName}}{{if .BrandEmail}} · <a href="mailto:{{.BrandEmail}}" style="color:#64748b;text-decoration:none">{{.BrandEmail}}</a>{{end}}</p>
</body>
</html>`

// ─────────────────────── Quote Status Changed ───────────────────────

type QuoteStatusData struct {
	QuoteID    string
	Status     string // "approved", "rejected", "proposed", etc.
	BrandName  string
	BrandEmail string
}

// QuoteStatusMessage builds the email sent to the customer when a quote status changes.
func QuoteStatusMessage(to string, data QuoteStatusData) Message {
	return Message{
		To:       to,
		Subject:  fmt.Sprintf("Quote update #%s — %s", lastSix(data.QuoteID), data.Status),
		HTMLBody: renderHTML(quoteStatusHTMLTmpl, data),
		TextBody: fmt.Sprintf("Your quote has been updated.\n\nQuote ID: %s\nNew status: %s\n\nLog in to BusinessCart to view details and continue.\n\n%s\n", data.QuoteID, data.Status, brandFooterText(data.BrandName, data.BrandEmail)),
	}
}

const quoteStatusHTMLTmpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Quote update</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="color:#0d9488;margin-bottom:8px">Quote update</h1>
  <p style="font-size:14px;color:#64748b">Quote ID: <strong>{{.QuoteID}}</strong></p>
  <p style="font-size:16px;line-height:1.5">New status: <strong style="color:#0d9488">{{.Status}}</strong></p>
  <p style="font-size:16px;line-height:1.5">Log in to <a href="https://businesscart.ai" style="color:#0d9488;text-decoration:none">BusinessCart</a> to view details.</p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0">
  <p style="color:#64748b;font-size:12px">— {{.BrandName}}{{if .BrandEmail}} · <a href="mailto:{{.BrandEmail}}" style="color:#64748b;text-decoration:none">{{.BrandEmail}}</a>{{end}}</p>
</body>
</html>`

// ─────────────────────── Order Approval Request ───────────────────────

type ApprovalRequestData struct {
	QuoteID       string
	StepName      string
	RequesterName string
	GrandTotal    float64
	ExpiresAt     string
	BrandName     string
	BrandEmail    string
	// True when this is the SELLING organisation's own sign-off (Roadmap #21d),
	// which is a different thing to approve: their rep is asking to SEND a quote,
	// not to commit to buying one. The buyer-worded copy told a sales manager an
	// order had been "placed" and asked them to approve it, on a quote the
	// customer had not even been shown yet.
	SellerSide bool
}

// ApprovalRequestMessage builds the email sent to an approver when an order is
// waiting on their sign-off. Sent to every approver on the current step: any one
// of them can clear it, which is what stops an order stalling when someone is
// away.
func ApprovalRequestMessage(to string, data ApprovalRequestData) Message {
	return Message{
		To:       to,
		Subject:  fmt.Sprintf("Approval needed: order #%s ($%.2f)", lastSix(data.QuoteID), data.GrandTotal),
		HTMLBody: renderHTML(approvalRequestHTMLTmpl, data),
		TextBody: approvalRequestText(data),
	}
}

func approvalRequestText(d ApprovalRequestData) string {
	var b bytes.Buffer
	if d.SellerSide {
		b.WriteString("A quote is waiting for your approval before it goes to the customer.\n\n")
	} else {
		b.WriteString("An order is waiting for your approval.\n\n")
	}
	b.WriteString(fmt.Sprintf("Quote ID: %s\n", d.QuoteID))
	if d.RequesterName != "" {
		if d.SellerSide {
			b.WriteString(fmt.Sprintf("Customer: %s\n", d.RequesterName))
		} else {
			b.WriteString(fmt.Sprintf("Requested by: %s\n", d.RequesterName))
		}
	}
	b.WriteString(fmt.Sprintf("Quote total: $%.2f\n", d.GrandTotal))
	if d.StepName != "" {
		b.WriteString(fmt.Sprintf("Approval step: %s\n", d.StepName))
	}
	if d.ExpiresAt != "" {
		b.WriteString(fmt.Sprintf("\nPlease respond by %s. After that this request can no longer be decided, because the total is a price snapshot taken when the quote was priced.\n", d.ExpiresAt))
	}
	b.WriteString("\nLog in to BusinessCart to approve or reject.\n\n")
	b.WriteString(brandFooterText(d.BrandName, d.BrandEmail))
	b.WriteString("\n")
	return b.String()
}

const approvalRequestHTMLTmpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Approval needed</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="color:#0d9488;margin-bottom:8px">Approval needed</h1>
  <p style="font-size:16px;line-height:1.5">{{if .SellerSide}}A quote is waiting for your approval before it goes to the customer.{{else}}An order is waiting for your approval.{{end}}</p>
  <p style="font-size:14px;color:#64748b">Quote ID: <strong>{{.QuoteID}}</strong></p>
  {{if .RequesterName}}<p style="font-size:16px;line-height:1.5">{{if .SellerSide}}Customer{{else}}Requested by{{end}}: <strong>{{.RequesterName}}</strong></p>{{end}}
  <p style="font-size:20px;line-height:1.5">Quote total: <strong style="color:#0d9488">${{printf "%.2f" .GrandTotal}}</strong></p>
  {{if .StepName}}<p style="font-size:14px;color:#64748b">Approval step: {{.StepName}}</p>{{end}}
  {{if .ExpiresAt}}<p style="font-size:14px;color:#b45309">Please respond by {{.ExpiresAt}}. After that this request can no longer be decided, because the total is a price snapshot taken when the quote was priced.</p>{{end}}
  <p style="font-size:16px;line-height:1.5">Log in to <a href="https://businesscart.ai" style="color:#0d9488;text-decoration:none">BusinessCart</a> to approve or reject this order.</p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0">
  <p style="color:#64748b;font-size:12px">— {{.BrandName}}{{if .BrandEmail}} · <a href="mailto:{{.BrandEmail}}" style="color:#64748b;text-decoration:none">{{.BrandEmail}}</a>{{end}}</p>
</body>
</html>`

// lastSix returns the last 6 characters of an ID for compact display.
func lastSix(s string) string {
	if len(s) <= 6 {
		return s
	}
	return s[len(s)-6:]
}

// ─────────────────────── Review Request (post-purchase) ───────────────────────

type ReviewRequestData struct {
	OrderID      string
	CustomerName string // optional; falls back to "there" in greeting
	Items        []OrderItemView
	BrandName    string
	BrandEmail   string
	StoreURL     string // homepage of the brand storefront (optional)
}

// ReviewRequestMessage builds the post-purchase review-request email sent to the
// customer. Customer replies with their review by email; the company admin then
// manually adds it to the product via the admin UI. Manual flow by design (no
// public submission endpoint, no spam vector).
func ReviewRequestMessage(to string, data ReviewRequestData) Message {
	subj := "How was your order?"
	if len(data.Items) == 1 {
		subj = "How was your " + data.Items[0].Name + "?"
	}
	return Message{
		To:       to,
		Subject:  subj,
		HTMLBody: renderHTML(reviewRequestHTMLTmpl, data),
		TextBody: reviewRequestText(data),
	}
}

func reviewRequestText(d ReviewRequestData) string {
	var b bytes.Buffer
	name := d.CustomerName
	if name == "" {
		name = "there"
	}
	fmt.Fprintf(&b, "Hi %s,\n\n", name)
	if len(d.Items) == 1 {
		fmt.Fprintf(&b, "Thanks for ordering %s. We hope you're enjoying it!\n\n", d.Items[0].Name)
	} else {
		fmt.Fprintf(&b, "Thanks for your recent order. We hope you're enjoying it!\n\n")
	}
	fmt.Fprintf(&b, "Would you take a minute to share your experience? Just hit reply with:\n\n")
	fmt.Fprintf(&b, "  - Your name (as you'd like it shown)\n")
	fmt.Fprintf(&b, "  - A rating from 1 to 5 stars\n")
	fmt.Fprintf(&b, "  - A short title\n")
	fmt.Fprintf(&b, "  - A few sentences about your experience\n\n")
	fmt.Fprintf(&b, "Your honest feedback helps other shoppers decide and helps us improve.\n\n")
	fmt.Fprintf(&b, "Order #%s\n\n", lastSix(d.OrderID))
	fmt.Fprintf(&b, "%s\n", brandFooterText(d.BrandName, d.BrandEmail))
	return b.String()
}

const reviewRequestHTMLTmpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>How was your order?</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="color:#0d9488;margin-bottom:8px">How was your order?</h1>
  <p style="font-size:16px;line-height:1.5">Hi {{if .CustomerName}}{{.CustomerName}}{{else}}there{{end}},</p>
  {{if eq (len .Items) 1}}
    <p style="font-size:16px;line-height:1.5">Thanks for ordering <strong>{{(index .Items 0).Name}}</strong>. We hope you're enjoying it!</p>
  {{else}}
    <p style="font-size:16px;line-height:1.5">Thanks for your recent order. We hope you're enjoying it!</p>
  {{end}}

  {{if .Items}}
  <table style="width:100%;border-collapse:collapse;margin:20px 0">
    <tbody>
      {{range .Items}}
      <tr>
        <td style="padding:8px 8px 8px 0;border-bottom:1px solid #f1f5f9;width:64px;vertical-align:top">
          {{if .Image}}<img src="{{.Image}}" alt="{{.Name}}" width="56" height="56" style="width:56px;height:56px;border-radius:6px;border:1px solid #e2e8f0;object-fit:cover;display:block" />{{else}}<div style="width:56px;height:56px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px"></div>{{end}}
        </td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;vertical-align:top">
          <div style="font-size:14px;color:#1e293b;font-weight:600">{{.Name}}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">Qty {{.Quantity}}</div>
        </td>
      </tr>
      {{end}}
    </tbody>
  </table>
  {{end}}

  <h2 style="font-size:15px;color:#1e293b;margin-top:24px;margin-bottom:8px">Would you take a minute to share your experience?</h2>
  <p style="font-size:15px;line-height:1.6;margin:0 0 8px">Just hit <strong>Reply</strong> with:</p>
  <ul style="font-size:15px;line-height:1.7;color:#1e293b;margin:0 0 16px;padding-left:20px">
    <li>Your name (as you'd like it shown)</li>
    <li>A rating from 1 to 5 stars</li>
    <li>A short title</li>
    <li>A few sentences about your experience</li>
  </ul>
  <p style="font-size:14px;line-height:1.5;color:#64748b">Your honest feedback helps other shoppers decide and helps us improve.</p>

  <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0">
  <p style="font-size:12px;color:#64748b">Order #{{.OrderID}}</p>
  <p style="color:#64748b;font-size:12px">— {{.BrandName}}{{if .BrandEmail}} · <a href="mailto:{{.BrandEmail}}" style="color:#64748b;text-decoration:none">{{.BrandEmail}}</a>{{end}}</p>
</body>
</html>`

// ─────────────────────── Monthly Statement ───────────────────────

// MonthlyStatementData is the flat view of a billing statement sent to a
// company. The handler flattens an order.Statement into this struct so the
// email package stays decoupled from the order domain.
type MonthlyStatementData struct {
	CompanyName         string
	PeriodLabel         string // e.g., "April 1 – April 30, 2026"
	Tier                string // "Starter" | "Growth" | "Enterprise"
	OrderCount          int
	TotalGrandTotal     float64 // their gross revenue in the period
	TotalRefunded       float64 // refunds issued in the period; fees are charged on gross minus this
	MonthlyFee          float64
	PerOrderRateStr     string // pre-formatted, e.g., "6%, capped at $5/order"
	TransactionFees     float64
	TotalDue            float64
	PaymentInstructions string // plain text — varies per customer arrangement
}

// MonthlyStatementMessage builds the monthly billing statement email sent to a
// company by the platform admin. Sender is BusinessCart; recipient is the
// company's billing contact. Manual trigger (no cron) at this stage.
func MonthlyStatementMessage(to string, data MonthlyStatementData) Message {
	return Message{
		To:       to,
		Subject:  fmt.Sprintf("BusinessCart statement — %s — total $%.2f", data.PeriodLabel, data.TotalDue),
		HTMLBody: renderHTML(monthlyStatementHTMLTmpl, data),
		TextBody: monthlyStatementText(data),
	}
}

// NetRevenue is gross minus refunds. A method rather than a field so the HTML
// template cannot drift from the plain-text body, which computes the same thing.
func (d MonthlyStatementData) NetRevenue() float64 {
	return d.TotalGrandTotal - d.TotalRefunded
}

func monthlyStatementText(d MonthlyStatementData) string {
	var b bytes.Buffer
	fmt.Fprintf(&b, "BusinessCart Monthly Statement\n\n")
	fmt.Fprintf(&b, "Account: %s\n", d.CompanyName)
	fmt.Fprintf(&b, "Period:  %s\n\n", d.PeriodLabel)
	fmt.Fprintf(&b, "Pricing tier:        %s (%s)\n", d.Tier, d.PerOrderRateStr)
	fmt.Fprintf(&b, "Orders this period:  %d\n", d.OrderCount)
	fmt.Fprintf(&b, "Your gross revenue:  $%.2f\n", d.TotalGrandTotal)
	// Only shown when refunds exist, so a period without them reads exactly as
	// before. Without these two lines a seller sees fees that do not match the
	// gross figure above and has no way to tell why.
	if d.TotalRefunded > 0 {
		fmt.Fprintf(&b, "Refunds issued:     -$%.2f\n", d.TotalRefunded)
		fmt.Fprintf(&b, "Net revenue:         $%.2f\n", d.NetRevenue())
	}
	fmt.Fprintf(&b, "\nCharges\n")
	fmt.Fprintf(&b, "  Transaction fees:  $%.2f\n", d.TransactionFees)
	fmt.Fprintf(&b, "  ─────────────────────────────\n")
	fmt.Fprintf(&b, "  Total due:         $%.2f\n\n", d.TotalDue)
	if d.PaymentInstructions != "" {
		fmt.Fprintf(&b, "Payment\n%s\n\n", d.PaymentInstructions)
	}
	fmt.Fprintf(&b, "Questions? Reply to this email.\n\n— BusinessCart\n")
	return b.String()
}

const monthlyStatementHTMLTmpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>BusinessCart statement</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="color:#0d9488;margin-bottom:8px">Monthly Statement</h1>
  <p style="font-size:14px;color:#64748b;margin:0">Account: <strong>{{.CompanyName}}</strong></p>
  <p style="font-size:14px;color:#64748b;margin:4px 0 24px">Period: <strong>{{.PeriodLabel}}</strong></p>

  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tbody>
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;color:#64748b">Pricing tier</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:right"><strong>{{.Tier}}</strong> &middot; <span style="color:#64748b">{{.PerOrderRateStr}}</span></td>
      </tr>
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;color:#64748b">Orders this period</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:right"><strong>{{.OrderCount}}</strong></td>
      </tr>
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;color:#64748b">Your gross revenue</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:right">${{printf "%.2f" .TotalGrandTotal}}</td>
      </tr>
      {{if gt .TotalRefunded 0.0}}
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;color:#64748b">Refunds issued</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:right;color:#b91c1c">-${{printf "%.2f" .TotalRefunded}}</td>
      </tr>
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;color:#64748b">Net revenue</td>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:right"><strong>${{printf "%.2f" .NetRevenue}}</strong></td>
      </tr>
      {{end}}
    </tbody>
  </table>

  <h2 style="color:#1e293b;font-size:16px;margin-top:32px;margin-bottom:8px">Charges</h2>
  <table style="width:100%;border-collapse:collapse">
    <tbody>
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#64748b">Transaction fees</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right">${{printf "%.2f" .TransactionFees}}</td>
      </tr>
      <tr>
        <td style="padding:12px 8px;font-weight:bold;font-size:18px">Total due</td>
        <td style="padding:12px 8px;text-align:right;font-weight:bold;font-size:18px;color:#0d9488">${{printf "%.2f" .TotalDue}}</td>
      </tr>
    </tbody>
  </table>

  {{if .PaymentInstructions}}
  <h2 style="color:#1e293b;font-size:16px;margin-top:32px;margin-bottom:8px">Payment</h2>
  <p style="font-size:14px;line-height:1.5;color:#1e293b;white-space:pre-line">{{.PaymentInstructions}}</p>
  {{end}}

  <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0">
  <p style="font-size:13px;color:#64748b">Questions? Just reply to this email.</p>
  <p style="color:#64748b;font-size:12px;margin-top:24px">— BusinessCart</p>
</body>
</html>`

// ─────────────────────── Order Shipped (to customer) ───────────────────────

type OrderShippedData struct {
	OrderID         string
	GrandTotal      float64
	Items           []OrderItemView
	TrackingCarrier string
	TrackingNumber  string
	TrackingURL     string
	BrandName       string
	BrandEmail      string
}

func OrderShippedMessage(to string, data OrderShippedData) Message {
	return Message{
		To:       to,
		Subject:  fmt.Sprintf("Your order #%s has shipped", lastSix(data.OrderID)),
		HTMLBody: renderHTML(orderShippedHTMLTmpl, data),
		TextBody: orderShippedText(data),
	}
}

func orderShippedText(d OrderShippedData) string {
	var b bytes.Buffer
	fmt.Fprintf(&b, "Good news — your order #%s has shipped.\n\n", lastSix(d.OrderID))
	if len(d.Items) > 0 {
		fmt.Fprintf(&b, "What's on its way:\n")
		for _, it := range d.Items {
			fmt.Fprintf(&b, "  - %s x%d  $%.2f\n", it.Name, it.Quantity, it.Price)
		}
		fmt.Fprintf(&b, "\nOrder total: $%.2f\n\n", d.GrandTotal)
	}
	if d.TrackingCarrier != "" {
		fmt.Fprintf(&b, "Shipped via: %s\n", d.TrackingCarrier)
	}
	if d.TrackingNumber != "" {
		fmt.Fprintf(&b, "Tracking number: %s\n", d.TrackingNumber)
	}
	if d.TrackingURL != "" {
		fmt.Fprintf(&b, "Track at: %s\n", d.TrackingURL)
	}
	fmt.Fprintf(&b, "\nThank you for your order. Reply to this email if you have any questions.\n\n%s\n", brandFooterText(d.BrandName, d.BrandEmail))
	return b.String()
}

const orderShippedHTMLTmpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Your order has shipped</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="color:#0d9488;margin-bottom:8px">Your order is on its way</h1>
  <p style="font-size:14px;color:#64748b;margin-top:0">Order #{{.OrderID}}</p>

  {{if .Items}}
  <h2 style="font-size:15px;color:#1e293b;margin-top:24px;margin-bottom:8px">What's on its way</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
    <tbody>
      {{range .Items}}
      <tr>
        <td style="padding:8px 8px 8px 0;border-bottom:1px solid #f1f5f9;width:64px;vertical-align:top">
          {{if .Image}}<img src="{{.Image}}" alt="{{.Name}}" width="56" height="56" style="width:56px;height:56px;border-radius:6px;border:1px solid #e2e8f0;object-fit:cover;display:block" />{{else}}<div style="width:56px;height:56px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px"></div>{{end}}
        </td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;vertical-align:top">
          <div style="font-size:14px;color:#1e293b;font-weight:600">{{.Name}}</div>
          <div style="font-size:12px;color:#64748b;margin-top:2px">Qty {{.Quantity}}</div>
        </td>
        <td style="padding:8px 0 8px 8px;border-bottom:1px solid #f1f5f9;text-align:right;vertical-align:top;font-size:14px;font-weight:600">${{printf "%.2f" .Price}}</td>
      </tr>
      {{end}}
    </tbody>
  </table>
  <p style="font-size:15px;text-align:right;font-weight:bold;margin:0 0 24px">Order total: ${{printf "%.2f" .GrandTotal}}</p>
  {{end}}

  {{if or .TrackingCarrier .TrackingNumber}}
  <h2 style="font-size:15px;color:#1e293b;margin-bottom:8px">Tracking</h2>
  <table style="width:100%;background:#f8fafc;padding:12px;border-radius:8px;margin-bottom:16px">
    <tr>
      {{if .TrackingCarrier}}<td style="padding:4px 8px;font-size:14px"><strong>Carrier:</strong> {{.TrackingCarrier}}</td>{{end}}
      {{if .TrackingNumber}}<td style="padding:4px 8px;font-size:14px"><strong>Number:</strong> {{.TrackingNumber}}</td>{{end}}
    </tr>
  </table>
  {{if .TrackingURL}}<p style="margin:16px 0"><a href="{{.TrackingURL}}" style="background:#0d9488;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Track package</a></p>{{end}}
  {{end}}

  <p style="color:#64748b;font-size:13px;margin-top:24px">Thank you for your order. Reply to this email if you have any questions.</p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0">
  <p style="color:#64748b;font-size:12px">— {{.BrandName}}{{if .BrandEmail}} · <a href="mailto:{{.BrandEmail}}" style="color:#64748b;text-decoration:none">{{.BrandEmail}}</a>{{end}}</p>
</body>
</html>`

// ─────────────────────── Order Refunded ───────────────────────
// Sent to both the customer and the company admin when a refund is recorded
// against an order. Works for partial and full refunds; the "Type" field
// drives the wording ("partial refund" vs "full refund").

type OrderRefundedItem struct {
	Name     string
	Quantity int
	Amount   float64
}

type OrderRefundedData struct {
	OrderID         string
	Type            string // "partial" or "full"
	RefundAmount    float64
	GrandTotal      float64
	NetTotal        float64
	Reason          string
	StripeRefundRef string // last 4-8 chars of Stripe refund ID for trust signal
	Items           []OrderRefundedItem
	BrandName       string
	BrandEmail      string
}

func OrderRefundedMessage(to string, data OrderRefundedData) Message {
	subject := fmt.Sprintf("Refund processed for order #%s", lastSix(data.OrderID))
	if data.Type == "full" {
		subject = fmt.Sprintf("Full refund processed for order #%s", lastSix(data.OrderID))
	}
	return Message{
		To:       to,
		Subject:  subject,
		HTMLBody: renderHTML(orderRefundedHTMLTmpl, data),
		TextBody: orderRefundedText(data),
	}
}

func orderRefundedText(d OrderRefundedData) string {
	var b bytes.Buffer
	kind := "partial refund"
	if d.Type == "full" {
		kind = "full refund"
	}
	fmt.Fprintf(&b, "A %s has been processed for order #%s.\n\n", kind, lastSix(d.OrderID))
	fmt.Fprintf(&b, "Refunded: $%.2f\n", d.RefundAmount)
	fmt.Fprintf(&b, "Original order total: $%.2f\n", d.GrandTotal)
	if d.Type == "partial" {
		fmt.Fprintf(&b, "Net after refund: $%.2f\n", d.NetTotal)
	}
	if d.StripeRefundRef != "" {
		fmt.Fprintf(&b, "Stripe reference: ...%s\n", d.StripeRefundRef)
	}
	if d.Reason != "" {
		fmt.Fprintf(&b, "\nReason: %s\n", d.Reason)
	}
	if len(d.Items) > 0 {
		fmt.Fprintf(&b, "\nItems refunded:\n")
		for _, it := range d.Items {
			fmt.Fprintf(&b, "  - %s x%d  $%.2f\n", it.Name, it.Quantity, it.Amount)
		}
	}
	fmt.Fprintf(&b, "\nThe refund typically appears on your statement within 5-10 business days.\n")
	fmt.Fprintf(&b, "Reply to this email if you have any questions.\n\n%s\n", brandFooterText(d.BrandName, d.BrandEmail))
	return b.String()
}

const orderRefundedHTMLTmpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Refund processed</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="color:#0d9488;margin-bottom:8px">{{if eq .Type "full"}}Full refund processed{{else}}Refund processed{{end}}</h1>
  <p style="font-size:14px;color:#64748b;margin-top:0">Order #{{.OrderID}}</p>

  <table style="width:100%;background:#f8fafc;padding:16px;border-radius:8px;margin:16px 0">
    <tr>
      <td style="padding:6px 8px;font-size:14px"><strong>Refunded:</strong></td>
      <td style="padding:6px 8px;font-size:14px;text-align:right"><strong>${{printf "%.2f" .RefundAmount}}</strong></td>
    </tr>
    <tr>
      <td style="padding:6px 8px;font-size:13px;color:#64748b">Original order total</td>
      <td style="padding:6px 8px;font-size:13px;color:#64748b;text-align:right">${{printf "%.2f" .GrandTotal}}</td>
    </tr>
    {{if eq .Type "partial"}}
    <tr>
      <td style="padding:6px 8px;font-size:13px;color:#64748b">Net after refund</td>
      <td style="padding:6px 8px;font-size:13px;color:#64748b;text-align:right">${{printf "%.2f" .NetTotal}}</td>
    </tr>
    {{end}}
    {{if .StripeRefundRef}}
    <tr>
      <td style="padding:6px 8px;font-size:13px;color:#64748b">Stripe reference</td>
      <td style="padding:6px 8px;font-size:13px;color:#64748b;text-align:right;font-family:monospace">...{{.StripeRefundRef}}</td>
    </tr>
    {{end}}
  </table>

  {{if .Reason}}
  <p style="font-size:14px;color:#1e293b;margin:16px 0"><strong>Reason:</strong> {{.Reason}}</p>
  {{end}}

  {{if .Items}}
  <h2 style="font-size:15px;color:#1e293b;margin-top:24px;margin-bottom:8px">Items refunded</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
    <tbody>
      {{range .Items}}
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px">{{.Name}}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b">Qty {{.Quantity}}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-size:14px;font-weight:600">${{printf "%.2f" .Amount}}</td>
      </tr>
      {{end}}
    </tbody>
  </table>
  {{end}}

  <p style="color:#64748b;font-size:13px;margin-top:24px">The refund typically appears on your statement within 5-10 business days. Reply to this email if you have any questions.</p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0">
  <p style="color:#64748b;font-size:12px">{{.BrandName}}{{if .BrandEmail}} · <a href="mailto:{{.BrandEmail}}" style="color:#64748b;text-decoration:none">{{.BrandEmail}}</a>{{end}}</p>
</body>
</html>`

// ─────────────────────── Order Cancelled ───────────────────────

// OrderCancelledData is a cancelled order as the customer needs to see it.
//
// Deliberately leaner than OrderConfirmationData: no tax, shipping or discount
// breakdown. Nothing is being charged, so itemising the maths would make a
// cancellation read like an invoice. What matters is which order, what was in
// it, and what happens next.
type OrderCancelledData struct {
	OrderID    string
	GrandTotal float64
	Items      []OrderItemView
	BrandName  string
	BrandEmail string
}

// OrderCancelledMessage tells the CUSTOMER their order was cancelled. Sent
// through the merchant's own sender, like the confirmation and shipped notices.
func OrderCancelledMessage(to string, data OrderCancelledData) Message {
	return Message{
		To:       to,
		Subject:  fmt.Sprintf("Your order #%s has been cancelled", lastSix(data.OrderID)),
		HTMLBody: renderHTML(orderCancelledHTMLTmpl, data),
		TextBody: orderCancelledText(data),
	}
}

func orderCancelledText(d OrderCancelledData) string {
	var b bytes.Buffer
	fmt.Fprintf(&b, "Your order #%s has been cancelled.\n\n", lastSix(d.OrderID))
	if len(d.Items) > 0 {
		fmt.Fprintf(&b, "Cancelled items:\n")
		for _, it := range d.Items {
			fmt.Fprintf(&b, "  - %s x%d\n", it.Name, it.Quantity)
		}
		fmt.Fprintf(&b, "\nOrder value: $%.2f\n\n", d.GrandTotal)
	}
	fmt.Fprintf(&b, "If this was not expected, reply to this email and we will look into it.\n\n%s\n",
		brandFooterText(d.BrandName, d.BrandEmail))
	return b.String()
}

const orderCancelledHTMLTmpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Your order has been cancelled</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="color:#0d9488;margin-bottom:8px">Your order has been cancelled</h1>
  <p style="font-size:14px;color:#64748b;margin-top:0">Order #{{.OrderID}}</p>

  {{if .Items}}
  <h2 style="font-size:15px;color:#1e293b;margin-top:24px;margin-bottom:8px">Cancelled items</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
    <tbody>
      {{range .Items}}
      <tr>
        <td style="padding:8px 8px 8px 0;border-bottom:1px solid #f1f5f9;width:64px;vertical-align:top">
          {{if .Image}}<img src="{{.Image}}" alt="{{.Name}}" width="56" height="56" style="width:56px;height:56px;border-radius:6px;object-fit:cover">{{end}}
        </td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;vertical-align:top">
          <div style="font-weight:600">{{.Name}}</div>
          <div style="color:#64748b;font-size:13px">Qty {{.Quantity}}</div>
        </td>
      </tr>
      {{end}}
    </tbody>
  </table>
  <p style="font-size:15px;color:#64748b">Order value: ${{printf "%.2f" .GrandTotal}}</p>
  {{end}}

  <p style="font-size:15px;line-height:1.5">If this was not expected, reply to this email and we will look into it.</p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0">
  <p style="color:#64748b;font-size:12px">{{if .BrandName}}{{.BrandName}}{{else}}BusinessCart{{end}}{{if .BrandEmail}} &middot; {{.BrandEmail}}{{end}}</p>
</body>
</html>`

// OrderCancelledToCompanyData is the merchant's copy: enough to identify the
// order and know the stock is free again.
type OrderCancelledToCompanyData struct {
	OrderID       string
	CustomerEmail string
	GrandTotal    float64
	Items         []OrderItemView
}

// OrderCancelledToCompanyMessage tells the COMPANY OWNER an order was cancelled.
// Always sent via the platform sender (BusinessCart SES), like
// NewOrderToCompanyMessage.
func OrderCancelledToCompanyMessage(to string, data OrderCancelledToCompanyData) Message {
	return Message{
		To:       to,
		Subject:  fmt.Sprintf("Order cancelled on your store #%s ($%.2f)", lastSix(data.OrderID), data.GrandTotal),
		HTMLBody: renderHTML(orderCancelledToCompanyHTMLTmpl, data),
		TextBody: orderCancelledToCompanyText(data),
	}
}

func orderCancelledToCompanyText(d OrderCancelledToCompanyData) string {
	var b bytes.Buffer
	fmt.Fprintf(&b, "An order on your storefront was cancelled.\n\n")
	fmt.Fprintf(&b, "Order #%s\n", lastSix(d.OrderID))
	if d.CustomerEmail != "" {
		fmt.Fprintf(&b, "Customer: %s\n", d.CustomerEmail)
	}
	if len(d.Items) > 0 {
		fmt.Fprintf(&b, "\nCancelled items:\n")
		for _, it := range d.Items {
			fmt.Fprintf(&b, "  - %s x%d\n", it.Name, it.Quantity)
		}
	}
	fmt.Fprintf(&b, "\nOrder value: $%.2f\n", d.GrandTotal)
	fmt.Fprintf(&b, "\nhttps://businesscart.ai/orders\n\n- BusinessCart\n")
	return b.String()
}

const orderCancelledToCompanyHTMLTmpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Order cancelled on your store</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="color:#0d9488;margin-bottom:8px">Order cancelled</h1>
  <p style="font-size:14px;color:#64748b;margin-top:0">Order #{{.OrderID}}{{if .CustomerEmail}} &middot; {{.CustomerEmail}}{{end}}</p>

  {{if .Items}}
  <h2 style="font-size:15px;color:#1e293b;margin-top:24px;margin-bottom:8px">Cancelled items</h2>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
    <tbody>
      {{range .Items}}
      <tr>
        <td style="padding:8px 8px 8px 0;border-bottom:1px solid #f1f5f9">{{.Name}}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;color:#64748b;text-align:right">Qty {{.Quantity}}</td>
      </tr>
      {{end}}
    </tbody>
  </table>
  {{end}}
  <p style="font-size:15px;color:#64748b">Order value: ${{printf "%.2f" .GrandTotal}}</p>
  <p style="margin:24px 0">
    <a href="https://businesscart.ai/orders" style="background:#0d9488;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:16px">View Orders</a>
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0">
  <p style="color:#64748b;font-size:12px">- BusinessCart (notification from your platform)</p>
</body>
</html>`
