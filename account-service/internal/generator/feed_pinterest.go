package generator

import (
	"fmt"
	"strings"
	"time"
)

// Pinterest product catalog CSV feed.
// Spec: https://help.pinterest.com/en/business/article/before-you-get-started-with-catalogs
// Uses spaces in availability ("in stock"), price format "29.99 USD".

func buildPinterestFeed(data StorefrontData) ([]byte, error) {
	domain := data.Domain
	if domain == "" {
		return nil, fmt.Errorf("no domain configured")
	}

	now := time.Now()
	var b strings.Builder

	// Header
	b.WriteString("id,title,description,link,image_link,price,availability,condition,brand,product_type,google_product_category,sale_price,shipping_weight,shipping_width,shipping_height," + customLabelHeader(",") + "\n")

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

		// Pinterest takes a weight plus WIDTH and HEIGHT only — its spec has no
		// length field. The all-three gate still applies before either is sent,
		// so a half-measured package is never published to any channel.
		_, pinWidth, pinHeight := feedShippingDims(p)

		b.WriteString(fmt.Sprintf("%s,%s,%s,%s,%s,%.2f USD,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s\n",
			csvEscape(p.ID),
			csvEscape(p.Name),
			csvEscape(stripHTML(p.Description)),
			csvEscape(fmt.Sprintf("https://%s/products/%s.html", domain, p.Filename)),
			csvEscape(image),
			p.Price,
			csvEscape(availability),
			"new",
			csvEscape(data.Company.Name),
			csvEscape(feedCategory(p.Category)),
			csvEscape(p.GoogleProductCategory),
			csvEscape(salePrice),
			csvEscape(feedShippingWeight(p)),
			csvEscape(pinWidth),
			csvEscape(pinHeight),
			customLabelCols(p, ",", csvEscape),
		))
	}

	return []byte(b.String()), nil
}
