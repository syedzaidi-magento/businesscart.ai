package storage

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type Attribute struct {
	Key   string `bson:"key" json:"key"`
	Value string `bson:"value" json:"value"`
	Type  string `bson:"type,omitempty" json:"type,omitempty"`
}

type PriceTier struct {
	MinQty int     `bson:"minQty" json:"minQty"`
	Price  float64 `bson:"price" json:"price"`
}

// Product.Audience values. Empty string is equivalent to AudienceRetail; use
// NormalizeAudience rather than comparing to "" at each call site.
const (
	AudienceRetail    = "retail"
	AudienceWholesale = "wholesale"
	AudienceBoth      = "both"
)

// NormalizeAudience maps a stored value to one of the three canonical values,
// treating anything unrecognised (including "") as retail. Retail is the safe
// default: it is what every product did before the field existed.
func NormalizeAudience(a string) string {
	switch a {
	case AudienceWholesale, AudienceBoth:
		return a
	default:
		return AudienceRetail
	}
}

// IsValidAudience reports whether a is a value a client is allowed to send.
// "" is accepted and means "leave it at the default".
func IsValidAudience(a string) bool {
	switch a {
	case "", AudienceRetail, AudienceWholesale, AudienceBoth:
		return true
	default:
		return false
	}
}

// Review is a single customer review. Admin-added only (no public submission).
type Review struct {
	Name      string    `bson:"name" json:"name"`
	Email     string    `bson:"email,omitempty" json:"email,omitempty"`
	Rating    int       `bson:"rating" json:"rating" validate:"gte=1,lte=5"`
	Title     string    `bson:"title,omitempty" json:"title,omitempty"`
	Body      string    `bson:"body" json:"body"`
	Verified  bool      `bson:"verified,omitempty" json:"verified,omitempty"`
	OrderID   string    `bson:"orderId,omitempty" json:"orderId,omitempty"`
	Date      time.Time `bson:"date" json:"date"`
	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
}

// RatingDistribution is the per-star count. Backend-computed from Reviews on every update.
type RatingDistribution struct {
	Star1 int `bson:"star1,omitempty" json:"star1,omitempty"`
	Star2 int `bson:"star2,omitempty" json:"star2,omitempty"`
	Star3 int `bson:"star3,omitempty" json:"star3,omitempty"`
	Star4 int `bson:"star4,omitempty" json:"star4,omitempty"`
	Star5 int `bson:"star5,omitempty" json:"star5,omitempty"`
}

// Rating is the aggregate + per-review embedded structure on Product.
// Count, Average, Distribution are backend-computed on every update; never trust client values.
type Rating struct {
	Count        int                 `bson:"count,omitempty" json:"count,omitempty"`
	Average      float64             `bson:"average,omitempty" json:"average,omitempty"`
	Distribution *RatingDistribution `bson:"distribution,omitempty" json:"distribution,omitempty"`
	Reviews      []Review            `bson:"reviews,omitempty" json:"reviews,omitempty"`
}

// FAQItem is one merchant-authored question and answer on a product.
// Merchant-owned, not customer-submitted: unlike Review there is no public
// submission path and no moderation queue, so no Verified or Email field.
type FAQItem struct {
	// No validate tags on purpose. go-playground/validator does not descend into
	// slice elements without a `dive` tag, so tags here would never execute and
	// would falsely imply a model-level backstop. The handler is the single
	// enforcement point for both the create and the update path.
	Question  string    `bson:"question" json:"question"`
	Answer    string    `bson:"answer" json:"answer"`
	CreatedAt time.Time `bson:"createdAt" json:"createdAt"`
}

// ProductFAQ is the embedded FAQ structure on Product, mirroring Rating.
// Count is backend-computed on every update; never trust a client value.
//
// Answers the product-level questions that block a purchase and that LLM
// shopping queries are made of ("heat resistant to what temperature", "what
// size for large hands"). Rendered on the PDP as native <details>/<summary>
// and emitted as FAQPage JSON-LD.
//
// NOTE for whoever renders this: the storefront markdown companion is built
// from its OWN product.md template, NOT converted from the rendered HTML. A
// block added to product.html alone ships answers that the .md companion, and
// therefore every AI crawler, never sees. That exact defect shipped on the
// portal /faq page and was fixed in 9b03072. Both templates or neither.
type ProductFAQ struct {
	Count int       `bson:"count,omitempty" json:"count,omitempty"`
	Items []FAQItem `bson:"items,omitempty" json:"items,omitempty"`
}

