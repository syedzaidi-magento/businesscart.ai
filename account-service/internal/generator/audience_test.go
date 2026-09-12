package generator

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"business-cart/account-service/internal/storage"
)

// Every price the wholesale fixture product carries: base 264, tier 240,
// discounted 237.60. Word boundaries keep it from firing on a longer digit run,
// so a hex colour (#264653) or a timestamp is not mistaken for a leak, while a
// bare JS number (237.6) and a formatted one ($237.60) both match.
var wholesalePriceDigits = regexp.MustCompile(`\b(?:264|240|237)(?:\.[0-9]+)?\b`)

// jsonLDBlocks pulls every <script type="application/ld+json"> payload out of a
// rendered page. The JSON-LD is assembled by hand inside the template with
// conditional branches, so a misplaced comma in one branch produces a block that
// parses on the retail path and silently breaks on the wholesale one. Nothing
// else in the pipeline would catch that: the page still renders, and the loss is
// invisible until a crawler or an LLM drops the product.
func jsonLDBlocks(t *testing.T, html string) []map[string]interface{} {
	t.Helper()
	re := regexp.MustCompile(`(?s)<script type="application/ld\+json">(.*?)</script>`)
	matches := re.FindAllStringSubmatch(html, -1)
	if len(matches) == 0 {
		t.Fatal("no JSON-LD block found on the page")
	}
	out := make([]map[string]interface{}, 0, len(matches))
	for i, m := range matches {
		var parsed map[string]interface{}
		if err := json.Unmarshal([]byte(m[1]), &parsed); err != nil {
			t.Fatalf("JSON-LD block %d is not valid JSON: %v\n---\n%s\n---", i, err, m[1])
		}
		out = append(out, parsed)
	}
	return out
}

func audienceFixture(t *testing.T) (dir string, data StorefrontData) {
	t.Helper()
	dir = t.TempDir()
	data = StorefrontData{
		AccountID: "acct123",
		Company: &storage.CompanyData{
			Name: "Trade Co", UniqueIdentifier: "trade-test",
			Feeds: []string{"google", "google_reviews", "bing", "facebook", "pinterest", "tiktok"},
		},
		Config: &storage.D2CConfig{Enabled: true, PreviewDomain: "trade-test.businesscart.ai"},
		Products: []ProductData{
			{
				ID: "retailone", Name: "Retail Item", Slug: "retail-item",
				Category: "Bakery", Price: 4.25, Stock: 10, Description: "Sold to consumers",
				Rating: &Rating{Count: 1, Average: 5, Reviews: []Review{
					{Name: "Shopper", Rating: 5, Body: "Lovely."},
				}},
			},
			{
				ID: "wholesaleone", Name: "Full Sheet Cake", Slug: "full-sheet-cake",
				Category: "Bakery", Price: 264.00, Stock: 6, Description: "Catering size",
				Audience: AudienceWholesale, MinOrderQty: 4, OrderIncrement: 2,
				// Reviews matter here: the google_reviews feed only emits products
				// that have them, so without this the reviews feed would be empty
				// and its exclusion guard would be untested.
				Rating: &Rating{Count: 1, Average: 5, Reviews: []Review{
					{Name: "Trade Buyer", Rating: 5, Body: "Good for catering runs."},
				}},
			},
			{
				ID: "bothone", Name: "Sourdough Loaf", Slug: "sourdough-loaf",
				Category: "Bakery", Price: 7.50, Stock: 20, Description: "Retail and trade",
				Audience: AudienceBoth, MinOrderQty: 12,
			},
		},
	}
	return dir, data
}

func mustRead(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(b)
}

// findOne resolves the single file whose name starts with slug. The generator
// appends the last six characters of the product id to every filename, and
// restating that rule here would make the test assert its own arithmetic rather
// than the behaviour under test.
func findOne(t *testing.T, dir, slug, ext string) string {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(dir, slug+"*"+ext))
	if err != nil || len(matches) != 1 {
		t.Fatalf("expected exactly one %s%s in %s, got %v (err %v)", slug, ext, dir, matches, err)
	}
	return matches[0]
}

