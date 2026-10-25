package main

import (
	"testing"
)

func TestCleanString(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{"<script>alert('xss')</script>Samsung 980 Pro", "Samsung 980 Pro"},
		{"<style>.color{red}</style>MSI Optix G241", "MSI Optix G241"},
		{"Gigabyte &amp; ASUS 27&#34; 2K", "Gigabyte & ASUS 27\" 2K"},
		{"Redmi   G27Q   \t \n 320Hz", "Redmi G27Q 320Hz"},
		{"<div class=\"badge\">OLED</div> Koorui 24E4", "OLED Koorui 24E4"},
	}

	for _, c := range cases {
		result := CleanString(c.input)
		if result != c.expected {
			t.Errorf("CleanString(%q) = %q; expected %q", c.input, result, c.expected)
		}
	}
}

func TestSanitizeItem(t *testing.T) {
	validItem := ScrapedItem{
		VendorName:  "Star Tech",
		Title:       "Samsung 980 Pro 1TB NVMe PCIe 4.0 SSD",
		ProductURL:  "https://www.startech.com.bd/samsung-980-pro-1tb",
		ImageURL:    "https://www.startech.com.bd/image.jpg",
		Price:       15500,
		StockStatus: "In Stock",
		Category:    "SSD",
	}

	// Case 1: Standard valid item
	clean, ok := SanitizeItem(validItem)
	if !ok || clean.Price != 15500 {
		t.Fatalf("Expected valid item to pass, got ok=%v", ok)
	}

	// Case 2: Zero or Negative price
	zeroPrice := validItem
	zeroPrice.Price = 0
	if _, ok := SanitizeItem(zeroPrice); ok {
		t.Errorf("Expected zero price to be rejected")
	}

	negativePrice := validItem
	negativePrice.Price = -500
	if _, ok := SanitizeItem(negativePrice); ok {
		t.Errorf("Expected negative price to be rejected")
	}

	// Case 3: Absurdly high ad banner price
	absurdPrice := validItem
	absurdPrice.Price = 10000000.0 // 10 Million BDT
	if _, ok := SanitizeItem(absurdPrice); ok {
		t.Errorf("Expected absurdly high price to be rejected")
	}

	// Case 4: Invalid/Malicious URL scheme
	maliciousURL := validItem
	maliciousURL.ProductURL = "javascript:alert(document.cookie)"
	if _, ok := SanitizeItem(maliciousURL); ok {
		t.Errorf("Expected javascript: scheme to be rejected")
	}

	// Case 5: Injected script in title
	injectedItem := validItem
	injectedItem.Title = "<script>alert(1)</script>Acer Nitro VG271U"
	cleanInj, ok := SanitizeItem(injectedItem)
	if !ok || cleanInj.Title != "Acer Nitro VG271U" {
		t.Errorf("Expected script stripped title 'Acer Nitro VG271U', got %q", cleanInj.Title)
	}
}
