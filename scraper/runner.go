package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gocolly/colly/v2"
)

func deduceVendorAndCategory(configName, folderName string) (string, string) {
	lower := strings.ToLower(configName)
	vendor := "Other"

	switch {
	case strings.Contains(lower, "startech"):
		vendor = "Star Tech"
	case strings.Contains(lower, "ryans"):
		vendor = "Ryans"
	case strings.Contains(lower, "techland"):
		vendor = "Tech Land"
	case strings.Contains(lower, "computer_village") || strings.Contains(lower, "computervillage"):
		vendor = "Computer Village"
	case strings.Contains(lower, "pc_house") || strings.Contains(lower, "pchouse"):
		vendor = "PC House BD"
	case strings.Contains(lower, "ucc"):
		vendor = "UCC"
	case strings.Contains(lower, "ultratech"):
		vendor = "UltraTech"
	default:
		vendor = configName
	}

	category := folderName
	if category == "" || category == "." {
		category = "Component"
	}

	return vendor, category
}

func RunConfigWithSupabase(configPath string, supa *SupabaseClient, maxPages int) error {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return fmt.Errorf("read config file: %w", err)
	}

	var config ScraperConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return fmt.Errorf("parse config json: %w", err)
	}

	folderName := filepath.Base(filepath.Dir(configPath))
	configBase := strings.TrimSuffix(filepath.Base(configPath), ".json")
	vendor, category := deduceVendorAndCategory(configBase, folderName)

	log.Printf("🚀 Starting Scraper for [%s] (%s) -> Target: %s", vendor, category, config.Meta.URL)

	var itemsBatch []ScrapedItem
	var batchMutex sync.Mutex
	totalProcessed := 0
	totalPriceUpdates := 0

	flushBatch := func() {
		batchMutex.Lock()
		defer batchMutex.Unlock()
		if len(itemsBatch) == 0 {
			return
		}

		resp, err := supa.PushBatch(itemsBatch)
		if err != nil {
			log.Printf("⚠️ Supabase Push Error: %v", err)
		} else {
			totalProcessed += resp.Processed
			totalPriceUpdates += resp.PriceUpdates
			log.Printf("  ⚡ [Supabase Sync] Batch: %d items | Updated Prices: %d", resp.Processed, resp.PriceUpdates)
		}
		itemsBatch = itemsBatch[:0]
	}

	c := colly.NewCollector(colly.Async(false))
	c.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
	c.Limit(&colly.LimitRule{
		DomainGlob:  "*",
		Parallelism: 2,
		Delay:       1200 * time.Millisecond,
	})

	c.OnRequest(func(r *colly.Request) {
		r.Headers.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8")
		r.Headers.Set("Accept-Language", "en-US,en;q=0.9")
		r.Headers.Set("Sec-Ch-Ua", `"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"`)
		r.Headers.Set("Sec-Ch-Ua-Mobile", "?0")
		r.Headers.Set("Sec-Ch-Ua-Platform", `"Windows"`)
		r.Headers.Set("Sec-Fetch-Dest", "document")
		r.Headers.Set("Sec-Fetch-Mode", "navigate")
		r.Headers.Set("Sec-Fetch-Site", "none")
		r.Headers.Set("Sec-Fetch-User", "?1")
		r.Headers.Set("Upgrade-Insecure-Requests", "1")
	})

	pageCount := 1

	c.OnHTML(config.Container.Selector, func(e *colly.HTMLElement) {
		item := ScrapedItem{
			VendorName:  vendor,
			Category:    category,
			StockStatus: "In Stock",
		}

		for _, field := range config.Fields {
			var val string

			if field.Selector == "" {
				if field.Attr == "text" {
					val = e.Text
				} else if field.Attr == "href" {
					val = e.Attr("href")
				} else if field.Attr == "src" {
					val = e.Attr("src")
				} else {
					val = e.Attr(field.Attr)
				}
			} else {
				if field.Attr == "none" {
					if strings.Contains(field.Selector, "::attr(") {
						parts := strings.Split(field.Selector, "::attr(")
						if len(parts) == 2 {
							realSelector := strings.TrimSpace(parts[0])
							attrName := strings.TrimSuffix(parts[1], ")")
							val = e.ChildAttr(realSelector, attrName)
						}
					} else {
						val = e.ChildText(field.Selector)
					}
				} else if field.Attr == "text" {
					val = e.ChildText(field.Selector)
				} else if field.Attr == "href" {
					val = e.ChildAttr(field.Selector, "href")
				} else if field.Attr == "src" {
					val = e.ChildAttr(field.Selector, "src")
				} else {
					val = e.ChildAttr(field.Selector, field.Attr)
				}
			}

			// Filters
			switch field.Filter {
			case "number":
				clean := strings.ReplaceAll(val, ",", "")
				match := numberRegex.FindString(clean)
				if match != "" {
					val = match
				}
			case "url":
				val = e.Request.AbsoluteURL(val)
			case "custom":
				val = processCustomFormula(val, field.Formula)
			}

			val = strings.TrimSpace(val)

			fieldName := strings.ToLower(field.Name)
			switch {
			case strings.Contains(fieldName, "title") || strings.Contains(fieldName, "name"):
				item.Title = val
			case strings.Contains(fieldName, "link") || strings.Contains(fieldName, "url"):
				item.ProductURL = e.Request.AbsoluteURL(val)
			case strings.Contains(fieldName, "image") || strings.Contains(fieldName, "img"):
				item.ImageURL = e.Request.AbsoluteURL(val)
			case strings.Contains(fieldName, "price"):
				cleanPrice := strings.ReplaceAll(val, ",", "")
				if p, err := strconv.ParseFloat(cleanPrice, 64); err == nil {
					item.Price = p
				}
			case strings.Contains(fieldName, "status"):
				if val != "" {
					item.StockStatus = val
				}
			}
		}

		if item.Title != "" && item.ProductURL != "" {
			batchMutex.Lock()
			itemsBatch = append(itemsBatch, item)
			shouldFlush := len(itemsBatch) >= 25
			batchMutex.Unlock()

			if shouldFlush {
				flushBatch()
			}
		}
	})

	limit := config.Pagination.Limit
	if limit <= 0 {
		limit = 1
	}
	if maxPages > 0 && maxPages < limit {
		limit = maxPages
	}

	if strings.Contains(config.Meta.URL, "web.archive.org") {
		c.Visit(config.Meta.URL)
	} else if config.Pagination.Type == "page_loop" {
		param := config.Pagination.Selector
		if param == "" {
			param = "page"
		}
		separator := "?"
		if strings.Contains(config.Meta.URL, "?") {
			separator = "&"
		}

		for i := 1; i <= limit; i++ {
			targetURL := fmt.Sprintf("%s%s%s=%d", config.Meta.URL, separator, param, i)
			c.Visit(targetURL)
		}
	} else if config.Pagination.Type == "next_button" && config.Pagination.Selector != "" {
		c.OnHTML(config.Pagination.Selector, func(e *colly.HTMLElement) {
			if pageCount < limit {
				nextPage := e.Attr("href")
				if nextPage == "" {
					nextPage = e.ChildAttr("a", "href")
				}
				if nextPage != "" {
					pageCount++
					e.Request.Visit(nextPage)
				}
			}
		})
		c.Visit(config.Meta.URL)
	} else {
		c.Visit(config.Meta.URL)
	}

	c.Wait()
	flushBatch()

	log.Printf("✅ Completed [%s] - Total Processed: %d | Total Price Updates: %d", vendor, totalProcessed, totalPriceUpdates)
	return nil
}

