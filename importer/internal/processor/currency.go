package processor

import (
	"encoding/json"
	"log"
	"os"
	"strings"
)

// CurrencyData holds information about a specific currency.
type CurrencyData struct {
	Symbol        string  `json:"symbol"`
	Name          string  `json:"name"`
	SymbolNative  string  `json:"symbol_native"`
	DecimalDigits int     `json:"decimal_digits"`
	Rounding      float64 `json:"rounding"`
	Code          string  `json:"code"`
	NamePlural    string  `json:"name_plural"`
}

var nameToCodeMap map[string]string

func init() {
	nameToCodeMap = make(map[string]string)
	
	paths := []string{"currency.json", "../../currency.json", "../currency.json"}
	var data []byte
	var err error
	for _, p := range paths {
		data, err = os.ReadFile(p)
		if err == nil {
			break
		}
	}
	
	if err != nil {
		log.Printf("Warning: could not read currency.json: %v. Currency normalization will be limited.", err)
		return
	}

	var currencies map[string]CurrencyData
	if err := json.Unmarshal(data, &currencies); err != nil {
		log.Printf("Warning: could not parse currency.json: %v. Currency normalization will be limited.", err)
		return
	}

	for _, currency := range currencies {
		nameToCodeMap[strings.ToUpper(currency.Name)] = currency.Code
	}
}

// NormalizeCurrency maps a raw currency name (e.g., "Brazilian Real") to its ISO code (e.g., "BRL").
func NormalizeCurrency(rawCurrency string) string {
	cleaned := strings.ToUpper(strings.TrimSpace(rawCurrency))
	if isoCode, exists := nameToCodeMap[cleaned]; exists {
		return isoCode
	}
	return cleaned
}


