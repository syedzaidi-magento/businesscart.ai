package generator

import (
	"business-cart/account-service/internal/storage"
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	texttemplate "text/template"
	"time"
	"unicode"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudfront"
	cftypes "github.com/aws/aws-sdk-go-v2/service/cloudfront/types"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

//go:embed templates/*
var templatesEmbed embed.FS

type StorefrontData struct {
	AccountID        string // The company's Account _id (hex)
	Company          *storage.CompanyData
	Config           *storage.D2CConfig
	Products         []ProductData
	Categories       []string       // Unique list of product categories
	TopCategories    []string       // Top 6 categories by product count (for footer)
	CategoryCounts   map[string]int // Product count per category
	FeaturedProducts []ProductData  // Subset of products for the homepage
	DealProducts     []ProductData  // Products with active deals (DealPrice > 0)
	BlogPosts        []BlogPostData // Editorial articles (LLM-targeted)
	BlogCategories   []string       // Unique list of blog categories
	HasBlog          bool           // true if any active blog posts (drives footer link)
	HasWholesale     bool           // true if any product is wholesale/both (drives the footer trade link)
	Year             int
	Timestamp        string
	// The most recent real content change, used for sitemap <lastmod> on pages
	// that aggregate many items (home, listing, category, blog index). Distinct
	// from Timestamp, which is when generation ran: stamping generation time as
	// lastmod told crawlers every page changed on every regen, which is both
	// untrue and the thing that trains them to ignore the signal.
	CatalogLastMod string
	BlogLastMod    string
	BasePath       string
	ApiBase        string // Public-facing API URL for browser JS calls
	Domain         string // Pre-computed: CustomDomain if set, else PreviewDomain
}

// BlogPostData mirrors catalog-service storage.BlogPost for rendering.
// Body is HTML (authored directly in admin UI, same as product descriptions).
type BlogPostData struct {
	ID                  string    `json:"_id"`
	SellerID            string    `json:"sellerID"`
	Title               string    `json:"title"`
	Slug                string    `json:"slug"`
	Excerpt             string    `json:"excerpt,omitempty"`
	Body                string    `json:"body"`
	FeaturedImage       string    `json:"featuredImage,omitempty"`
	Author              string    `json:"author"`
	AuthorBio           string    `json:"authorBio,omitempty"`
	Category            string    `json:"category"`
	Tags                []string  `json:"tags,omitempty"`
	MentionedProductIDs []string  `json:"mentionedProductIDs,omitempty"`
	MetaTitle           string    `json:"metaTitle,omitempty"`
	MetaDescription     string    `json:"metaDescription,omitempty"`
	Active              *bool     `json:"active,omitempty"`
	PublishedAt         time.Time `json:"publishedAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
	// Pre-computed by generator (NOT in DB / JSON)
	Filename    string `json:"-"` // {slug}-{last6charsOfID}
	ReadMinutes int    `json:"-"` // word count / 200
	WordCount   int    `json:"-"`
}

// LastModTime is when this post's content last changed: its edit date, or its
// publish date when it has never been edited.
//
// A method rather than template logic because BlogLastMod computes the same rule
// for the blog index and category pages, and the two disagreeing is exactly the
// bug this fixes: a published-but-never-edited post had no UpdatedAt, so its own
// page lost its <lastmod> while the index that aggregates it kept one.
func (b BlogPostData) LastModTime() time.Time {
	if b.UpdatedAt.After(b.PublishedAt) {
		return b.UpdatedAt
	}
	return b.PublishedAt
}

type Attribute struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type Review struct {
	Name     string    `json:"name"`
	Rating   int       `json:"rating"`
	Title    string    `json:"title,omitempty"`
	Body     string    `json:"body"`
	Verified bool      `json:"verified,omitempty"`
	Date     time.Time `json:"date"`
}

type RatingDistribution struct {
	Star1 int `json:"star1,omitempty"`
	Star2 int `json:"star2,omitempty"`
	Star3 int `json:"star3,omitempty"`
	Star4 int `json:"star4,omitempty"`
	Star5 int `json:"star5,omitempty"`
}

type Rating struct {
	Count        int                 `json:"count,omitempty"`
	Average      float64             `json:"average,omitempty"`
	Distribution *RatingDistribution `json:"distribution,omitempty"`
	Reviews      []Review            `json:"reviews,omitempty"`
}

// FAQItem / ProductFAQ mirror catalog-service's storage models, decoded from the
// product fetch. Merchant-authored, so no Verified or Email counterpart to Review.
type FAQItem struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

type ProductFAQ struct {
	Count int       `json:"count,omitempty"`
	Items []FAQItem `json:"items,omitempty"`
}

type PriceTier struct {
	MinQty int     `json:"minQty"`
	Price  float64 `json:"price"`
}

type ProductData struct {
	ID              string      `json:"_id,omitempty"`
	SellerID        string      `json:"sellerID,omitempty"` // owning company; checked before publishing (never rendered)
	PartnerID       string      `json:"partnerId,omitempty"`
	Name            string      `json:"name"`
	Description     string      `json:"description"`
	Price           float64     `json:"price"`
	DealPrice       float64     `json:"dealPrice,omitempty"`
	UpdatedAt       time.Time   `json:"updatedAt,omitempty"`
	DealStartDate   *time.Time  `json:"dealStartDate,omitempty"`
	DealEndDate     *time.Time  `json:"dealEndDate,omitempty"`
	DiscountedPrice float64     `json:"discountedPrice,omitempty"`
	PriceTiers      []PriceTier `json:"priceTiers,omitempty"`
	// Who this product is marketed to on the public storefront: "retail",
	// "wholesale" or "both". Absent means retail, which is what every product
	// did before the field existed, so nothing already published moves.
	// Read it through the IsWholesaleOnly / ShowsTradeBlock helpers rather than
	// comparing strings in a template.
	Audience string `json:"audience,omitempty"`
	// Per-product B2B quantity rules. Decoded here so the trade block can state a
	// real MOQ or case pack instead of a vague "contact us"; the portal has let
	// merchants set these for a while but they never reached the storefront.
	MinOrderQty           int      `json:"minOrderQty,omitempty"`
	OrderIncrement        int      `json:"orderIncrement,omitempty"`
	MaxOrderQty           int      `json:"maxOrderQty,omitempty"`
	Images                []string `json:"images,omitempty"`
	Image                 string   `json:"image"`
	Category              string   `json:"category"`
	GoogleProductCategory string   `json:"googleProductCategory,omitempty"`
	Slug                  string   `json:"slug"`
	SKU                   string   `json:"sku,omitempty"`
	Barcode               string   `json:"barcode,omitempty"`
	Stock                 int      `json:"stock"`
	// Package weight (lb) and dimensions (in), as shipped. Decoded straight from
	// the catalog response; no mapping step. Rendered on the PDP and the .md
	// companions so a shopper (or an LLM) can answer "how big is it".
	Weight float64 `json:"weight,omitempty"`
	Length float64 `json:"length,omitempty"`
	Width  float64 `json:"width,omitempty"`
	Height float64 `json:"height,omitempty"`
	// Merchant-set ad segmentation labels (Roadmap #45). FEED-ONLY: never
	// rendered on the storefront, since they are internal campaign metadata and
	// are explicitly invisible to shoppers.
	CustomLabel0 string      `json:"customLabel0,omitempty"`
	CustomLabel1 string      `json:"customLabel1,omitempty"`
	CustomLabel2 string      `json:"customLabel2,omitempty"`
	CustomLabel3 string      `json:"customLabel3,omitempty"`
	CustomLabel4 string      `json:"customLabel4,omitempty"`
	Active       *bool       `json:"active,omitempty"`
	Featured     bool        `json:"featured,omitempty"`
	Attributes   []Attribute `json:"attributes"`
	Rating       *Rating     `json:"rating,omitempty"`
	FAQ          *ProductFAQ `json:"faq,omitempty"`
	Filename     string      `json:"-"` // Pre-computed: slug-suffix (no extension)
}

// Audience values, mirroring catalog-service storage.Audience*. Duplicated
// rather than imported because the services stay independent.
const (
	AudienceRetail    = "retail"
	AudienceWholesale = "wholesale"
	AudienceBoth      = "both"
)

// IsWholesaleOnly reports whether the product must NOT be sold to consumers on
// this storefront: no price, no Add-to-Cart, no shopping feed, no deals.
//
// Only the exact string "wholesale" hides a product. Anything else, including
// an empty value, a typo or a value written before this field existed, is
// treated as retail. That direction is deliberate: the failure mode of a bad
// value is "a product stays visible and sellable", never "a merchant's product
// silently vanished from their storefront and their ad feeds".
func (p ProductData) IsWholesaleOnly() bool { return p.Audience == AudienceWholesale }

// ShowsTradeBlock reports whether to render the trade-access block, which
// invites a business buyer to request a wholesale account in the portal.
// Shown for wholesale-only products (it replaces the buy path) and for "both"
// (it sits alongside the normal consumer price and cart).
func (p ProductData) ShowsTradeBlock() bool {
	return p.Audience == AudienceWholesale || p.Audience == AudienceBoth
}

type Generator struct {
	TemplateFS     fs.FS
	OutputDir      string
	S3Client       *s3.Client
	BucketName     string
	CFClient       *cloudfront.Client
	DistributionId string
}

func NewGenerator(templateDir, outputDir string, s3Client *s3.Client, bucketName string, cfClient *cloudfront.Client, distributionId string) *Generator {
	var tfs fs.FS
	if templateDir != "" {
		tfs = os.DirFS(templateDir)
	} else {
		// Use embedded templates, rooted at "templates"
		sub, err := fs.Sub(templatesEmbed, "templates")
		if err != nil {
			// fallback (should not happen)
			tfs = templatesEmbed
		} else {
			tfs = sub
		}
	}

	return &Generator{
		TemplateFS:     tfs,
		OutputDir:      outputDir,
		S3Client:       s3Client,
		BucketName:     bucketName,
		CFClient:       cfClient,
		DistributionId: distributionId,
	}
}

func (g *Generator) Generate(data StorefrontData) error {
	companyDir := filepath.Join(g.OutputDir, data.Company.UniqueIdentifier)

	// Clear the directory to ensure old files are removed
	log.Printf("DEBUG: Removing old storefront directory: %s", companyDir)
	if err := os.RemoveAll(companyDir); err != nil {
		log.Printf("ERROR: Failed to remove old storefront directory: %v", err)
		return err
	}

	productsDir := filepath.Join(companyDir, "products")
	if err := os.MkdirAll(productsDir, 0755); err != nil {
		return err
	}

	categoryDir := filepath.Join(companyDir, "category")
	if err := os.MkdirAll(categoryDir, 0755); err != nil {
		return err
	}

	data.Year = time.Now().Year()
	data.Timestamp = time.Now().Format(time.RFC3339)

	// Real content-change dates, computed from the items themselves. Empty when
	// nothing carries a date, in which case the sitemap omits <lastmod> for those
	// pages rather than inventing one: an absent lastmod is valid, a wrong one is
	// a lie crawlers eventually learn to discount.
	var newestProduct, newestPost time.Time
	for _, p := range data.Products {
		if p.UpdatedAt.After(newestProduct) {
			newestProduct = p.UpdatedAt
		}
	}
	for _, b := range data.BlogPosts {
		if lm := b.LastModTime(); lm.After(newestPost) {
			newestPost = lm
		}
	}
	if !newestProduct.IsZero() {
		data.CatalogLastMod = newestProduct.UTC().Format(time.RFC3339)
	}
	if !newestPost.IsZero() {
		data.BlogLastMod = newestPost.UTC().Format(time.RFC3339)
	}

	// Pre-compute domain for templates
	if data.Config.CustomDomain != "" {
		data.Domain = data.Config.CustomDomain
	} else {
		data.Domain = data.Config.PreviewDomain
	}

	// Pre-compute first image from Images array (if Image not already set)
	for i := range data.Products {
		if data.Products[i].Image == "" && len(data.Products[i].Images) > 0 {
			data.Products[i].Image = data.Products[i].Images[0]
		}
	}

	// Pre-compute product filenames
	for i := range data.Products {
		slug := slugify(data.Products[i].Slug)
		if slug == "" {
			slug = "product"
		}
		suffix := ""
		if len(data.Products[i].ID) > 6 {
			suffix = "-" + data.Products[i].ID[len(data.Products[i].ID)-6:]
		}
		data.Products[i].Filename = slug + suffix
	}

	// Pre-compute blog post filenames + categories so sitemap/llms.txt have them.
	// Filter inactive here too — sitemap should never list a draft.
	if len(data.BlogPosts) > 0 {
		activePosts := make([]BlogPostData, 0, len(data.BlogPosts))
		catSet := map[string]bool{}
		for _, p := range data.BlogPosts {
			if p.Active != nil && !*p.Active {
				continue
			}
			slug := slugify(p.Slug)
			if slug == "" {
				slug = "post"
			}
			suffix := ""
			if len(p.ID) > 6 {
				suffix = "-" + p.ID[len(p.ID)-6:]
			}
			p.Filename = slug + suffix
			p.WordCount = countWords(p.Body)
			p.ReadMinutes = p.WordCount / 200
			if p.ReadMinutes < 1 {
				p.ReadMinutes = 1
			}
			activePosts = append(activePosts, p)
			if !catSet[p.Category] {
				catSet[p.Category] = true
				data.BlogCategories = append(data.BlogCategories, p.Category)
			}
		}
		sort.Strings(data.BlogCategories)
		data.BlogPosts = activePosts
		data.HasBlog = len(activePosts) > 0
	}

	// Extract Categories with counts (normalize "Gloves/BBQ" → "Gloves / BBQ")
	categoryCounts := make(map[string]int)
	for i, p := range data.Products {
		if p.Category != "" {
			primary, sub := parseCategoryParts(p.Category)
			normalized := primary
			if sub != "" {
				normalized = primary + " / " + sub
			}
			data.Products[i].Category = normalized // normalize on product too
			categoryCounts[normalized]++
		}
	}
	data.CategoryCounts = categoryCounts
	for cat := range categoryCounts {
		data.Categories = append(data.Categories, cat)
	}
	// Sorted because Go randomises map iteration order, and this slice is the
	// category nav rendered on every PDP, listing and category page. Unsorted, an
	// unchanged catalogue produced a different byte output on every regen: 34 of
	// 107 PDPs "differed" on a byte-diff with zero real content change, which made
	// it impossible to cheaply prove a storefront change was inert, churned S3
	// objects and invalidated CloudFront for nothing, and could shuffle the nav
	// under a returning visitor. Matches sort.Strings(data.BlogCategories) above.
	sort.Strings(data.Categories)

	// Top primary categories by product count (for footer — max 6)
	primaryCounts := map[string]int{}
	for _, cat := range data.Categories {
		p, _ := parseCategoryParts(cat)
		primaryCounts[p] += categoryCounts[cat]
	}
	var primaries []string
	for p := range primaryCounts {
		primaries = append(primaries, p)
	}
	// Count descending, then name, because sort.Slice is NOT stable: two
	// categories with the same product count would otherwise keep the random map
	// order they were appended in, and the footer would reshuffle between regens
	// even with the list above sorted.
	sort.Slice(primaries, func(i, j int) bool {
		if primaryCounts[primaries[i]] != primaryCounts[primaries[j]] {
			return primaryCounts[primaries[i]] > primaryCounts[primaries[j]]
		}
		return primaries[i] < primaries[j]
	})
	if len(primaries) > 6 {
		data.TopCategories = primaries[:6]
	} else {
		data.TopCategories = primaries
	}

	// Featured products: use products marked as featured, fallback to first 3
	for _, p := range data.Products {
		if p.Featured {
			data.FeaturedProducts = append(data.FeaturedProducts, p)
		}
	}
	if len(data.FeaturedProducts) == 0 {
		if len(data.Products) > 3 {
			data.FeaturedProducts = data.Products[:3]
		} else {
			data.FeaturedProducts = data.Products
		}
	}

	// Deal products: products with active deals (DealPrice > 0, within date range if set).
	// Wholesale-only products never appear: a deal is a consumer promotion and the
	// deals page shows a price, which is exactly what wholesale-only withholds.
	now := time.Now()
	for _, p := range data.Products {
		if p.IsWholesaleOnly() {
			continue
		}
		if p.DealPrice > 0 {
			if p.DealStartDate != nil && p.DealStartDate.After(now) {
				continue
			}
			if p.DealEndDate != nil && p.DealEndDate.Before(now) {
				continue
			}
			data.DealProducts = append(data.DealProducts, p)
		}
	}

	// Does this storefront have any wholesale-facing product? Drives the footer
	// trade link, so it is computed once here rather than scanned per template.
	for _, p := range data.Products {
		if p.ShowsTradeBlock() {
			data.HasWholesale = true
			break
		}
	}

	// Generate Index HTML
	if err := g.renderTemplate(
		"index.html",
		filepath.Join(companyDir, "index.html"),
		data,
		true,
	); err != nil {
		return err
	}

	// Generate Index MD
	if err := g.renderTemplate(
		"index.md",
		filepath.Join(companyDir, "index.md"),
		data,
		false,
	); err != nil {
		return err
	}

	// Generate All Products HTML
	if err := g.renderTemplate(
		"products.html",
		filepath.Join(companyDir, "products.html"),
		data,
		true,
	); err != nil {
		return fmt.Errorf("products.html: %w", err)
	}

	// Generate Deals Page (only if there are deals)
	if len(data.DealProducts) > 0 {
		if err := g.renderTemplate(
			"deals.html",
			filepath.Join(companyDir, "deals.html"),
			data,
			true,
		); err != nil {
			return fmt.Errorf("deals.html: %w", err)
		}
	}

	// Generate Contact Page
	if err := g.renderTemplate("contact.html", filepath.Join(companyDir, "contact.html"), data, true); err != nil {
		return fmt.Errorf("contact.html: %w", err)
	}

	// Generate Privacy Policy Page
	if err := g.renderTemplate("privacy.html", filepath.Join(companyDir, "privacy.html"), data, true); err != nil {
		return fmt.Errorf("privacy.html: %w", err)
	}

	// Generate Terms of Service Page
	if err := g.renderTemplate("terms.html", filepath.Join(companyDir, "terms.html"), data, true); err != nil {
		return fmt.Errorf("terms.html: %w", err)
	}

	// Generate Shipping & Returns Page
	if err := g.renderTemplate("shipping.html", filepath.Join(companyDir, "shipping.html"), data, true); err != nil {
		return fmt.Errorf("shipping.html: %w", err)
	}

	// Generate About Page (only if aboutText is configured)
	if data.Config != nil && data.Config.AboutText != "" {
		if err := g.renderTemplate("about.html", filepath.Join(companyDir, "about.html"), data, true); err != nil {
			return fmt.Errorf("about.html: %w", err)
		}
	}

	// Generate Category Pages (with primary/sub hierarchy)
	// Group categories by primary name
	primaryToRaw := map[string][]string{}
	for _, cat := range data.Categories {
		p, _ := parseCategoryParts(cat)
		primaryToRaw[p] = append(primaryToRaw[p], cat)
	}

	buildCatData := func(category string, products []ProductData, isPrimary bool, primaryName, subName string) interface{} {
		return struct {
			AccountID      string
			Company        *storage.CompanyData
			Config         *storage.D2CConfig
			Category       string
			IsPrimary      bool
			PrimaryName    string
			SubName        string
			Products       []ProductData
			DealProducts   []ProductData
			Year           int
			Timestamp      string
			Categories     []string
			TopCategories  []string
			CategoryCounts map[string]int
			HasBlog        bool
			BasePath       string
			ApiBase        string
			Domain         string
		}{
			AccountID:      data.AccountID,
			Company:        data.Company,
			Config:         data.Config,
			Category:       category,
			IsPrimary:      isPrimary,
			PrimaryName:    primaryName,
			SubName:        subName,
			Products:       products,
			DealProducts:   data.DealProducts,
			Year:           data.Year,
			Timestamp:      data.Timestamp,
			Categories:     data.Categories,
			TopCategories:  data.TopCategories,
			CategoryCounts: data.CategoryCounts,
			HasBlog:        data.HasBlog,
			BasePath:       "../",
			ApiBase:        data.ApiBase,
			Domain:         data.Domain,
		}
	}

	for primary, rawCats := range primaryToRaw {
		hasSubs := false
		for _, rc := range rawCats {
			if _, s := parseCategoryParts(rc); s != "" {
				hasSubs = true
				break
			}
		}

		if !hasSubs {
			// Standalone category (no slash) — single page, same as before
			var products []ProductData
			for _, p := range data.Products {
				if p.Category == rawCats[0] {
					products = append(products, p)
				}
			}
			filename := slugify(primary) + ".html"
			if err := g.renderTemplate("category.html", filepath.Join(categoryDir, filename),
				buildCatData(primary, products, false, primary, ""), true); err != nil {
				return fmt.Errorf("category %s: %w", primary, err)
			}
		} else {
			// Has subs — generate primary page (all products) + individual sub pages
			var allProducts []ProductData
			for _, p := range data.Products {
				pp, _ := parseCategoryParts(p.Category)
				if pp == primary {
					allProducts = append(allProducts, p)
				}
			}
			primaryFilename := slugify(primary) + ".html"
			if err := g.renderTemplate("category.html", filepath.Join(categoryDir, primaryFilename),
				buildCatData(primary, allProducts, true, primary, ""), true); err != nil {
				return fmt.Errorf("category %s: %w", primary, err)
			}

			// Generate sub-category pages
			for _, rawCat := range rawCats {
				_, sub := parseCategoryParts(rawCat)
				if sub == "" {
					continue
				}
				var subProducts []ProductData
				for _, p := range data.Products {
					if p.Category == rawCat {
						subProducts = append(subProducts, p)
					}
				}
				subFilename := slugify(primary) + "-" + slugify(sub) + ".html"
				if err := g.renderTemplate("category.html", filepath.Join(categoryDir, subFilename),
					buildCatData(sub, subProducts, false, primary, sub), true); err != nil {
					return fmt.Errorf("category %s/%s: %w", primary, sub, err)
				}
			}
		}
	}

	// Generate individual Product pages
	for _, product := range data.Products {
		filenameBase := product.Filename

		// Related products: same category, exclude current, max 4
		var related []ProductData
		for _, p := range data.Products {
			if p.ID != product.ID && p.Category == product.Category {
				related = append(related, p)
				if len(related) >= 4 {
					break
				}
			}
		}

		productPageData := struct {
			AccountID       string
			Company         *storage.CompanyData
			Config          *storage.D2CConfig
			Product         ProductData
			RelatedProducts []ProductData
			DealProducts    []ProductData
			Year            int
			Timestamp       string
			Categories      []string
			TopCategories   []string
			CategoryCounts  map[string]int
			HasBlog         bool
			HasWholesale    bool
			BasePath        string
			ApiBase         string
			Domain          string
		}{
			AccountID:       data.AccountID,
			Company:         data.Company,
			Config:          data.Config,
			Product:         product,
			RelatedProducts: related,
			DealProducts:    data.DealProducts,
			Year:            data.Year,
			Timestamp:       data.Timestamp,
			Categories:      data.Categories,
			TopCategories:   data.TopCategories,
			CategoryCounts:  data.CategoryCounts,
			HasBlog:         data.HasBlog,
			HasWholesale:    data.HasWholesale,
			BasePath:        "../",
			ApiBase:         data.ApiBase,
			Domain:          data.Domain,
		}

		// Product HTML
		if err := g.renderTemplate(
			"product.html",
			filepath.Join(productsDir, filenameBase+".html"),
			productPageData,
			true,
		); err != nil {
			return err
		}

		// Product MD
		if err := g.renderTemplate(
			"product.md",
			filepath.Join(productsDir, filenameBase+".md"),
			productPageData,
			false,
		); err != nil {
			return err
		}
	}

	// Generate Products MD (full catalog)
	if err := g.renderTemplate(
		"products.md",
		filepath.Join(companyDir, "products.md"),
		data,
		false,
	); err != nil {
		return fmt.Errorf("products.md: %w", err)
	}

	// Generate robots.txt
	if err := g.renderTemplate(
		"robots.txt",
		filepath.Join(companyDir, "robots.txt"),
		data,
		false,
	); err != nil {
		return fmt.Errorf("robots.txt: %w", err)
	}

	// Generate sitemap.xml
	if err := g.renderTemplate(
		"sitemap.xml",
		filepath.Join(companyDir, "sitemap.xml"),
		data,
		false,
	); err != nil {
		return fmt.Errorf("sitemap.xml: %w", err)
	}

	// Generate llms.txt
	if err := g.renderTemplate(
		"llms.txt",
		filepath.Join(companyDir, "llms.txt"),
		data,
		false,
	); err != nil {
		return fmt.Errorf("llms.txt: %w", err)
	}

	// Copy Static Files
	for _, jsFile := range []string{"tracker.js", "cart.js", "customer.js", "nav.js"} {
		jsData, err := fs.ReadFile(g.TemplateFS, jsFile)
		if err != nil {
			return fmt.Errorf("%s read: %w", jsFile, err)
		}
		if err := os.WriteFile(filepath.Join(companyDir, jsFile), jsData, 0644); err != nil {
			return fmt.Errorf("%s write: %w", jsFile, err)
		}
	}

	// Blog posts — isolated, never breaks storefront. Failures logged, not returned.
	g.generateBlog(data, companyDir)

	// Shopping channel feeds — isolated, never breaks storefront
	g.generateFeeds(data, companyDir)

	// Delete old S3 files before uploading fresh set
	if err := g.DeleteStorefront(data.Company.UniqueIdentifier); err != nil {
		log.Printf("WARN: failed to clean old S3 files: %v", err)
	}

	return g.syncToS3(companyDir, data.Company.UniqueIdentifier)
}

func (g *Generator) DeleteStorefront(companyUID string) error {
	if g.S3Client == nil || g.BucketName == "" || companyUID == "" {
		return nil
	}

	prefix := "storefronts/" + companyUID + "/"

	// List all objects with the prefix
	listOutput, err := g.S3Client.ListObjectsV2(context.TODO(), &s3.ListObjectsV2Input{
		Bucket: aws.String(g.BucketName),
		Prefix: aws.String(prefix),
	})
	if err != nil {
		return err
	}

	if len(listOutput.Contents) == 0 {
		return nil
	}

	// Prepare delete objects
	var identifiers []types.ObjectIdentifier
	for _, obj := range listOutput.Contents {
		identifiers = append(identifiers, types.ObjectIdentifier{
			Key: obj.Key,
		})
	}

	_, err = g.S3Client.DeleteObjects(context.TODO(), &s3.DeleteObjectsInput{
		Bucket: aws.String(g.BucketName),
		Delete: &types.Delete{
			Objects: identifiers,
		},
	})

	return err
}

func (g *Generator) syncToS3(localDir, companyUID string) error {
	if g.S3Client == nil || g.BucketName == "" || os.Getenv("NODE_ENV") == "local" {
		return nil // Skip if not configured or local
	}

	return filepath.Walk(localDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}

		relPath, _ := filepath.Rel(localDir, path)
		s3Key := "storefronts/" + companyUID + "/" + relPath

		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()

		_, err = g.S3Client.PutObject(context.TODO(), &s3.PutObjectInput{
			Bucket:       aws.String(g.BucketName),
			Key:          aws.String(s3Key),
			Body:         file,
			ContentType:  aws.String(g.getContentType(path)),
			CacheControl: aws.String(g.getCacheControl(path)),
		})
		return err
	})
}

func (g *Generator) getCacheControl(path string) string {
	switch filepath.Ext(path) {
	case ".js":
		return "public, max-age=604800" // 7 days — JS changes only on code deploy
	default:
		return "public, max-age=3600" // 1 hour — HTML/MD/XML change with product updates
	}
}

func (g *Generator) InvalidateCache(companyUID string) error {
	if g.CFClient == nil || g.DistributionId == "" {
		return nil // skip in local dev
	}
	_, err := g.CFClient.CreateInvalidation(context.TODO(), &cloudfront.CreateInvalidationInput{
		DistributionId: aws.String(g.DistributionId),
		InvalidationBatch: &cftypes.InvalidationBatch{
			CallerReference: aws.String(fmt.Sprintf("%s-%d", companyUID, time.Now().Unix())),
			Paths: &cftypes.Paths{
				Quantity: aws.Int32(1),
				Items:    []string{"/storefronts/" + companyUID + "/*"},
			},
		},
	})
	if err != nil {
		log.Printf("CloudFront invalidation failed for %s: %v", companyUID, err)
	}
	return err
}

func (g *Generator) getContentType(path string) string {
	switch filepath.Ext(path) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".md":
		return "text/markdown; charset=utf-8"
	case ".js":
		return "application/javascript"
	case ".xml":
		return "application/xml"
	case ".txt":
		return "text/plain; charset=utf-8"
	default:
		return "application/octet-stream"
	}
}

func (g *Generator) renderTemplate(tmplName, outputPath string, data interface{}, isHTML bool) error {
	content, err := fs.ReadFile(g.TemplateFS, tmplName)
	if err != nil {
		return err
	}

	sanitizedContent := ""
	if isHTML {
		partials, err := fs.ReadFile(g.TemplateFS, "partials.html")
		if err == nil {
			sanitizedContent += g.sanitizeTemplate(string(partials)) + "\n"
		}
	}
	sanitizedContent += g.sanitizeTemplate(string(content))

	var buf bytes.Buffer
	paymentLabels := map[string]string{
		"credit_card": "Credit Card", "purchase_order": "Purchase Order",
		"amazon_pay": "Amazon Pay", "google_pay": "Google Pay", "stripe_pay": "Credit Card",
		"pickup_&_pay": "Pay at Pickup", "deliver_pay": "Pay on Delivery",
	}
	deliveryLabels := map[string]string{
		"pickup": "Pickup", "dropoff": "Local Delivery", "shipping_out": "Shipping",
	}

	funcMap := template.FuncMap{
		"subtract": func(a, b int) int { return a - b },
		"printf":   fmt.Sprintf,
		"slugify":  slugify,
		"jsArray": func(v interface{}) template.JS {
			b, _ := json.Marshal(v)
			return template.JS(b)
		},
		"paymentLabel": func(s string) string {
			if l, ok := paymentLabels[s]; ok {
				return l
			}
			return s
		},
		"deliveryLabel": func(s string) string {
			if l, ok := deliveryLabels[s]; ok {
				return l
			}
			return s
		},
		"isOnlinePayment": func(s string) bool {
			return s == "credit_card" || s == "amazon_pay" || s == "google_pay" || s == "stripe_pay"
		},
		"savingsPercent": func(original, discounted float64) int {
			if original <= 0 {
				return 0
			}
			return int(((original - discounted) / original) * 100)
		},
		"subtractFloat": func(a, b float64) float64 { return a - b },
		"lastmod":       lastmodString,
		"dims":          dimsString,
		"num":           numString,
		"primaryOf": func(cat string) string {
			p, _ := parseCategoryParts(cat)
			return p
		},
		"subOf": func(cat string) string {
			_, s := parseCategoryParts(cat)
			return s
		},
		"uniquePrimaries": func(categories []string) []string {
			seen := map[string]bool{}
			var result []string
			for _, cat := range categories {
				p, _ := parseCategoryParts(cat)
				if !seen[p] {
					seen[p] = true
					result = append(result, p)
				}
			}
			return result
		},
		"subsOf": func(categories []string, primary string) []string {
			var subs []string
			for _, cat := range categories {
				p, s := parseCategoryParts(cat)
				if p == primary && s != "" {
					subs = append(subs, s)
				}
			}
			return subs
		},
		"primaryCount": func(categories []string, counts map[string]int, primary string) int {
			total := 0
			for _, cat := range categories {
				p, _ := parseCategoryParts(cat)
				if p == primary {
					total += counts[cat]
				}
			}
			return total
		},
		"catSlug": func(primary, sub string) string {
			if sub == "" {
				return slugify(primary)
			}
			return slugify(primary) + "-" + slugify(sub)
		},
		"rawHTML": func(s string) template.HTML {
			// Blog post bodies are HTML authored by admin/company role users.
			// We trust the author for structural HTML (headings, tables, links,
			// images) but strip the worst XSS vectors as defense-in-depth.
			out := stripScriptsAndHandlers(s)
			return template.HTML(out)
		},
		"safeHTML": func(s string) template.HTML {
			// Allowlist: escape EVERYTHING, then re-allow a tiny set of
			// formatting tags. Attributes are never allowed (no <a href>,
			// no onclick/onerror, no style). This is rendered into
			// company-controlled marketing pages (about/privacy/terms/
			// shipping) where the operator wants light formatting only.
			esc := template.HTMLEscapeString(s)
			tags := []string{"p", "br", "strong", "em", "ul", "li", "h2"}
			for _, t := range tags {
				esc = strings.ReplaceAll(esc, "&lt;"+t+"&gt;", "<"+t+">")
				esc = strings.ReplaceAll(esc, "&lt;/"+t+"&gt;", "</"+t+">")
			}
			esc = strings.ReplaceAll(esc, "&lt;br/&gt;", "<br/>")
			esc = strings.ReplaceAll(esc, "&lt;br /&gt;", "<br />")
			return template.HTML(esc)
		},
		"catCount": func(counts map[string]int, cat string) int {
			return counts[cat]
		},
		// stars renders a 5-star bar using filled (★) and outline (☆) glyphs.
		// Accepts float64 (average) or int (single review). Half-star rounds up at >= 0.5.
		"stars": func(v interface{}) template.HTML {
			var avg float64
			switch n := v.(type) {
			case float64:
				avg = n
			case int:
				avg = float64(n)
			case int32:
				avg = float64(n)
			case int64:
				avg = float64(n)
			}
			full := int(avg)
			if avg-float64(full) >= 0.5 {
				full++
			}
			if full > 5 {
				full = 5
			}
			if full < 0 {
				full = 0
			}
			return template.HTML(strings.Repeat("★", full) + strings.Repeat("☆", 5-full))
		},
		// distPct returns the percentage of reviews at a given star rating, rounded to int.
		// Used for the distribution bar widths.
		"distPct": func(r *Rating, star int) int {
			if r == nil || r.Count == 0 || r.Distribution == nil {
				return 0
			}
			var n int
			switch star {
			case 1:
				n = r.Distribution.Star1
			case 2:
				n = r.Distribution.Star2
			case 3:
				n = r.Distribution.Star3
			case 4:
				n = r.Distribution.Star4
			case 5:
				n = r.Distribution.Star5
			}
			return (n * 100) / r.Count
		},
		// reviewsJSONLD marshals the reviews slice into a schema.org-compliant
		// JSON array string and returns it as template.JS so html/template does
		// NOT JSON-quote it inside <script type="application/ld+json"> blocks.
		"reviewsJSONLD": func(reviews []Review) template.JS {
			type schemaReview struct {
				Type          string                 `json:"@type"`
				Author        map[string]string      `json:"author"`
				DatePublished string                 `json:"datePublished"`
				ReviewRating  map[string]interface{} `json:"reviewRating"`
				Name          string                 `json:"name,omitempty"`
				ReviewBody    string                 `json:"reviewBody"`
			}
			out := make([]schemaReview, 0, len(reviews))
			for _, r := range reviews {
				out = append(out, schemaReview{
					Type:          "Review",
					Author:        map[string]string{"@type": "Person", "name": r.Name},
					DatePublished: r.Date.Format("2006-01-02"),
					ReviewRating: map[string]interface{}{
						"@type":       "Rating",
						"ratingValue": fmt.Sprintf("%d", r.Rating),
						"bestRating":  "5",
						"worstRating": "1",
					},
					Name:       r.Title,
					ReviewBody: r.Body,
				})
			}
			b, _ := json.Marshal(out)
			return template.JS(b)
		},
		// faqJSONLD marshals the FAQ items into the mainEntity array of a
		// schema.org FAQPage. Same contract as reviewsJSONLD: returns template.JS
		// so html/template does not JSON-quote it inside the ld+json block.
		//
		// Emitted for AI citation ONLY. Google's FAQ rich result is DEAD, not
		// merely restricted: narrowed to government and health sites 2023-09-14,
		// stopped appearing in Search 2026-05-07, documentation removed
		// 2026-06-15. This block will never produce anything in Google. It stays
		// because it is still valid schema.org that non-Google parsers and LLM
		// crawlers read, and it costs a few KB. The load-bearing part for AI is
		// the visible <details> content and the product.md companion, NOT this.
		// Marketing copy must never present it as a search feature.
		"faqJSONLD": func(items []FAQItem) template.JS {
			type acceptedAnswer struct {
				Type string `json:"@type"`
				Text string `json:"text"`
			}
			type schemaQuestion struct {
				Type           string         `json:"@type"`
				Name           string         `json:"name"`
				AcceptedAnswer acceptedAnswer `json:"acceptedAnswer"`
			}
			out := make([]schemaQuestion, 0, len(items))
			for _, f := range items {
				out = append(out, schemaQuestion{
					Type:           "Question",
					Name:           f.Question,
					AcceptedAnswer: acceptedAnswer{Type: "Answer", Text: f.Answer},
				})
			}
			b, _ := json.Marshal(out)
			return template.JS(b)
		},
		// distCount returns the count of reviews at a given star rating.
		"distCount": func(r *Rating, star int) int {
			if r == nil || r.Distribution == nil {
				return 0
			}
			switch star {
			case 1:
				return r.Distribution.Star1
			case 2:
				return r.Distribution.Star2
			case 3:
				return r.Distribution.Star3
			case 4:
				return r.Distribution.Star4
			case 5:
				return r.Distribution.Star5
			}
			return 0
		},
	}

	if isHTML {
		// Use custom [[ ]] delimiters to avoid conflict with CSS auto-formatters
		tmpl, err := template.New(tmplName).Delims("[[", "]]").Funcs(funcMap).Parse(sanitizedContent)
		if err != nil {
			log.Printf("ERROR: Failed to parse HTML template %s: %v", tmplName, err)
			return err
		}
		if err := tmpl.Execute(&buf, data); err != nil {
			return err
		}
	} else {
		// Also use custom [[ ]] for text templates
		tmpl, err := texttemplate.New(tmplName).Delims("[[", "]]").Funcs(texttemplate.FuncMap{
			"subtract": func(a, b int) int { return a - b },
			"printf":   fmt.Sprintf,
			"slugify":  slugify,
			// Same helpers as the HTML map. The .md companions carry a real
			// last-updated date and the package specs too, so they have to be
			// registered on both maps or they silently render nothing.
			"lastmod": lastmodString,
			"dims":    dimsString,
			"num":     numString,
		}).Parse(sanitizedContent)
		if err != nil {
			log.Printf("ERROR: Failed to parse Text template %s: %v", tmplName, err)
			return err
		}
		if err := tmpl.Execute(&buf, data); err != nil {
			return err
		}
	}

	return os.WriteFile(outputPath, buf.Bytes(), 0644)
}

// TradeAnchor is the id of the wholesale enquiry section on the contact page, and
// the fragment every trade CTA points at.
const TradeAnchor = "trade"

// The trade CTA stays on the MERCHANT's own domain, deliberately. Sending the
// buyer to businesscart.ai would contradict the white-label promise the Compare
// page makes ("your brand, no platform branding") and would hand a merchant's
// prospect to the platform's marketing site mid-enquiry. The platform appears
// later, at registration, once the merchant has issued a code and the buyer is
// knowingly creating an account.
//
// Templates build the href themselves: [[.BasePath]]contact.html#trade in HTML,
// which is correct from the site root and from inside /products alike and works
// on the preview domain and a custom domain without the generator guessing which
// one the visitor arrived on. The .md companions use the absolute form so an LLM
// has something citable.

// lastmodString formats a content-change date for sitemap <lastmod> and for the
// .md companions, or "" when the item carries none so the caller can omit the
// field entirely. An absent lastmod is valid; a fabricated one is a lie crawlers
// learn to discount.
func lastmodString(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

// numString renders a measurement without trailing zeros, so 2.5 stays "2.5"
// but 12.0 reads "12" rather than "12.00". Returns "" for a zero/absent value
// so a template can omit the row entirely.
func numString(v float64) string {
	if v <= 0 {
		return ""
	}
	return strconv.FormatFloat(v, 'f', -1, 64)
}

// dimsString renders package dimensions as "L x W x H", skipping any axis the
// merchant left blank, and "" when none are set. A merchant who fills only two
// of three gets "12 x 8" rather than a broken "12 x  x 4".
func dimsString(l, w, h float64) string {
	parts := make([]string, 0, 3)
	for _, v := range []float64{l, w, h} {
		if s := numString(v); s != "" {
			parts = append(parts, s)
		}
	}
	return strings.Join(parts, " x ")
}

// slugify converts a string to a URL-safe lowercase slug.
// parseCategoryParts splits "Gloves / BBQ" → ("Gloves", "BBQ"). No slash → ("Gardening Gloves", "").
func parseCategoryParts(raw string) (primary, sub string) {
	parts := strings.SplitN(raw, "/", 2)
	primary = strings.TrimSpace(parts[0])
	if len(parts) > 1 {
		sub = strings.TrimSpace(parts[1])
	}
	// Edge cases: "/ BBQ" or "Gloves /" — treat non-empty part as primary
	if primary == "" && sub != "" {
		primary = sub
		sub = ""
	}
	if primary == "" {
		primary = strings.TrimSpace(raw)
	}
	return
}

func slugify(s string) string {
	var b strings.Builder
	prev := false
	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			prev = false
		} else if !prev && b.Len() > 0 {
			b.WriteByte('-')
			prev = true
		}
	}
	return strings.TrimRight(b.String(), "-")
}

// sanitizeTemplate uses regex to fix common "mangling" by auto-formatters.
func (g *Generator) sanitizeTemplate(content string) string {
	// Fix broken [[ tags: "[ [" or "[  [" -> "[["
	reOpenBracket := regexp.MustCompile(`\[\s+\[`)
	content = reOpenBracket.ReplaceAllString(content, "[[")

	// Fix broken ]] tags: "] ]" or "]  ]" -> "]]"
	reCloseBracket := regexp.MustCompile(`\]\s+\]`)
	content = reCloseBracket.ReplaceAllString(content, "]]")

	return content
}