// BlogPost is an editorial article published on a company's D2C storefront.
// Positioned as informational content (not commercial) — no FAQ schema, no
// ItemList/Product schema. Article + Author + Publisher + BreadcrumbList only.
// Body is markdown source; HTML is rendered at storefront generation time.
type BlogPost struct {
	ID                  primitive.ObjectID `bson:"_id,omitempty" json:"_id,omitempty"`
	SellerID            string             `bson:"sellerID" json:"sellerID"`
	Title               string             `bson:"title" json:"title" validate:"required,min=10,max=200"`
	Slug                string             `bson:"slug" json:"slug" validate:"required,min=3,max=120"`
	Excerpt             string             `bson:"excerpt,omitempty" json:"excerpt,omitempty" validate:"max=300"`
	Body                string             `bson:"body" json:"body" validate:"required,min=200,max=100000"`
	FeaturedImage       string             `bson:"featuredImage,omitempty" json:"featuredImage,omitempty"`
	Author              string             `bson:"author" json:"author" validate:"required,min=2,max=100"`
	AuthorBio           string             `bson:"authorBio,omitempty" json:"authorBio,omitempty" validate:"max=500"`
	Category            string             `bson:"category" json:"category" validate:"required,min=2,max=80"`
	Tags                []string           `bson:"tags,omitempty" json:"tags,omitempty"`
	MentionedProductIDs []string           `bson:"mentionedProductIDs,omitempty" json:"mentionedProductIDs,omitempty"`
	MetaTitle           string             `bson:"metaTitle,omitempty" json:"metaTitle,omitempty" validate:"max=70"`
	MetaDescription     string             `bson:"metaDescription,omitempty" json:"metaDescription,omitempty" validate:"max=160"`
	Active              *bool              `bson:"active,omitempty" json:"active,omitempty"`
	PublishedAt         time.Time          `bson:"publishedAt" json:"publishedAt"`
	CreatedAt           time.Time          `bson:"createdAt" json:"createdAt"`
	UpdatedAt           time.Time          `bson:"updatedAt" json:"updatedAt"`
}

