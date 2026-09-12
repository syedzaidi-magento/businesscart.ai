package email

import (
	"strings"
	"testing"
)

// buildMIME writes header values straight into the message, so a newline in one
// appends arbitrary headers. This stopped being theoretical when a buyer-supplied
// email became a Reply-To and a buyer-supplied company name became part of a
// Subject, both arriving from the UNAUTHENTICATED /visitors/event endpoint: a
// crafted address injected a real Bcc and turned the platform's SES into a relay
// carrying our own sending reputation.
//
// Asserted on the rendered bytes rather than on the helper, because the helper
// existing proves nothing if a future header is written without it.
func TestBuildMIMERejectsHeaderInjection(t *testing.T) {
	cases := map[string]Message{
		"via ReplyTo": {
			To:       "owner@shop.test",
			ReplyTo:  "x@y.com\r\nBcc: attacker@evil.test\r\nX-Injected: reply",
			Subject:  "ordinary subject",
			TextBody: "body",
		},
		"via Subject": {
			To:       "owner@shop.test",
			Subject:  "Request: Corner Cafe\r\nBcc: attacker@evil.test\r\nX-Injected: subject",
			TextBody: "body",
		},
		"via To": {
			To:       "owner@shop.test\r\nBcc: attacker@evil.test\r\nX-Injected: to",
			Subject:  "ordinary subject",
			TextBody: "body",
		},
		"bare newline, no carriage return": {
			To:       "owner@shop.test",
			ReplyTo:  "x@y.com\nBcc: attacker@evil.test",
			Subject:  "ordinary subject",
			TextBody: "body",
		},
	}

	for name, msg := range cases {
		t.Run(name, func(t *testing.T) {
			mime := string(buildMIME("platform@businesscart.ai", msg))
			// Check LINE STARTS, not substrings. After sanitizing, an injected
			// "Bcc:" survives as inert text inside the Subject value, which is
			// exactly the desired outcome; a substring check cannot tell that
			// apart from a real header and would fail on a correct fix.
			for _, line := range strings.Split(mime, "\r\n") {
				lower := strings.ToLower(line)
				if strings.HasPrefix(lower, "bcc:") || strings.HasPrefix(lower, "x-injected:") {
					t.Errorf("header injection succeeded, %q is a real header line", line)
				}
			}
			// Every header must be one line: no value may smuggle a break.
			headerBlock := mime
			if i := strings.Index(mime, "\r\n\r\n"); i > 0 {
				headerBlock = mime[:i]
			}
			if n := strings.Count(headerBlock, "\r\n"); n > 8 {
				t.Errorf("header block has %d lines, more than this message should produce:\n%s", n, headerBlock)
			}
			// The message must still be a valid, sendable email rather than
			// mangled: the legitimate headers survive and the body is intact.
			for _, want := range []string{"From: platform@businesscart.ai", "To: owner@shop.test", "Subject: "} {
				if !strings.Contains(mime, want) {
					t.Errorf("sanitizing broke a legitimate header, missing %q", want)
				}
			}
			if !strings.Contains(mime, "body") {
				t.Error("body lost")
			}
		})
	}
}

// A sanitized value must keep everything that is not a line break, so a real
// address or a company name with punctuation is delivered unchanged.
func TestSanitizeHeaderPreservesOrdinaryValues(t *testing.T) {
	for _, v := range []string{
		"dana@corner-cafe.test",
		`Wholesale access request: Solomon's Bakery & Co`,
		"Order cancelled on your store #7017b4 ($23.46)",
		"",
	} {
		if got := sanitizeHeader(v); got != v {
			t.Errorf("sanitizeHeader(%q) = %q, want it unchanged", v, got)
		}
	}
}
