package generator

import (
	"fmt"
	"strings"
	"time"
)

// Bing / Microsoft Merchant Center TSV feed.
// Spec: https://help.ads.microsoft.com/apex/index/3/en/51111
// Format mirrors Google but uses tab-separated values + extra columns.

func buildBingFeed(data StorefrontData) ([]byte, error) {
	domain := data.Domain
	if domain == "" {
		return nil, fmt.Errorf("no domain configured")
	}

	now := time.Now()
	var b strings.Builder
	tab := "\t"

	// Header
	b.WriteString("id" + tab + "title" + tab + "description" + tab + "link" + tab + "image_link" + tab +
		"price" + tab + "sale_price" + tab + "availability" + tab + "condition" + tab + "brand" + tab +
		"gtin" + tab + "mpn" + tab + "product_type" + tab + "google_product_category" + tab + "color" + tab + "size" + tab + "material" + tab +
		"gender" + tab + "age_group" + tab + "identifier_exists" + tab + "shipping_weight" + tab +
		customLabelHeader(tab) + "\n")

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

		identifierExists := "true"
		if p.Barcode == "" && p.SKU == "" {
			identifierExists = "false"
		}

		gender := productAttr(p.Attributes, "gender")
		if gender == "" && data.Config != nil && data.Config.FeedGender != "" {
			gender = data.Config.FeedGender
		}
		gender = strings.ToLower(gender)
		ageGroup := productAttr(p.Attributes, "age_group", "age group", "agegroup")
		if ageGroup == "" && data.Config != nil && data.Config.FeedAgeGroup != "" {
			ageGroup = data.Config.FeedAgeGroup
		}
		ageGroup = strings.ToLower(ageGroup)

		b.WriteString(tsvSafe(p.ID) + tab +
			tsvSafe(p.Name) + tab +
			tsvSafe(stripHTML(p.Description)) + tab +
			fmt.Sprintf("https://%s/products/%s.html", domain, p.Filename) + tab +
			image + tab +
			fmt.Sprintf("%.2f USD", p.Price) + tab +
			salePrice + tab +
			availability + tab +
			"new" + tab +
			tsvSafe(data.Company.Name) + tab +
			p.Barcode + tab +
			p.SKU + tab +
			tsvSafe(feedCategory(p.Category)) + tab +
			tsvSafe(p.GoogleProductCategory) + tab +
			tsvSafe(productAttr(p.Attributes, "color", "colour")) + tab +
			tsvSafe(productAttr(p.Attributes, "size")) + tab +
			tsvSafe(productAttr(p.Attributes, "material")) + tab +
			tsvSafe(gender) + tab +
			tsvSafe(ageGroup) + tab +
			identifierExists + tab +
			// Microsoft's product model carries a shipping weight but no
			// dimension fields at all, so only the weight is emitted here.
			feedShippingWeight(p) + tab +
			customLabelCols(p, tab, tsvSafe) + "\n")
	}

	return []byte(b.String()), nil
}

// tsvSafe removes tabs and newlines from a value.
func tsvSafe(s string) string {
	s = strings.ReplaceAll(s, "\t", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", "")
	return s
}
