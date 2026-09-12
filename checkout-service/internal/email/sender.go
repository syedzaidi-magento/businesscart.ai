// Package email provides a stdlib-only SMTP wrapper for sending transactional emails.
//
// This file is intentionally a near-duplicate of account-service/internal/email/sender.go
// — services stay independent, no shared module, zero new dependencies.
//
// Phase 1 design:
//   - Uses Go's net/smtp + crypto/tls — no third-party dependencies
//   - Designed for AWS SES SMTP endpoint but works with any SMTP server
//   - Falls back to a no-op logger if any required env var is missing
//     so local SAM dev works without SMTP setup
//   - All sends are non-blocking from the caller's perspective
//
// Required env vars (when real sender wanted):
//
//	EMAIL_FROM_ADDRESS    e.g., "noreply@businesscart.ai"
//	EMAIL_SMTP_HOST       e.g., "email-smtp.us-east-1.amazonaws.com"
//	EMAIL_SMTP_PORT       e.g., "587"
//	EMAIL_SMTP_USERNAME   SES SMTP username (NOT IAM access key)
//	EMAIL_SMTP_PASSWORD   SES SMTP password
package email

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"log"
	"net/smtp"
	"os"
	"strings"
	"sync"
)

type Sender interface {
	Send(ctx context.Context, msg Message) error
}

type Message struct {
	To       string
	ReplyTo  string
	Subject  string
	HTMLBody string
	TextBody string
}

type Config struct {
	From       string // bare email — used as SMTP envelope MAIL FROM
	FromHeader string // optional RFC 5322 display-name form for MIME From: header. Falls back to From.
	Host       string
	Port       string
	Username   string
	Password   string
}

type smtpSender struct {
	cfg Config
}

type noopSender struct {
	from string
}

func (n *noopSender) Send(_ context.Context, msg Message) error {
	log.Printf("[email DRY RUN] from=%s to=%s subject=%q", n.from, msg.To, msg.Subject)
	return nil
}

// NewSender creates a Sender. Returns no-op if config is incomplete.
func NewSender(_ context.Context, cfg Config) Sender {
	if cfg.From == "" || cfg.Host == "" || cfg.Port == "" || cfg.Username == "" || cfg.Password == "" {
		log.Printf("[email] SMTP not fully configured — using no-op sender (from=%q host=%q)", cfg.From, cfg.Host)
		return &noopSender{from: cfg.From}
	}
	return &smtpSender{cfg: cfg}
}

// unencryptedAuth wraps smtp.Auth to bypass Go's stdlib refusal to send PLAIN
// auth over a non-TLS connection. Used ONLY when EMAIL_SMTP_ALLOW_PLAINTEXT_AUTH=true
// — set in local.env.json for Mailpit testing, never in production SSM. Production
// SES advertises STARTTLS so Go negotiates encryption naturally; the wrapper is a
// no-op there because the env var is never set.
type unencryptedAuth struct{ smtp.Auth }

func (a unencryptedAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	s := *server
	s.TLS = true
	return a.Auth.Start(&s)
}

func (s *smtpSender) Send(_ context.Context, msg Message) error {
	if msg.To == "" {
		return nil
	}
	headerFrom := s.cfg.FromHeader
	if headerFrom == "" {
		headerFrom = s.cfg.From
	}
	if msg.ReplyTo == "" {
		msg.ReplyTo = s.cfg.From
	}
	body := buildMIME(headerFrom, msg)
	addr := s.cfg.Host + ":" + s.cfg.Port
	var auth smtp.Auth = smtp.PlainAuth("", s.cfg.Username, s.cfg.Password, s.cfg.Host)
	// Local-only Mailpit testing: bypass Go's TLS-required check for PLAIN auth.
	// Production SES on port 587 advertises STARTTLS so this branch never triggers.
	if os.Getenv("EMAIL_SMTP_ALLOW_PLAINTEXT_AUTH") == "true" {
		auth = unencryptedAuth{auth}
	}

	if s.cfg.Port == "465" {
		return sendImplicitTLS(addr, s.cfg.Host, auth, s.cfg.From, []string{msg.To}, body)
	}
	return smtp.SendMail(addr, auth, s.cfg.From, []string{msg.To}, body)
}

