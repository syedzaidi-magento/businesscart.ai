package generator

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"strings"
	"time"
)

// Google Product Reviews feed (schema version 2.4).
// Spec: https://developers.google.com/product-review-feeds/schema
//
// Isolation guarantees (zero risk to existing generation):
//   - Pre-flight checkpoints validate inputs; errors return to dispatcher and never panic.
//   - generateSingleFeed in feeds.go wraps this in recover() so any unexpected panic is caught.
//   - Per-review skips are silent (skip bad data, do not abort the feed).
//   - Companies without "google_reviews" in Company.Feeds never call this function.
//
// Behavior:
//   - Emits one <review> per Review across all products that have a Rating with reviews.
//   - Always emits product_url and brand; conditionally emits gtin/mpn/sku when available.
//   - Stable review IDs (SHA-1 of productID+name+date+rating) so Google does not re-process
//     unchanged reviews on subsequent feed fetches.
//   - Schema version 2.4 per current Google developer docs.

func buildGoogleReviewsFeed(data StorefrontData) ([]byte, error) {
	// --- Pre-flight checkpoints ---
	if data.Domain == "" {
		return nil, fmt.Errorf("domain not configured")
	}
	if data.Company == nil || strings.TrimSpace(data.Company.Name) == "" {
		return nil, fmt.Errorf("company name required for publisher block")
	}

	domain := data.Domain
	brandName := strings.TrimSpace(data.Company.Name)

	pub := publisher{Name: brandName}
	if data.Company.LogoURL != "" {
		pub.Favicon = data.Company.LogoURL
	}

	var reviews []reviewItem

	for _, p := range data.Products {
		// Wholesale-only products are absent from the shopping feeds, so reviews
		// submitted for them would reference a product Merchant Center does not
		// have. Same exclusion as the five product feeds, for the same reason: a
		// consumer ad surface must not carry an item with no consumer buy path.
		if p.IsWholesaleOnly() {
			continue
		}
		if p.Rating == nil || len(p.Rating.Reviews) == 0 {
			continue
		}
		if p.Filename == "" {
			continue
		}

		productURL := fmt.Sprintf("https://%s/products/%s.html", domain, p.Filename)

		for _, r := range p.Rating.Reviews {
			// Per-review skip checkpoints (silent — bad data should not abort the feed)
			body := strings.TrimSpace(r.Body)
			if body == "" {
				continue
			}
			if r.Rating < 1 || r.Rating > 5 {
				continue
			}

			ts := r.Date
			if ts.IsZero() {
				ts = time.Now().UTC()
			}

			// Reviewer block
			rev := reviewer{}
			name := strings.TrimSpace(r.Name)
			if name == "" {
				rev.Name = reviewerName{Value: "Anonymous", IsAnonymous: "true"}
			} else {
				rev.Name = reviewerName{Value: name}
			}

			// Product identifiers block — always brand + product_url; conditional gtin/mpn/sku
			ids := productIDs{
				Brands: &brandsBlock{Brand: brandName},
			}
			if p.Barcode != "" {
				ids.GTINs = &gtinsBlock{GTIN: p.Barcode}
			}
			if p.SKU != "" {
				ids.MPNs = &mpnsBlock{MPN: p.SKU}
				ids.SKUs = &skusBlock{SKU: p.SKU}
			}

			productName := strings.TrimSpace(p.Name)

			item := reviewItem{
				ReviewID:           stableReviewID(p.ID, name, ts, r.Rating),
				Reviewer:           rev,
				ReviewTimestamp:    ts.UTC().Format(time.RFC3339),
				Title:              strings.TrimSpace(r.Title),
				Content:            body,
				IsVerifiedPurchase: boolStr(r.Verified),
				CollectionMethod:   "post_fulfillment",
				ReviewURL: reviewURL{
					Type: "singleton",
					URL:  productURL,
				},
				Ratings: ratingsBlock{Overall: overallRating{Min: "1", Max: "5", Value: fmt.Sprintf("%d", r.Rating)}},
				Products: productsBlock{Product: productEntry{
					ProductIDs:  ids,
					ProductName: productName,
					ProductURL:  productURL,
				}},
			}
			reviews = append(reviews, item)
		}
	}

	feed := googleReviewsFeed{
		Version:   "2.4",
		Publisher: pub,
	}
	// Omit empty <reviews> container when there are no reviews to emit.
	if len(reviews) > 0 {
		feed.Reviews = &reviewsContainer{Reviews: reviews}
	}

	output, err := xml.MarshalIndent(feed, "", "  ")
	if err != nil {
		return nil, err
	}
	return append([]byte(xml.Header), output...), nil
}

// stableReviewID returns a 16-char hex SHA-1 prefix of (productID|name|date|rating).
// Deterministic so that re-submitting the same review across regens keeps the same ID.
func stableReviewID(productID, name string, date time.Time, rating int) string {
	h := sha1.New()
	fmt.Fprintf(h, "%s|%s|%s|%d", productID, name, date.UTC().Format(time.RFC3339), rating)
	return hex.EncodeToString(h.Sum(nil))[:16]
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// --- XML schema types (Google Product Reviews feed v2.4) ---

type googleReviewsFeed struct {
	XMLName   xml.Name          `xml:"feed"`
	Version   string            `xml:"version"`
	Publisher publisher         `xml:"publisher"`
	Reviews   *reviewsContainer `xml:"reviews,omitempty"`
}

type publisher struct {
	Name    string `xml:"name"`
	Favicon string `xml:"favicon,omitempty"`
}

type reviewsContainer struct {
	Reviews []reviewItem `xml:"review"`
}

type reviewItem struct {
	ReviewID           string        `xml:"review_id"`
	Reviewer           reviewer      `xml:"reviewer"`
	ReviewTimestamp    string        `xml:"review_timestamp"`
	Title              string        `xml:"title,omitempty"`
	Content            string        `xml:"content"`
	IsVerifiedPurchase string        `xml:"is_verified_purchase,omitempty"`
	CollectionMethod   string        `xml:"collection_method,omitempty"`
	ReviewURL          reviewURL     `xml:"review_url"`
	Ratings            ratingsBlock  `xml:"ratings"`
	Products           productsBlock `xml:"products"`
}

type reviewer struct {
	Name reviewerName `xml:"name"`
}

type reviewerName struct {
	IsAnonymous string `xml:"is_anonymous,attr,omitempty"`
	Value       string `xml:",chardata"`
}

type reviewURL struct {
	Type string `xml:"type,attr"`
	URL  string `xml:",chardata"`
}

type ratingsBlock struct {
	Overall overallRating `xml:"overall"`
}

type overallRating struct {
	Min   string `xml:"min,attr"`
	Max   string `xml:"max,attr"`
	Value string `xml:",chardata"`
}

type productsBlock struct {
	Product productEntry `xml:"product"`
}

type productEntry struct {
	ProductIDs  productIDs `xml:"product_ids"`
	ProductName string     `xml:"product_name,omitempty"`
	ProductURL  string     `xml:"product_url"`
}

type productIDs struct {
	GTINs  *gtinsBlock  `xml:"gtins,omitempty"`
	MPNs   *mpnsBlock   `xml:"mpns,omitempty"`
	SKUs   *skusBlock   `xml:"skus,omitempty"`
	Brands *brandsBlock `xml:"brands,omitempty"`
}

type gtinsBlock struct {
	GTIN string `xml:"gtin"`
}
type mpnsBlock struct {
	MPN string `xml:"mpn"`
}
type skusBlock struct {
	SKU string `xml:"sku"`
}
type brandsBlock struct {
	Brand string `xml:"brand"`
}
