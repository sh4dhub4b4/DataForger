package main

import (
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gocolly/colly/v2"
)

var numberRegex = regexp.MustCompile(`[0-9]+(\.[0-9]+)?`)
var digitRegex = regexp.MustCompile(`[0-9]+`)

// Helper to process the "Pipe" formula logic
func processCustomFormula(val string, formula string) string {
	if formula == "" {
		return val
	}

	// Split by pipe "|"
	ops := strings.Split(formula, "|")

	for _, op := range ops {
		op = strings.TrimSpace(op)
		
		// 1. Simple Commands
		switch op {
		case "trim":
			val = strings.TrimSpace(val)
			continue
		case "upper":
			val = strings.ToUpper(val)
			continue
		case "lower":
			val = strings.ToLower(val)
			continue
		case "normalize":
			val = strings.Join(strings.Fields(val), " ")
			continue
		}

		// 2. Commands with Arguments: func("arg1", "arg2")
		if strings.Contains(op, "(") && strings.HasSuffix(op, ")") {
			parts := strings.SplitN(op, "(", 2)
			cmd := strings.TrimSpace(parts[0])
			argsRaw := strings.TrimSuffix(parts[1], ")")
			
			// Simple parser for quoted arguments
			argParts := strings.Split(argsRaw, ",")
			var args []string
			for _, a := range argParts {
				clean := strings.TrimSpace(a)
				// Remove both single and double quotes so replace('"', '') works
				clean = strings.Trim(clean, "\"")
				clean = strings.Trim(clean, "'")
				args = append(args, clean)
			}

			switch cmd {
			case "replace":
				if len(args) == 2 {
					target := args[0]
					replacement := args[1]
					// SPECIAL: Handle "*0~9" OR "if_num" as a wildcard for ANY number
					if target == "*0~9" || target == "if_num" {
						val = digitRegex.ReplaceAllString(val, replacement)
					} else {
						val = strings.ReplaceAll(val, target, replacement)
					}
				}
			case "remove":
				if len(args) == 1 {
					val = strings.ReplaceAll(val, args[0], "")
				}
			case "prepend":
				if len(args) == 1 {
					val = args[0] + val
				}
			case "append":
				if len(args) == 1 {
					val = val + args[0]
				}
			case "split":
				if len(args) == 2 {
					sep := args[0]
					var idx int
					fmt.Sscan(args[1], &idx)
					chunks := strings.Split(val, sep)
					if idx >= 0 && idx < len(chunks) {
						val = chunks[idx]
					}
				}
			case "if_num":
				checkVal := strings.ReplaceAll(val, ",", "")
				checkVal = strings.ReplaceAll(checkVal, ".", "")
				checkVal = strings.ReplaceAll(checkVal, "$", "")
				hasDigits := digitRegex.MatchString(checkVal)
				if len(args) >= 1 {
					trueText := args[0]
					falseText := val 
					if len(args) >= 2 {
						falseText = args[1]
					}
					if hasDigits {
						val = trueText
					} else {
						val = falseText
					}
				}
			}
		}
	}
	return val
}

// RunScraper executes the scraping job based on the provided config
func RunScraper(config ScraperConfig, projectName string, logCallback func(string)) {
	logCallback("🚀 Engine Started: " + config.Meta.URL)

	outName := config.Output.Filename
	if outName == "" {
		outName = "data"
	}
	
	projectPath := filepath.Join("Scraper_Projects", projectName)
	outputPath := filepath.Join(projectPath, "outputs", outName+"."+config.Output.Format)
	os.MkdirAll(filepath.Dir(outputPath), os.ModePerm)

	file, err := os.Create(outputPath)
	if err != nil {
		logCallback(fmt.Sprintf("❌ Error creating file: %s", err))
		return
	}
	defer file.Close()

	writer := csv.NewWriter(file) // ponytail: stdlib csv, comma delimiter
	defer writer.Flush()

    var csvMutex sync.Mutex

	var headers []string
	for _, f := range config.Fields {
		headers = append(headers, f.Name)
	}
	writer.Write(headers)

	c := colly.NewCollector(colly.Async(true))
	c.Limit(&colly.LimitRule{DomainGlob: "*", Parallelism: 5, Delay: 1 * time.Second})

	itemCount := 0
	pageCount := 1

	c.OnHTML(config.Container.Selector, func(e *colly.HTMLElement) {
		var row []string

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
                    val = e.Attr(field.Attr) // Custom attr on self
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

			// --- FILTER LOGIC ---
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
			if val == "" {
				val = "N/A"
			}
			row = append(row, val)
		}

        csvMutex.Lock()
		writer.Write(row)
		itemCount++
        if itemCount % 10 == 0 {
            writer.Flush()
        }
        csvMutex.Unlock()
	})

	// Pagination
	if config.Pagination.Type == "page_loop" {
		param := config.Pagination.Selector
		if param == "" { param = "page" }
		limit := config.Pagination.Limit
		if limit == 0 { limit = 1 }

		logCallback(fmt.Sprintf("🔄 Looping Pages 1 to %d", limit))
		separator := "?"
		if strings.Contains(config.Meta.URL, "?") { separator = "&" }

		for i := 1; i <= limit; i++ {
			targetURL := fmt.Sprintf("%s%s%s=%d", config.Meta.URL, separator, param, i)
			logCallback(fmt.Sprintf("Visiting: %s", targetURL))
			c.Visit(targetURL)
		}
	} else if config.Pagination.Type == "next_button" && config.Pagination.Selector != "" {
		limit := config.Pagination.Limit
		if limit == 0 { limit = 1 } // ponytail: consistent with page_loop default
		c.OnHTML(config.Pagination.Selector, func(e *colly.HTMLElement) {
			if pageCount < limit {
				nextPage := e.Attr("href")
				if nextPage == "" { nextPage = e.ChildAttr("a", "href") }
				if nextPage != "" {
					pageCount++
					logCallback(fmt.Sprintf("Visiting Page %d...", pageCount))
					e.Request.Visit(nextPage)
				}
			}
		})
		c.Visit(config.Meta.URL)
	} else {
		c.Visit(config.Meta.URL)
	}

	c.Wait()
	logCallback(fmt.Sprintf("✅ DONE! Scraped %d items.", itemCount))
	logCallback(fmt.Sprintf("💾 Saved to: %s", outputPath))
}