func sendImplicitTLS(addr, host string, auth smtp.Auth, from string, to []string, body []byte) error {
	tlsConfig := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
	conn, err := tls.Dial("tcp", addr, tlsConfig)
	if err != nil {
		return fmt.Errorf("tls dial: %w", err)
	}
	defer conn.Close()

	c, err := smtp.NewClient(conn, host)
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	defer c.Close()

	if err := c.Auth(auth); err != nil {
		return fmt.Errorf("auth: %w", err)
	}
	if err := c.Mail(from); err != nil {
		return fmt.Errorf("mail: %w", err)
	}
	for _, addr := range to {
		if err := c.Rcpt(addr); err != nil {
			return fmt.Errorf("rcpt: %w", err)
		}
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("data: %w", err)
	}
	if _, err := w.Write(body); err != nil {
		return fmt.Errorf("write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("close: %w", err)
	}
	return c.Quit()
}

// sanitizeHeader strips CR and LF from a header value.
//
// SECURITY: buildMIME writes header values straight into the message, so any
// newline in one lets a caller append arbitrary headers. Duplicated from
// account-service deliberately, like the rest of this file: the services stay
// independent, and a header-injection guard must not depend on the other
// service being patched. Stripped rather than rejected, and applied here rather
// than at each call site, so no future caller has to remember: a header value
// is one line, always.
func sanitizeHeader(v string) string {
	return strings.NewReplacer("\r", "", "\n", "").Replace(v)
}

func buildMIME(from string, msg Message) []byte {
	var b strings.Builder
	boundary := "BC-MIME-BOUNDARY-2026"

	b.WriteString("From: " + sanitizeHeader(from) + "\r\n")
	b.WriteString("To: " + sanitizeHeader(msg.To) + "\r\n")
	if msg.ReplyTo != "" {
		b.WriteString("Reply-To: " + sanitizeHeader(msg.ReplyTo) + "\r\n")
	}
	b.WriteString("Subject: " + sanitizeHeader(msg.Subject) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Auto-Submitted: auto-generated\r\n")

	if msg.HTMLBody != "" && msg.TextBody != "" {
		b.WriteString("Content-Type: multipart/alternative; boundary=\"" + boundary + "\"\r\n\r\n")
		b.WriteString("--" + boundary + "\r\n")
		b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
		b.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
		b.WriteString(msg.TextBody + "\r\n\r\n")
		b.WriteString("--" + boundary + "\r\n")
		b.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
		b.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
		b.WriteString(msg.HTMLBody + "\r\n\r\n")
		b.WriteString("--" + boundary + "--\r\n")
	} else if msg.HTMLBody != "" {
		b.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
		b.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
		b.WriteString(msg.HTMLBody + "\r\n")
	} else {
		b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
		b.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
		b.WriteString(msg.TextBody + "\r\n")
	}

	return []byte(b.String())
}

// ---- Per-company branded email -------------------------------------------------
//
// Customer-facing emails (welcome, password reset, order confirmation, quote events)
// use the matching company's own SMTP so the customer sees their storefront brand.
// Loaded once at Lambda init from EMAIL_COMPANY_CONFIGS env var (JSON map keyed by
// sellerId hex). Adding a customer = edit JSON in SSM + cdk deploy. No CDK code change.

// CompanyEmailConfig is one entry in the EMAIL_COMPANY_CONFIGS JSON map.
type CompanyEmailConfig struct {
	FromAddress  string `json:"fromAddress"`
	FromName     string `json:"fromName"`
	SMTPHost     string `json:"smtpHost"`
	SMTPPort     string `json:"smtpPort"`
	SMTPUsername string `json:"smtpUsername"`
	SMTPPassword string `json:"smtpPassword"`
	OwnerEmail   string `json:"ownerEmail"`
}

var (
	companyConfigs map[string]CompanyEmailConfig
	companyOnce    sync.Once
)

func loadCompanyConfigs() {
	// sync.Once ensures parse runs exactly once across all goroutines, with an
	// atomic-load fast path after first call (no mutex contention on hot send sites).
	companyOnce.Do(func() {
		raw := os.Getenv("EMAIL_COMPANY_CONFIGS")
		if raw == "" || raw == "{}" {
			companyConfigs = map[string]CompanyEmailConfig{}
			return
		}
		if err := json.Unmarshal([]byte(raw), &companyConfigs); err != nil {
			log.Printf("WARN: EMAIL_COMPANY_CONFIGS JSON parse failed: %v — falling back to platform sender for all", err)
			companyConfigs = map[string]CompanyEmailConfig{}
		}
	})
}

// GetCompanyConfig returns the per-company SMTP config for a sellerId.
// Returns ok=false when the sellerId has no entry, OR when the entry is missing
// required SMTP fields — caller falls back to the platform Sender.
func GetCompanyConfig(sellerID string) (CompanyEmailConfig, bool) {
	loadCompanyConfigs()
	cfg, ok := companyConfigs[sellerID]
	if !ok {
		return CompanyEmailConfig{}, false
	}
	if cfg.SMTPHost == "" || cfg.FromAddress == "" {
		return CompanyEmailConfig{}, false
	}
	return cfg, true
}

// CompanyOwnerEmail returns the company owner's notification address (for
// "new customer registered" / "new order received"). Empty string = not
// configured; caller skips the notification.
func CompanyOwnerEmail(sellerID string) string {
	loadCompanyConfigs()
	return companyConfigs[sellerID].OwnerEmail
}

// CompanyBrand returns (displayName, email) for the customer-facing email footer.
// Falls back to ("BusinessCart", "") when the seller has no per-company config —
// preserves today's behavior for unbranded sends.
func CompanyBrand(sellerID string) (name, email string) {
	loadCompanyConfigs()
	cfg, ok := companyConfigs[sellerID]
	if !ok || cfg.FromName == "" {
		return "BusinessCart", ""
	}
	return cfg.FromName, cfg.FromAddress
}

// SenderForCompany builds an SMTP Sender for the company's own server, or
// returns the fallback (platform Sender) if the company has no config.
// Returns the rendered From header in RFC 5322 display-name format when a
// FromName is set, so callers can use it for notification emails.
func SenderForCompany(ctx context.Context, sellerID string, fallback Sender) (sender Sender, fromHeader string) {
	cfg, ok := GetCompanyConfig(sellerID)
	if !ok {
		return fallback, ""
	}
	header := cfg.FromAddress
	if cfg.FromName != "" {
		header = fmt.Sprintf("%q <%s>", cfg.FromName, cfg.FromAddress)
	}
	return NewSender(ctx, Config{
		From:       cfg.FromAddress, // bare envelope address (SMTP MAIL FROM)
		FromHeader: header,          // RFC 5322 display name for MIME From: header
		Host:       cfg.SMTPHost,
		Port:       cfg.SMTPPort,
		Username:   cfg.SMTPUsername,
		Password:   cfg.SMTPPassword,
	}), header
}
