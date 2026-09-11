# [[.Product.Name]]

## Product Specifications
- **Name**: [[.Product.Name]]
[[if .Product.IsWholesaleOnly]]- **Price**: Wholesale only. Pricing is per trade account and is not published.
- **How to buy**: Request a trade account at https://[[.Domain]]/contact.html#trade[[if .Product.MinOrderQty]]
- **Minimum order**: [[.Product.MinOrderQty]] units[[end]][[if .Product.OrderIncrement]]
- **Order increment**: multiples of [[.Product.OrderIncrement]] (case pack)[[end]][[if .Product.MaxOrderQty]]
- **Maximum order**: [[.Product.MaxOrderQty]] units[[end]][[else]]- **Price**: $[[printf "%.2f" .Product.Price]] USD[[if .Product.DealPrice]]
- **Sale Price**: $[[printf "%.2f" .Product.DiscountedPrice]] USD ([[printf "%.0f" .Product.DealPrice]]% off)[[end]][[end]]
- **Category**: [[.Product.Category]]
- **Availability**: [[if gt .Product.Stock 0]]In Stock ([[.Product.Stock]] available)[[else]]Out of Stock[[end]][[if .Product.SKU]]
- **SKU**: [[.Product.SKU]][[end]][[if .Product.Barcode]]
- **Barcode**: [[.Product.Barcode]][[end]][[if num .Product.Weight]]
- **Shipping Weight**: [[num .Product.Weight]] lb[[end]][[if dims .Product.Length .Product.Width .Product.Height]]
- **Package Dimensions**: [[dims .Product.Length .Product.Width .Product.Height]] in[[end]]
- **Description**: [[.Product.Description]]
[[if .Product.Image]]- **Image**: [[.Product.Image]][[end]]

[[if and .Product.ShowsTradeBlock (not .Product.IsWholesaleOnly)]]## Wholesale
Also available wholesale. Trade pricing is per account and is not published.[[if .Product.MinOrderQty]]
- **Minimum order**: [[.Product.MinOrderQty]] units[[end]][[if .Product.OrderIncrement]]
- **Order increment**: multiples of [[.Product.OrderIncrement]] (case pack)[[end]]
- **Request a trade account**: https://[[.Domain]]/contact.html#trade

[[end]][[if .Product.PriceTiers]]## Volume Pricing
[[range .Product.PriceTiers]]- [[.MinQty]]+ units: $[[printf "%.2f" .Price]]
[[end]][[end]]
[[if .Product.Attributes]]## Attributes
[[range .Product.Attributes]]- **[[.Key]]**: [[.Value]]
[[end]][[end]]
[[if and .Product.FAQ .Product.FAQ.Items]]## Questions & Answers
[[range .Product.FAQ.Items]]### [[.Question]]

[[.Answer]]

[[end]][[end]]
[[if and .Product.Rating (gt .Product.Rating.Count 0)]]## Customer Reviews
**Average Rating**: [[printf "%.1f" .Product.Rating.Average]] / 5 (based on [[.Product.Rating.Count]] review[[if ne .Product.Rating.Count 1]]s[[end]])

[[range .Product.Rating.Reviews]]### [[.Rating]] / 5[[if .Title]] — [[.Title]][[end]]
*By [[.Name]][[if .Verified]] (Verified Purchase)[[end]] on [[.Date.Format "Jan 2, 2006"]]*

[[.Body]]

[[end]][[end]]
[[if .RelatedProducts]]## Related Products
[[range .RelatedProducts]]- [[.Name]]: [[if .IsWholesaleOnly]]wholesale only, trade account required[[else]]$[[printf "%.2f" .Price]][[if .DealPrice]] (Sale: $[[printf "%.2f" .DiscountedPrice]])[[end]][[end]] — [View](../products/[[.Filename]].md)
[[end]][[end]]
## Contextual Links
- **Company**: [[.Company.Name]]
- **Storefront Home**: [index.md](../index.md)
- **Full Catalog**: [products.md](../products.md)
- **HTML Version**: [View Page]([[.Product.Filename]].html)

## Metadata
[[if lastmod .Product.UpdatedAt]]- **Last updated**: [[lastmod .Product.UpdatedAt]][[end]]
- **Product ID**: [[.Product.ID]]
