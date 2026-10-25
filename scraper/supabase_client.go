package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

type ScrapedItem struct {
	VendorName  string  `json:"vendor_name"`
	Title       string  `json:"title"`
	ProductURL  string  `json:"product_url"`
	ImageURL    string  `json:"image_url"`
	Price       float64 `json:"price"`
	StockStatus string  `json:"stock_status"`
	Category    string  `json:"category"`
}

type SupabaseBatchRequest struct {
	Items []ScrapedItem `json:"items"`
}

type SupabaseBatchResponse struct {
	Status       string `json:"status"`
	Processed    int    `json:"processed"`
	PriceUpdates int    `json:"price_updates"`
}

type SupabaseClient struct {
	URL        string
	ServiceKey string
	HTTPClient *http.Client
}

func NewSupabaseClient() *SupabaseClient {
	url := os.Getenv("SUPABASE_URL")
	if url == "" {
		url = "https://fuzwizxysoqcpucpllku.supabase.co"
	}
	key := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	if key == "" {
		key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1endpenh5c29xY3B1Y3BsbGt1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjkxODAxMiwiZXhwIjoyMTA4NDk0MDEyfQ.MVQYjahpozaqKLuZECQFbwDDJqubyb-s9N46W9kSHzc"
	}

	return &SupabaseClient{
		URL:        url,
		ServiceKey: key,
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (s *SupabaseClient) PushBatch(items []ScrapedItem) (*SupabaseBatchResponse, error) {
	if len(items) == 0 {
		return &SupabaseBatchResponse{Status: "empty", Processed: 0, PriceUpdates: 0}, nil
	}

	reqBody, err := json.Marshal(SupabaseBatchRequest{Items: items})
	if err != nil {
		return nil, fmt.Errorf("error marshaling batch: %w", err)
	}

	endpoint := fmt.Sprintf("%s/rest/v1/rpc/upsert_scraped_batch", s.URL)
	req, err := http.NewRequest("POST", endpoint, bytes.NewBuffer(reqBody))
	if err != nil {
		return nil, fmt.Errorf("error creating request: %w", err)
	}

	req.Header.Set("apikey", s.ServiceKey)
	req.Header.Set("Authorization", "Bearer "+s.ServiceKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("error sending request to Supabase: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("error reading response body: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("supabase returned HTTP %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var batchResp SupabaseBatchResponse
	if err := json.Unmarshal(bodyBytes, &batchResp); err != nil {
		return nil, fmt.Errorf("error unmarshaling Supabase response: %w (raw: %s)", err, string(bodyBytes))
	}

	return &batchResp, nil
}
