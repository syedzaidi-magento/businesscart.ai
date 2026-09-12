# [[.Company.Name]] Storefront Context

## Company Overview
- **Name**: [[.Company.Name]]
- **Slogan**: [[.Config.HeroSlogan]]
- **Contact**: [[.Config.ContactEmail]] / [[.Config.ContactPhone]]
- **Storefront**: https://[[.Domain]]

## Categories
[[range .Categories]]- [[.]]
[[end]]

## Product Catalog Summary
This storefront contains [[len .Products]] products.

### Product List
[[range .Products]]- **[[.Name]]**: [[if .IsWholesaleOnly]]wholesale only (trade account required)[[else]]$[[printf "%.2f" .Price]][[end]][[if and .DealPrice (not .IsWholesaleOnly)]] (Sale: $[[printf "%.2f" .DiscountedPrice]] — [[printf "%.0f" .DealPrice]]% off)[[end]] — [[.Category]]
  - [Product Details](products/[[.Filename]].md)
[[end]]

## Resources
- [Full Product Catalog](products.md)
- [LLM Context](llms.txt)
- [Sitemap](sitemap.xml)

## Metadata
[[if .CatalogLastMod]]- **Last updated**: [[.CatalogLastMod]][[end]]
- **Year**: [[.Year]]
