package llm

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"importer/internal/models"
	"log"
	"os"
	"path/filepath"
	"sync"
)

var cacheFilePath = getCacheFilePath()

func getCacheFilePath() string {
	if path := os.Getenv("SCHEMA_CACHE_PATH"); path != "" {
		return path
	}
	return "data/schema_cache.json"
}

var (
	cacheInstance map[string]models.CSVSchema
	cacheMutex    sync.RWMutex
	once          sync.Once
)

func initCache() {
	cacheMutex.Lock()
	defer cacheMutex.Unlock()

	cacheInstance = make(map[string]models.CSVSchema)

	// Ensure data directory exists
	err := os.MkdirAll(filepath.Dir(cacheFilePath), 0755)
	if err != nil {
		log.Printf("Warning: failed to create data directory for cache: %v", err)
		return
	}

	data, err := os.ReadFile(cacheFilePath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("Warning: failed to read schema cache: %v", err)
		}
		return
	}

	if err := json.Unmarshal(data, &cacheInstance); err != nil {
		log.Printf("Warning: failed to parse schema cache: %v", err)
		// Reset cache if malformed
		cacheInstance = make(map[string]models.CSVSchema)
	}
}

// GetCachedSchema checks if a schema exists for the given header string.
func GetCachedSchema(header string) (models.CSVSchema, bool) {
	once.Do(initCache)

	hash := hashHeader(header)

	cacheMutex.RLock()
	defer cacheMutex.RUnlock()

	schema, exists := cacheInstance[hash]
	return schema, exists
}

// SaveSchemaToCache persists a discovered schema to the local cache file.
func SaveSchemaToCache(header string, schema models.CSVSchema) {
	once.Do(initCache)

	hash := hashHeader(header)

	cacheMutex.Lock()
	cacheInstance[hash] = schema
	data, err := json.MarshalIndent(cacheInstance, "", "  ")
	cacheMutex.Unlock()

	if err != nil {
		log.Printf("Warning: failed to marshal schema cache: %v", err)
		return
	}

	if err := os.WriteFile(cacheFilePath, data, 0644); err != nil {
		log.Printf("Warning: failed to write schema cache: %v", err)
	}
}

func hashHeader(header string) string {
	h := sha256.New()
	h.Write([]byte(header))
	return hex.EncodeToString(h.Sum(nil))
}