func RunAllConfigs(rootDir, filterCategory string, supa *SupabaseClient, maxPages int) {
	err := filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.HasSuffix(info.Name(), ".json") {
			rel, _ := filepath.Rel(rootDir, path)
			category := filepath.Dir(rel)

			if filterCategory != "" && !strings.EqualFold(category, filterCategory) {
				return nil
			}

			log.Printf("===> Processing: %s (Category: %s)", info.Name(), category)
			if err := RunConfigWithSupabase(path, supa, maxPages); err != nil {
				log.Printf("❌ Failed config %s: %v", info.Name(), err)
			}
			time.Sleep(1 * time.Second) // polite cooldown between stores
		}
		return nil
	})

	if err != nil {
		log.Fatalf("Error walking configs: %v", err)
	}
}

func main() {
	configPath := flag.String("config", "", "Path to specific JSON scraper config")
	category := flag.String("category", "SSD", "Category folder to scrape (e.g., SSD, Processor, or all)")
	maxPages := flag.Int("pages", 1, "Max pages to scrape per vendor (1 for quick sync)")
	flag.Parse()

	supa := NewSupabaseClient()
	log.Printf("🔗 Connected to Supabase: %s", supa.URL)

	if *configPath != "" {
		if err := RunConfigWithSupabase(*configPath, supa, *maxPages); err != nil {
			log.Fatalf("Fatal error: %v", err)
		}
	} else {
		projectDir := "Scraper_Projects"
		catFilter := *category
		if catFilter == "all" {
			catFilter = ""
		}
		RunAllConfigs(projectDir, catFilter, supa, *maxPages)
	}
}
