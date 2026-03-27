package llm

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
)

var enrichCacheFilePath = getEnrichCacheFilePath()

func getEnrichCacheFilePath() string {
	if path := os.Getenv("ENRICHMENT_CACHE_PATH"); path != "" {
		return path
	}
	return "data/enrichment_cache.json"
}

// EnrichCacheEntry stores cached enrichment results (without batch-specific Index).
type EnrichCacheEntry struct {
	Title    string `json:"title"`
	Location string `json:"location"`
	Category string `json:"category"`
}

var (
	enrichCacheInstance map[string]EnrichCacheEntry
	enrichCacheMutex   sync.RWMutex
	enrichCacheOnce    sync.Once
)

func initEnrichCache() {
	enrichCacheMutex.Lock()
	defer enrichCacheMutex.Unlock()

	enrichCacheInstance = make(map[string]EnrichCacheEntry)

	err := os.MkdirAll(filepath.Dir(enrichCacheFilePath), 0755)
	if err != nil {
		log.Printf("Warning: failed to create data directory for enrichment cache: %v", err)
		return
	}

	data, err := os.ReadFile(enrichCacheFilePath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("Warning: failed to read enrichment cache: %v", err)
		}
		return
	}

	if err := json.Unmarshal(data, &enrichCacheInstance); err != nil {
		log.Printf("Warning: failed to parse enrichment cache: %v", err)
		enrichCacheInstance = make(map[string]EnrichCacheEntry)
	}
}

// GetCachedEnrichment checks if an enrichment result exists for the given merchant text.
func GetCachedEnrichment(merchantText string) (EnrichCacheEntry, bool) {
	enrichCacheOnce.Do(initEnrichCache)

	hash := hashMerchantText(merchantText)

	enrichCacheMutex.RLock()
	defer enrichCacheMutex.RUnlock()

	entry, exists := enrichCacheInstance[hash]
	return entry, exists
}

// SaveBatchToEnrichmentCache persists a batch of enrichment results to the cache file.
func SaveBatchToEnrichmentCache(entries map[string]EnrichCacheEntry) {
	if len(entries) == 0 {
		return
	}

	enrichCacheOnce.Do(initEnrichCache)

	enrichCacheMutex.Lock()
	for merchantText, entry := range entries {
		hash := hashMerchantText(merchantText)
		enrichCacheInstance[hash] = entry
	}
	data, err := json.MarshalIndent(enrichCacheInstance, "", "  ")
	enrichCacheMutex.Unlock()

	if err != nil {
		log.Printf("Warning: failed to marshal enrichment cache: %v", err)
		return
	}

	if err := os.WriteFile(enrichCacheFilePath, data, 0644); err != nil {
		log.Printf("Warning: failed to write enrichment cache: %v", err)
	}
}

func hashMerchantText(text string) string {
	h := sha256.New()
	h.Write([]byte(text))
	return hex.EncodeToString(h.Sum(nil))
}
