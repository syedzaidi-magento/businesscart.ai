package email

import (
	"bytes"
	"fmt"
	"html/template"
	"log"
)

// renderHTML safely renders an HTML template with auto-escaping for variables.
// On any error, returns an empty string and logs.
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

// welcomeText omits the businesscart.ai login link when the email is branded
// (storefront customers don't have a BC account; they log into the storefront they
// registered on). Keeps the link only for the default unbranded path (admin/company
// users who really do log into businesscart.ai).
func welcomeText(name, footerName, brandName, brandEmail string) string {
	loginLine := ""
	if footerName == "BusinessCart" {
		loginLine = "You can log in at https://businesscart.ai\n\n"
	}
	return fmt.Sprintf("Hi %s,\n\nYour account at %s has been created successfully.\n\n%s%s\n", name, footerName, loginLine, brandFooterText(brandName, brandEmail))
}

// ───────────────────── Welcome ─────────────────────

// WelcomeMessage builds the welcome email sent on registration.
// brandName/brandEmail come from the per-company SMTP config; empty falls back to "BusinessCart".
func WelcomeMessage(name, to, brandName, brandEmail string) Message {
	if name == "" {
		name = "there"
	}
	footerName := brandName
	if footerName == "" {
		footerName = "BusinessCart"
	}
	return Message{
		To:      to,
		Subject: fmt.Sprintf("Welcome to %s", footerName),
		HTMLBody: renderHTML(welcomeHTMLTmpl, struct {
			Name       string
			BrandName  string
			BrandEmail string
		}{name, footerName, brandEmail}),
		TextBody: welcomeText(name, footerName, brandName, brandEmail),
	}
}

// ───────────────────── Password Reset ─────────────────────

// PasswordResetMessage builds the password reset email.
func PasswordResetMessage(name, to, resetURL, brandName, brandEmail string) Message {
	if name == "" {
		name = "there"
	}
	footerName := brandName
	if footerName == "" {
		footerName = "BusinessCart"
	}
	return Message{
		To:      to,
		Subject: "Reset your password",
		HTMLBody: renderHTML(passwordResetHTMLTmpl, struct {
			Name       string
			ResetURL   string
			BrandName  string
			BrandEmail string
		}{name, resetURL, footerName, brandEmail}),
		TextBody: fmt.Sprintf("Hi %s,\n\nWe received a request to reset your password.\n\nReset your password: %s\n\nThis link expires in 1 hour. If you didn't request this, you can safely ignore this email.\n\n%s\n", name, resetURL, brandFooterText(brandName, brandEmail)),
	}
}

const passwordResetHTMLTmpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Reset your password</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="color:#0d9488;margin-bottom:8px">Reset your password</h1>
  <p style="font-size:16px;line-height:1.5">Hi {{.Name}}, we received a request to reset your password.</p>
  <p style="margin:24px 0">
    <a href="{{.ResetURL}}" style="background:#0d9488;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:16px">Reset Password</a>
  </p>
  <p style="font-size:14px;color:#64748b">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0">
  <p style="color:#64748b;font-size:12px">— {{.BrandName}}{{if .BrandEmail}} · <a href="mailto:{{.BrandEmail}}" style="color:#64748b;text-decoration:none">{{.BrandEmail}}</a>{{end}}</p>
</body>
</html>`

const welcomeHTMLTmpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Welcome</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="color:#0d9488;margin-bottom:8px">Welcome, {{.Name}}!</h1>
  <p style="font-size:16px;line-height:1.5">Your account at {{.BrandName}} has been created successfully.</p>
  {{if eq .BrandName "BusinessCart"}}<p style="font-size:16px;line-height:1.5">You can log in at <a href="https://businesscart.ai" style="color:#0d9488;text-decoration:none">businesscart.ai</a>.</p>{{end}}
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0">
  <p style="color:#64748b;font-size:12px">— {{.BrandName}}{{if .BrandEmail}} · <a href="mailto:{{.BrandEmail}}" style="color:#64748b;text-decoration:none">{{.BrandEmail}}</a>{{end}}</p>
</body>
</html>`

// ───────────────────── New Customer Notification ─────────────────────

