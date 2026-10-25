package main

import (
	"html"
	"regexp"
	"strings"
)

var (
	scriptTagRegex = regexp.MustCompile(`(?i)<script[\s\S]*?</script>`)
	styleTagRegex  = regexp.MustCompile(`(?i)<style[\s\S]*?</style>`)
	htmlTagRegex   = regexp.MustCompile(`<[^>]*>`)
	ctrlCharsRegex = regexp.MustCompile(`[\x00-\x1F\x7F]`)
	multipleSpaces = regexp.MustCompile(`\s+`)
)

const (
	MinPriceBDT = 100.0
	MaxPriceBDT = 2500000.0
)

// CleanString strips script/style blocks, HTML tags, unescapes entities, and collapses spaces
func CleanString(input string) string {
	noScripts := scriptTagRegex.ReplaceAllString(input, " ")
	noStyles := styleTagRegex.ReplaceAllString(noScripts, " ")
	noHTML := htmlTagRegex.ReplaceAllString(noStyles, " ")
	unescaped := html.UnescapeString(noHTML)
	cleanCtrl := ctrlCharsRegex.ReplaceAllString(unescaped, " ")
	return strings.TrimSpace(multipleSpaces.ReplaceAllString(cleanCtrl, " "))
}

// SanitizeItem enforces defense-in-depth on scraped products before database ingestion
func SanitizeItem(item ScrapedItem) (ScrapedItem, bool) {
	// 1. Sanitize text fields
	title := CleanString(item.Title)
	vendor := CleanString(item.VendorName)
	category := CleanString(item.Category)
	stock := CleanString(item.StockStatus)

	if len(title) < 3 || len(title) > 280 {
		return item, false
	}

	// 2. Enforce Price Bounds
	if item.Price < MinPriceBDT || item.Price > MaxPriceBDT {
		return item, false
	}

	// 3. Verify Valid URL Schemes (Strictly http or https)
	cleanProductURL := strings.TrimSpace(item.ProductURL)
	if !strings.HasPrefix(cleanProductURL, "http://") && !strings.HasPrefix(cleanProductURL, "https://") {
		return item, false
	}

	cleanImageURL := strings.TrimSpace(item.ImageURL)
	if cleanImageURL != "" && !strings.HasPrefix(cleanImageURL, "http://") && !strings.HasPrefix(cleanImageURL, "https://") {
		cleanImageURL = ""
	}

	item.Title = title
	item.VendorName = vendor
	item.Category = category
	item.StockStatus = stock
	item.ProductURL = cleanProductURL
	item.ImageURL = cleanImageURL

	return item, true
}
