package generator

import (
	"encoding/xml"
	"fmt"
	"strings"
	"time"
)

// Google Shopping RSS 2.0 feed with g: namespace.
// Spec: https://support.google.com/merchants/answer/7052112

func buildGoogleFeed(data StorefrontData) ([]byte, error) {
	domain := data.Domain
	if domain == "" {
		return nil, fmt.Errorf("no domain configured")
	}

	now := time.Now()
	var items []googleItem
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
		availability := "in_stock"

		item := googleItem{
			ID:           p.ID,
			Title:        p.Name,
			Description:  stripHTML(p.Description),
			Link:         fmt.Sprintf("https://%s/products/%s.html", domain, p.Filename),
			Availability: availability,
			Price:        fmt.Sprintf("%.2f USD", p.Price),
			Condition:    "new",
			Brand:        data.Company.Name,
		}

		if len(p.Images) > 0 {
			item.ImageLink = p.Images[0]
			if len(p.Images) > 1 {
				item.AdditionalImageLinks = p.Images[1:]
			}
		}

		// Active deal → sale_price
		if p.DealPrice > 0 && p.DiscountedPrice > 0 {
			active := true
			if p.DealStartDate != nil && p.DealStartDate.After(now) {
				active = false
			}
			if p.DealEndDate != nil && p.DealEndDate.Before(now) {
				active = false
			}
			if active {
				item.SalePrice = fmt.Sprintf("%.2f USD", p.DiscountedPrice)
			}
		}

		if p.Barcode != "" {
			item.GTIN = p.Barcode
		}
		if p.SKU != "" {
			item.MPN = p.SKU
		}
		if p.Category != "" {
			item.ProductType = feedCategory(p.Category)
		}
		if p.GoogleProductCategory != "" {
			item.GoogleProductCategory = p.GoogleProductCategory
		}

		// Product attributes → Google Shopping fields (product wins, config default fallback)
		item.Color = productAttr(p.Attributes, "color", "colour")
		item.Size = productAttr(p.Attributes, "size")
		item.Material = productAttr(p.Attributes, "material")
		item.Gender = productAttr(p.Attributes, "gender")
		if item.Gender == "" && data.Config != nil && data.Config.FeedGender != "" {
			item.Gender = data.Config.FeedGender
		}
		item.Gender = strings.ToLower(item.Gender) // Google requires lowercase: male, female, unisex
		item.AgeGroup = productAttr(p.Attributes, "age_group", "age group", "agegroup")
		if item.AgeGroup == "" && data.Config != nil && data.Config.FeedAgeGroup != "" {
			item.AgeGroup = data.Config.FeedAgeGroup
		}
		item.AgeGroup = strings.ToLower(item.AgeGroup) // Google requires lowercase: adult, kids, toddler, infant, newborn

		if item.GTIN == "" && item.MPN == "" {
			item.IdentifierExists = "false"
		}

		// Package specs. Google is the only channel of the five that takes
		// dimensions, and it needs all three or none (see feedShippingDims).
		item.ShippingWeight = feedShippingWeight(p)
		item.ShippingLength, item.ShippingWidth, item.ShippingHeight = feedShippingDims(p)

		labels := feedCustomLabels(p)
		item.CustomLabel0, item.CustomLabel1 = labels[0], labels[1]
		item.CustomLabel2, item.CustomLabel3, item.CustomLabel4 = labels[2], labels[3], labels[4]

		items = append(items, item)
	}

	feed := googleFeed{
		Version:  "2.0",
		GoogleNS: "http://base.google.com/ns/1.0",
		Title:    data.Company.Name + " — Product Catalog",
		Link:     "https://" + domain,
		Desc:     "Shopping feed for " + data.Company.Name,
		Items:    items,
	}

	output, err := xml.MarshalIndent(feed, "", "  ")
	if err != nil {
		return nil, err
	}
	return append([]byte(xml.Header), output...), nil
}

type googleFeed struct {
	XMLName  xml.Name     `xml:"rss"`
	Version  string       `xml:"version,attr"`
	GoogleNS string       `xml:"xmlns:g,attr"`
	Title    string       `xml:"channel>title"`
	Link     string       `xml:"channel>link"`
	Desc     string       `xml:"channel>description"`
	Items    []googleItem `xml:"channel>item"`
}

type googleItem struct {
	ID                    string   `xml:"g:id"`
	Title                 string   `xml:"g:title"`
	Description           string   `xml:"g:description"`
	Link                  string   `xml:"g:link"`
	ImageLink             string   `xml:"g:image_link,omitempty"`
	AdditionalImageLinks  []string `xml:"g:additional_image_link,omitempty"`
	Availability          string   `xml:"g:availability"`
	Price                 string   `xml:"g:price"`
	SalePrice             string   `xml:"g:sale_price,omitempty"`
	Condition             string   `xml:"g:condition"`
	Brand                 string   `xml:"g:brand"`
	GTIN                  string   `xml:"g:gtin,omitempty"`
	MPN                   string   `xml:"g:mpn,omitempty"`
	ProductType           string   `xml:"g:product_type,omitempty"`
	GoogleProductCategory string   `xml:"g:google_product_category,omitempty"`
	Color                 string   `xml:"g:color,omitempty"`
	Size                  string   `xml:"g:size,omitempty"`
	Material              string   `xml:"g:material,omitempty"`
	Gender                string   `xml:"g:gender,omitempty"`
	AgeGroup              string   `xml:"g:age_group,omitempty"`
	IdentifierExists      string   `xml:"g:identifier_exists,omitempty"`
	ShippingWeight        string   `xml:"g:shipping_weight,omitempty"`
	ShippingLength        string   `xml:"g:shipping_length,omitempty"`
	ShippingWidth         string   `xml:"g:shipping_width,omitempty"`
	ShippingHeight        string   `xml:"g:shipping_height,omitempty"`
	CustomLabel0          string   `xml:"g:custom_label_0,omitempty"`
	CustomLabel1          string   `xml:"g:custom_label_1,omitempty"`
	CustomLabel2          string   `xml:"g:custom_label_2,omitempty"`
	CustomLabel3          string   `xml:"g:custom_label_3,omitempty"`
	CustomLabel4          string   `xml:"g:custom_label_4,omitempty"`
}

// productAttr finds a product attribute by key (case-insensitive). Returns "" if not found.
func productAttr(attrs []Attribute, keys ...string) string {
	for _, a := range attrs {
		lower := strings.ToLower(a.Key)
		for _, k := range keys {
			if lower == k {
				return a.Value
			}
		}
	}
	return ""
}

// feedCategory converts "Gloves / BBQ" to "Gloves > BBQ" for shopping feeds.
func feedCategory(cat string) string {
	primary, sub := parseCategoryParts(cat)
	if sub != "" {
		return primary + " > " + sub
	}
	return primary
}

func stripHTML(s string) string {
	// Simple HTML tag stripper + newline normalizer for feed descriptions
	var b strings.Builder
	inTag := false
	for _, r := range s {
		if r == '<' {
			inTag = true
			continue
		}
		if r == '>' {
			inTag = false
			continue
		}
		if !inTag {
			if r == '\n' || r == '\r' {
				b.WriteRune(' ')
			} else {
				b.WriteRune(r)
			}
		}
	}
	return strings.TrimSpace(b.String())
}