type Product struct {
	ID                    primitive.ObjectID `bson:"_id,omitempty" json:"_id,omitempty"`
	Name                  string             `bson:"name" json:"name"`
	Description           string             `bson:"description,omitempty" json:"description,omitempty"`
	Price                 float64            `bson:"price" json:"price"`
	DealPrice             float64            `bson:"dealPrice,omitempty" json:"dealPrice,omitempty" validate:"gte=0,lte=50"`
	DealStartDate         *time.Time         `bson:"dealStartDate,omitempty" json:"dealStartDate,omitempty"`
	DealEndDate           *time.Time         `bson:"dealEndDate,omitempty" json:"dealEndDate,omitempty"`
	DiscountedPrice       float64            `bson:"-" json:"discountedPrice,omitempty"`
	Cost                  float64            `bson:"cost,omitempty" json:"cost,omitempty"` // Confidential seller unit cost. Admin/API only: NEVER mapped to generator ProductData, feeds, or products.md.
	SellerID              string             `bson:"sellerID" json:"sellerID"`
	PartnerID             string             `bson:"partnerId,omitempty" json:"partnerId,omitempty"`
	Images                []string           `bson:"images,omitempty" json:"images,omitempty"`
	Category              string             `bson:"category,omitempty" json:"category,omitempty"`
	GoogleProductCategory string             `bson:"googleProductCategory,omitempty" json:"googleProductCategory,omitempty"`
	Slug                  string             `bson:"slug,omitempty" json:"slug,omitempty"`
	SKU                   string             `bson:"sku,omitempty" json:"sku,omitempty"`
	Barcode               string             `bson:"barcode,omitempty" json:"barcode,omitempty"`
	Stock                 int                `bson:"stock" json:"stock"`
	Active                *bool              `bson:"active,omitempty" json:"active,omitempty"`
	Featured              bool               `bson:"featured,omitempty" json:"featured,omitempty"`
	PriceTiers            []PriceTier        `bson:"priceTiers,omitempty" json:"priceTiers,omitempty"`
	// Per-product quantity rules (Roadmap #39, precursor to full UOM #38). Buyer-side
	// enforced in the portal (cart / quick-order / add-to-cart) via clampQty.
	MinOrderQty    int `bson:"minOrderQty,omitempty" json:"minOrderQty,omitempty"`
	OrderIncrement int `bson:"orderIncrement,omitempty" json:"orderIncrement,omitempty"` // case pack: order in multiples of this
	MaxOrderQty    int `bson:"maxOrderQty,omitempty" json:"maxOrderQty,omitempty"`
	// Package weight and dimensions, as shipped (the parcel, not the bare product).
	// Units are fixed platform-wide: weight in POUNDS, dimensions in INCHES.
	// Precursor to carrier rating (Roadmap #19) and the shipping_* feed fields.
	Weight float64 `bson:"weight,omitempty" json:"weight,omitempty" validate:"gte=0"`
	Length float64 `bson:"length,omitempty" json:"length,omitempty" validate:"gte=0"`
	Width  float64 `bson:"width,omitempty" json:"width,omitempty" validate:"gte=0"`
	Height float64 `bson:"height,omitempty" json:"height,omitempty" validate:"gte=0"`
	// Merchant-set shopping-feed segmentation labels (Roadmap #45). Invisible to
	// shoppers; they exist only to subdivide ad campaigns by something the site
	// taxonomy cannot express (margin tier, price band, performance tier).
	// Deliberately NOT derived from Category: one site category can legitimately
	// span several ad segments. Capped at 100 to satisfy Google, the strictest of
	// the five channels, so one value stays valid everywhere.
	CustomLabel0 string   `bson:"customLabel0,omitempty" json:"customLabel0,omitempty" validate:"max=100"`
	CustomLabel1 string   `bson:"customLabel1,omitempty" json:"customLabel1,omitempty" validate:"max=100"`
	CustomLabel2 string   `bson:"customLabel2,omitempty" json:"customLabel2,omitempty" validate:"max=100"`
	CustomLabel3 string   `bson:"customLabel3,omitempty" json:"customLabel3,omitempty" validate:"max=100"`
	CustomLabel4 string   `bson:"customLabel4,omitempty" json:"customLabel4,omitempty" validate:"max=100"`
	GroupIDs     []string `bson:"groupIDs,omitempty" json:"groupIDs,omitempty"`
	// Who this product is marketed to on the PUBLIC D2C storefront, and whether it
	// belongs in the consumer shopping feeds. One of AudienceRetail, AudienceWholesale
	// or AudienceBoth; empty means AudienceRetail, so every product written before
	// this field existed keeps exactly the behaviour it had and no migration is needed.
	//
	// SCOPE, and it is deliberately narrow: this drives storefront presentation and
	// feed inclusion ONLY. It does NOT gate B2B portal visibility, which stays with
	// GroupIDs. Defaulting to retail AND gating the portal would have hidden every
	// existing product from every existing B2B customer overnight.
	//
	// It is also not a purchase guard. checkout-service has no catalog dependency by
	// design and cart totals use the client-supplied item price, so a wholesale
	// product simply loses its Add-to-Cart path; nothing server-side rejects it.
	Audience   string      `bson:"audience,omitempty" json:"audience,omitempty"`
	Attributes []Attribute `bson:"attributes,omitempty" json:"attributes,omitempty"`
	Rating     *Rating     `bson:"rating,omitempty" json:"rating,omitempty"`
	FAQ        *ProductFAQ `bson:"faq,omitempty" json:"faq,omitempty"`
	CreatedAt  time.Time   `bson:"createdAt" json:"createdAt"`
	UpdatedAt  time.Time   `bson:"updatedAt" json:"updatedAt"`
}