// The JSON-LD a wholesale-only product emits must be valid AND must not carry a
// consumer price. Advertising a price a shopper cannot pay is worse than
// publishing none: it earns a shopping rich result that leads to a page with no
// buy button.
func TestWholesaleProductJSONLDIsValidAndPriceless(t *testing.T) {
	dir, data := audienceFixture(t)
	g := NewGenerator("", dir, nil, "", nil, "")
	if err := g.Generate(data); err != nil {
		t.Fatalf("Generate: %v", err)
	}
	base := filepath.Join(dir, "trade-test", "products")

	wholesale := mustRead(t, findOne(t, base, "full-sheet-cake", ".html"))
	blocks := jsonLDBlocks(t, wholesale)

	var offers map[string]interface{}
	for _, b := range blocks {
		if o, ok := b["offers"].(map[string]interface{}); ok {
			offers = o
		}
	}
	if offers == nil {
		t.Fatal("wholesale PDP has no offers block in its JSON-LD")
	}
	if _, hasPrice := offers["price"]; hasPrice {
		t.Errorf("wholesale offer published a consumer price: %v", offers["price"])
	}
	if _, hasCurrency := offers["priceCurrency"]; hasCurrency {
		t.Error("wholesale offer published priceCurrency at the offer level")
	}
	// eligibleCustomerType takes BusinessEntityType, whose members are
	// GoodRelations URIs. schema.org/Wholesaler does not exist; asserting the real
	// values here is what stops an invented URI going back in.
	got, ok := offers["eligibleCustomerType"].([]interface{})
	if !ok {
		t.Fatalf("eligibleCustomerType = %v, want a list of GoodRelations URIs", offers["eligibleCustomerType"])
	}
	want := map[string]bool{
		"http://purl.org/goodrelations/v1#Business": true,
		"http://purl.org/goodrelations/v1#Reseller": true,
	}
	for _, v := range got {
		if !want[v.(string)] {
			t.Errorf("eligibleCustomerType contains %q, which is not a BusinessEntityType member", v)
		}
	}
	if len(got) != len(want) {
		t.Errorf("eligibleCustomerType = %v, want both Business and Reseller", got)
	}

	// The retail product on the same run must be untouched: valid, priced.
	retail := mustRead(t, findOne(t, base, "retail-item", ".html"))
	for _, b := range jsonLDBlocks(t, retail) {
		if o, ok := b["offers"].(map[string]interface{}); ok {
			if o["price"] != "4.25" {
				t.Errorf("retail offer price = %v, want \"4.25\"", o["price"])
			}
			if o["priceCurrency"] != "USD" {
				t.Errorf("retail offer priceCurrency = %v, want USD", o["priceCurrency"])
			}
		}
	}
}

// A wholesale-only product keeps its page (it stays crawlable, which is the
// whole acquisition point) but loses every consumer buy path, including the
// mobile sticky bar. The mobile bar is easy to miss: it is a second, separate
// Add-to-Cart lower in the same template.
func TestWholesaleProductHasNoConsumerBuyPath(t *testing.T) {
	dir, data := audienceFixture(t)
	g := NewGenerator("", dir, nil, "", nil, "")
	if err := g.Generate(data); err != nil {
		t.Fatalf("Generate: %v", err)
	}
	base := filepath.Join(dir, "trade-test", "products")

	wholesale := mustRead(t, findOne(t, base, "full-sheet-cake", ".html"))
	if strings.Contains(wholesale, "Add to Cart") {
		t.Error("wholesale PDP still offers Add to Cart")
	}
	if strings.Contains(wholesale, "D2C_CART.addItem") {
		t.Error("wholesale PDP still wires the cart JS")
	}
	if strings.Contains(wholesale, "$264.00") {
		t.Error("wholesale PDP still shows the consumer price")
	}
	// The CTA must stay on the merchant's own domain. Linking out to
	// businesscart.ai would contradict the white-label promise and hand a
	// merchant's prospect to the platform's marketing site mid-enquiry.
	if !strings.Contains(wholesale, "contact.html#trade") {
		t.Error("wholesale PDP has no trade-access link")
	}
	// The href must be RELATIVE, so it resolves on the preview domain and on a
	// custom domain alike. A bare "businesscart.ai" check would be wrong here:
	// the preview domain is itself a businesscart.ai subdomain. What must not
	// appear is a link into the platform's own portal pages.
	if !strings.Contains(wholesale, `href="../contact.html#trade"`) {
		t.Error("trade CTA is not a relative link from inside /products")
	}
	if strings.Contains(wholesale, "request-b2b-code") {
		t.Error("trade CTA still points into the platform portal")
	}

	// Retail keeps everything it had.
	retail := mustRead(t, findOne(t, base, "retail-item", ".html"))
	if !strings.Contains(retail, "Add to Cart") {
		t.Error("retail PDP lost its Add to Cart")
	}
	if !strings.Contains(retail, "$4.25") {
		t.Error("retail PDP lost its price")
	}

	// "both" is the case that must keep BOTH: a consumer can still buy it, and a
	// business buyer is still invited to open a trade account.
	both := mustRead(t, findOne(t, base, "sourdough-loaf", ".html"))
	if !strings.Contains(both, "Add to Cart") {
		t.Error("dual-audience PDP lost its Add to Cart")
	}
	if !strings.Contains(both, "contact.html#trade") {
		t.Error("dual-audience PDP has no trade-access link")
	}
}