// NewCustomerToCompanyMessage is sent to the company owner when a new customer
// registers on their storefront. Always sent via the platform sender (BusinessCart SES).
func NewCustomerToCompanyMessage(to, customerName string) Message {
	if customerName == "" {
		customerName = "A new customer"
	}
	return Message{
		To:       to,
		Subject:  fmt.Sprintf("New customer on your store: %s", customerName),
		HTMLBody: renderHTML(newCustomerHTMLTmpl, struct{ Name string }{customerName}),
		TextBody: fmt.Sprintf("Hi,\n\n%s just registered on your storefront.\n\nYou can view your customers in the BusinessCart dashboard: https://businesscart.ai/users\n\n— BusinessCart\n", customerName),
	}
}

const newCustomerHTMLTmpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>New customer on your store</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="color:#0d9488;margin-bottom:8px">New customer on your store</h1>
  <p style="font-size:16px;line-height:1.5"><strong>{{.Name}}</strong> just registered on your storefront.</p>
  <p style="margin:24px 0">
    <a href="https://businesscart.ai/users" style="background:#0d9488;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:16px">View Customers</a>
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0">
  <p style="color:#64748b;font-size:12px">— BusinessCart (notification from your platform)</p>
</body>
</html>`

// B2BAccessRequestData is one wholesale enquiry submitted from a merchant's own
// storefront contact page. Every field is buyer-supplied and optional except the
// ones the form marks required, so the renderer must tolerate blanks.
type B2BAccessRequestData struct {
	Name    string
	Company string
	Email   string
	Phone   string
	Needs   string
}

// B2BAccessRequestMessage tells a MERCHANT that a business buyer wants a trade
// account with them.
//
// Always sent via the platform sender (BusinessCart SES), matching
// NewCustomerToCompanyMessage and the new-order notification: this is the
// platform reporting something to its tenant, not the tenant mailing a shopper,
// so it must not depend on the merchant having configured their own SMTP.
//
// The body ends with the one action that actually unblocks the buyer. Wholesale
// registration is gated on a merchant-issued customer code, so a merchant who
// reads this and does nothing leaves the buyer unable to proceed at all.
func B2BAccessRequestMessage(to string, d B2BAccessRequestData) Message {
	who := d.Company
	if who == "" {
		who = d.Name
	}
	if who == "" {
		who = "A business buyer"
	}
	subject := fmt.Sprintf("Wholesale access request: %s", who)

	text := fmt.Sprintf(`Hi,

%s asked for a wholesale account on your storefront.

Name:     %s
Business: %s
Email:    %s
Phone:    %s
Needs:    %s

To give them access, create a customer code in your BusinessCart portal
under Codes, then send it to them. They register with that code and your
per-customer pricing applies from their first order.

https://businesscart.ai/codes

- BusinessCart
`, who, blankAsDash(d.Name), blankAsDash(d.Company), blankAsDash(d.Email),
		blankAsDash(d.Phone), blankAsDash(d.Needs))

	return Message{
		To: to,
		// Replies go to the buyer, so the merchant can just hit reply rather than
		// copying the address out of the body.
		ReplyTo:  d.Email,
		Subject:  subject,
		HTMLBody: renderHTML(b2bAccessRequestHTMLTmpl, d),
		TextBody: text,
	}
}

func blankAsDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

const b2bAccessRequestHTMLTmpl = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Wholesale access request</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1e293b">
  <h1 style="color:#0d9488;margin-bottom:8px">Wholesale access request</h1>
  <p style="font-size:16px;line-height:1.5">A business buyer asked for a trade account on your storefront.</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:15px">
    <tr><td style="padding:8px;color:#64748b;width:110px">Name</td><td style="padding:8px">{{.Name}}</td></tr>
    <tr><td style="padding:8px;color:#64748b">Business</td><td style="padding:8px"><strong>{{.Company}}</strong></td></tr>
    <tr><td style="padding:8px;color:#64748b">Email</td><td style="padding:8px"><a href="mailto:{{.Email}}">{{.Email}}</a></td></tr>
    <tr><td style="padding:8px;color:#64748b">Phone</td><td style="padding:8px">{{.Phone}}</td></tr>
    <tr><td style="padding:8px;color:#64748b;vertical-align:top">Needs</td><td style="padding:8px">{{.Needs}}</td></tr>
  </table>
  <p style="font-size:15px;line-height:1.5">To give them access, create a customer code under Codes and send it to them. They register with that code and your per-customer pricing applies from their first order.</p>
  <p style="margin:24px 0">
    <a href="https://businesscart.ai/codes" style="background:#0d9488;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:16px">Create a customer code</a>
  </p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0">
  <p style="color:#64748b;font-size:12px">- BusinessCart (notification from your platform)</p>
</body>
</html>`
