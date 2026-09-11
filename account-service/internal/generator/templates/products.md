# [[.Company.Name]] — Full Product Catalog

[[len .Products]] products available.

## Categories
[[range .Categories]]- [[.]]
[[end]]

## Products
[[range .Products]]
### [[.Name]]
- **Price**: [[if .IsWholesaleOnly]]Wholesale only, trade account required[[else]]$[[printf "%.2f" .Price]][[end]][[if and .DealPrice (not .IsWholesaleOnly)]] (Sale: $[[printf "%.2f" .DiscountedPrice]] — [[printf "%.0f" .DealPrice]]% off)[[end]]
- **Category**: [[.Category]]
- **Availability**: [[if gt .Stock 0]]In Stock[[else]]Out of Stock[[end]]
- **Description**: [[.Description]]
[[if .Attributes]]- **Specifications**:
[[range .Attributes]]  - [[.Key]]: [[.Value]]
[[end]][[end]]- **Details**: [View Product](products/[[.Filename]].md)

[[end]]
## Metadata
- **Company**: [[.Company.Name]]
[[if .CatalogLastMod]]- **Last updated**: [[.CatalogLastMod]][[end]]