// A wholesale-only product must have no consumer price and no buy path on ANY
// generated surface, not just its own page. Every one of these leaked at least
// once during the build:
//
//   - the listing/category/home grids rendered the price
//   - those grids carried a quick-add button that put the item straight into the
//     cart at list price, bypassing the PDP entirely
//   - index.html and deals.html had no stock guard on quick-add at all
//   - the volume-pricing ladder rendered on the PDP, its first row being the
//     base consumer price, directly under text saying pricing is not published
//   - the related-products list in the .md companion printed the price
//
// This walks every generated file rather than naming surfaces, so a new page
// type added later is covered without anyone remembering to extend the test.
func TestWholesaleLeaksOnNoGeneratedSurface(t *testing.T) {
	dir, data := audienceFixture(t)
	// Give the wholesale product every attribute that drives a price render.
	for i := range data.Products {
		if data.Products[i].Audience == AudienceWholesale {
			data.Products[i].Featured = true
			data.Products[i].DealPrice = 10
			data.Products[i].PriceTiers = []PriceTier{{MinQty: 10, Price: 240}}
			data.Products[i].DiscountedPrice = 237.60
		}
	}
	g := NewGenerator("", dir, nil, "", nil, "")
	if err := g.Generate(data); err != nil {
		t.Fatalf("Generate: %v", err)
	}

	root := filepath.Join(dir, "trade-test")
	wholesaleID := "wholesaleone"
	var checked int
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		switch filepath.Ext(path) {
		case ".html", ".md", ".txt", ".xml", ".csv", ".tsv":
		default:
			return nil
		}
		body, rErr := os.ReadFile(path)
		if rErr != nil {
			return rErr
		}
		checked++
		s := string(body)
		rel, _ := filepath.Rel(root, path)
		// Every price the wholesale product carries, not just its base. Greping
		// only the base price is how the tier price ($240) and the discounted
		// price leaked into product.md and index.md: both rendered a real figure
		// the PDP withholds, and this test passed anyway.
		//
		// Matched as digit sequences, not formatted literals, because the same
		// number is written differently per surface: templates emit "237.60"
		// but a JS object literal emits 237.6, so a check for the formatted
		// string silently misses a leak into a <script> block.
		if m := wholesalePriceDigits.FindString(s); m != "" {
			t.Errorf("%s renders a wholesale price (%s)", rel, m)
		}
		if strings.Contains(s, "addItem({_id:'"+wholesaleID+"'") {
			t.Errorf("%s wires the wholesale product into the cart", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	if checked < 5 {
		t.Fatalf("only %d generated files scanned; the walk is not covering the storefront", checked)
	}
}

// The dual-audience case is the one a blunt fix breaks: it must keep every
// consumer affordance AND gain the trade route.
func TestDualAudienceKeepsConsumerPathAndGainsTrade(t *testing.T) {
	dir, data := audienceFixture(t)
	for i := range data.Products {
		if data.Products[i].Audience == AudienceBoth {
			data.Products[i].PriceTiers = []PriceTier{{MinQty: 12, Price: 6.80}}
		}
	}
	g := NewGenerator("", dir, nil, "", nil, "")
	if err := g.Generate(data); err != nil {
		t.Fatalf("Generate: %v", err)
	}
	both := mustRead(t, findOne(t, filepath.Join(dir, "trade-test", "products"), "sourdough-loaf", ".html"))
	for _, want := range []string{"7.50", "D2C_CART.addItem", "Volume Pricing", "Request a trade account", "MOQ"} {
		if !strings.Contains(both, want) {
			t.Errorf("dual-audience PDP lost %q", want)
		}
	}
}

// The .md companion is what ChatGPT, Perplexity and Google AI actually read.
// A price removed from the HTML but left in the markdown would tell a human one
// story and every LLM another, which is the exact split the FAQ work was bitten
// by once already.
func TestWholesaleMarkdownCompanionWithholdsPrice(t *testing.T) {
	dir, data := audienceFixture(t)
	g := NewGenerator("", dir, nil, "", nil, "")
	if err := g.Generate(data); err != nil {
		t.Fatalf("Generate: %v", err)
	}
	base := filepath.Join(dir, "trade-test")

	md := mustRead(t, findOne(t, filepath.Join(base, "products"), "full-sheet-cake", ".md"))
	if strings.Contains(md, "264.00") {
		t.Error("wholesale .md companion published the consumer price")
	}
	if !strings.Contains(md, "Wholesale only") {
		t.Error("wholesale .md companion does not say it is wholesale only")
	}
	if !strings.Contains(md, "Minimum order**: 4 units") {
		t.Error("wholesale .md companion omits the MOQ an LLM would need")
	}
	if !strings.Contains(md, "case pack") {
		t.Error("wholesale .md companion omits the order increment")
	}

	// The aggregate LLM surfaces must agree with the per-product one.
	for _, f := range []string{"products.md", "index.md", "llms.txt"} {
		body := mustRead(t, filepath.Join(base, f))
		if strings.Contains(body, "264.00") {
			t.Errorf("%s published the wholesale product's consumer price", f)
		}
	}

	// "both" keeps its consumer price and gains a wholesale note.
	bothMD := mustRead(t, findOne(t, filepath.Join(base, "products"), "sourdough-loaf", ".md"))
	if !strings.Contains(bothMD, "7.50") {
		t.Error("dual-audience .md lost its consumer price")
	}
	if !strings.Contains(bothMD, "Also available wholesale") {
		t.Error("dual-audience .md does not mention wholesale availability")
	}
}

// Shopping feeds are consumer ad surfaces. A wholesale-only product in one buys
// clicks to a page with no price and no cart, which is money spent on a
// guaranteed bounce.
func TestWholesaleProductExcludedFromEveryFeed(t *testing.T) {
	dir, data := audienceFixture(t)
	g := NewGenerator("", dir, nil, "", nil, "")
	if err := g.Generate(data); err != nil {
		t.Fatalf("Generate: %v", err)
	}
	feedsDir := filepath.Join(dir, "trade-test", "feeds")

	entries, err := os.ReadDir(feedsDir)
	if err != nil {
		t.Fatalf("read feeds dir: %v", err)
	}
	if len(entries) == 0 {
		t.Fatal("no feeds generated, so this test proves nothing")
	}
	for _, e := range entries {
		body := mustRead(t, filepath.Join(feedsDir, e.Name()))
		if strings.Contains(body, "Full Sheet Cake") || strings.Contains(body, "full-sheet-cake") {
			t.Errorf("%s contains the wholesale-only product", e.Name())
		}
		// The retail product proves the feed was actually populated, so the
		// assertion above cannot pass by way of an empty file.
		if !strings.Contains(body, "Retail Item") {
			t.Errorf("%s is missing the retail product, feed may be empty", e.Name())
		}
	}
}

// Guard on the default. Every product that existed before this field was added
// decodes with Audience == "", and must behave exactly as it did: priced,
// sellable, fed. This is the property that makes the change migration-free.
func TestAbsentAudienceBehavesAsRetail(t *testing.T) {
	if (ProductData{}).IsWholesaleOnly() {
		t.Error("a product with no audience was treated as wholesale-only")
	}
	if (ProductData{}).ShowsTradeBlock() {
		t.Error("a product with no audience rendered the trade block")
	}
	for _, near := range []string{"Wholesale", "WHOLESALE", "wholesale ", "b2b", "trade"} {
		if (ProductData{Audience: near}).IsWholesaleOnly() {
			t.Errorf("audience %q hid a product; only the exact value may", near)
		}
	}
}
