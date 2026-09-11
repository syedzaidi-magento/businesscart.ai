package generator

import (
	"fmt"
	"strings"
	"time"
)

// TikTok Shop / TikTok Ads product catalog CSV feed.
// Spec: https://seller-us.tiktok.com/
// Key differences: uses "sku_id" (not "id"), "google_product_category" optional (recommended),
// availability uses spaces ("in stock").

func buildTikTokFeed(data StorefrontData) ([]byte, error) {
	domain := data.Domain
	if domain == "" {
		return nil, fmt.Errorf("no domain configured")
	}

	now := time.Now()
	var b strings.Builder

	// Header — TikTok uses sku_id, not id
	b.WriteString("sku_id,title,description,availability,condition,price,image_link,brand,google_product_category,product_type,product_page_url,sale_price,shipping_weight," + customLabelHeader(",") + "\n")

	for _, p := range data.Products {
		// Wholesale-only never enters a consumer shopping feed: it has no consumer
		// price and no buy path, so an ad for it would send a shopper to a page
		// they cannot purchase from.
		if p.IsWholesaleOnly() {
			continue
		}
		if p.Price <= 0 {
			continue
		}
		if p.Stock <= 0 {
			continue
		}
		availability := "in stock"

		salePrice := ""
		if p.DealPrice > 0 && p.DiscountedPrice > 0 {
			active := true
			if p.DealStartDate != nil && p.DealStartDate.After(now) {
				active = false
			}
			if p.DealEndDate != nil && p.DealEndDate.Before(now) {
				active = false
			}
			if active {
				salePrice = fmt.Sprintf("%.2f USD", p.DiscountedPrice)
			}
		}

		image := ""
		if len(p.Images) > 0 {
			image = p.Images[0]
		}

		// TikTok requires google_product_category — prefer the official taxonomy field, fall back to category
		googleCategory := p.GoogleProductCategory
		if googleCategory == "" {
			googleCategory = feedCategory(p.Category)
		}
		if googleCategory == "" {
			googleCategory = "Other"
		}

		// TikTok's catalog parameter list has a shipping weight but no
		// dimension fields.
		b.WriteString(fmt.Sprintf("%s,%s,%s,%s,%s,%.2f USD,%s,%s,%s,%s,%s,%s,%s,%s\n",
			csvEscape(p.ID),
			csvEscape(p.Name),
			csvEscape(stripHTML(p.Description)),
			csvEscape(availability),
			"new",
			p.Price,
			csvEscape(image),
			csvEscape(data.Company.Name),
			csvEscape(googleCategory),
			// product_type was absent from this feed entirely while the other
			// four channels carried it, so TikTok had no site taxonomy at all.
			csvEscape(feedCategory(p.Category)),
			csvEscape(fmt.Sprintf("https://%s/products/%s.html", domain, p.Filename)),
			csvEscape(salePrice),
			csvEscape(feedShippingWeight(p)),
			customLabelCols(p, ",", csvEscape),
		))
	}

	return []byte(b.String()), nil
}
