package handler

import (
	"testing"

	"business-cart/catalog-service/internal/storage"
)

// Audience decides whether a product is marketed to consumers on the public
// storefront and whether it belongs in the consumer shopping feeds. The default
// is the part that matters most: every product written before this field
// existed has no `audience` key at all, and must keep behaving exactly as it
// did. That is what makes this change migration-free.
func TestNormalizeAudience_EmptyMeansRetail(t *testing.T) {
	cases := map[string]string{
		"":                         storage.AudienceRetail,
		storage.AudienceRetail:     storage.AudienceRetail,
		storage.AudienceWholesale:  storage.AudienceWholesale,
		storage.AudienceBoth:       storage.AudienceBoth,
		"RETAIL":                   storage.AudienceRetail, // not canonical, so retail
		"b2b":                      storage.AudienceRetail, // unknown, so retail
		"wholesale ":               storage.AudienceRetail, // untrimmed, so retail
		"anything-a-bad-write-did": storage.AudienceRetail,
	}
	for in, want := range cases {
		if got := storage.NormalizeAudience(in); got != want {
			t.Errorf("NormalizeAudience(%q) = %q, want %q", in, got, want)
		}
	}
}

// A value that fails NormalizeAudience must never reach storage in the first
// place, which is what IsValidAudience gates at the handler. The two work as a
// pair: the handler rejects bad input, and normalize keeps an already-stored
// bad value harmless rather than letting it hide a product from the storefront.
func TestIsValidAudience(t *testing.T) {
	valid := []string{"", storage.AudienceRetail, storage.AudienceWholesale, storage.AudienceBoth}
	for _, v := range valid {
		if !storage.IsValidAudience(v) {
			t.Errorf("IsValidAudience(%q) = false, want true", v)
		}
	}

	invalid := []string{"RETAIL", "Wholesale", "b2b", "b2c", "trade", "wholesale ", " ", "both,retail"}
	for _, v := range invalid {
		if storage.IsValidAudience(v) {
			t.Errorf("IsValidAudience(%q) = true, want false (handler must reject it)", v)
		}
	}
}

// Guard on the safety property itself, stated as a test so it cannot be
// weakened by accident: nothing normalizes to wholesale unless it was written
// as exactly "wholesale". A typo must never silently pull a product off the
// consumer storefront and out of the shopping feeds.
func TestNormalizeAudience_OnlyExactWholesaleHidesAProduct(t *testing.T) {
	for _, near := range []string{"wholesale ", " wholesale", "Wholesale", "WHOLESALE", "whole sale", "wholesalee"} {
		if storage.NormalizeAudience(near) == storage.AudienceWholesale {
			t.Errorf("NormalizeAudience(%q) resolved to wholesale; only the exact value may", near)
		}
	}
}
