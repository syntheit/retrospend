// Package money mirrors the rate convention in src/lib/money.ts: USD has rate
// 1, a fiat rate is units per 1 USD, a crypto rate is USD per 1 coin. Whether a
// currency is crypto is decided by its code, never by the rate type.
package money

// CryptoCurrencies mirrors the CRYPTO_CURRENCIES list in src/lib/currencies.ts.
var CryptoCurrencies = map[string]bool{
	"BTC":  true,
	"ETH":  true,
	"SOL":  true,
	"BNB":  true,
	"XRP":  true,
	"DOGE": true,
	"ADA":  true,
	"AVAX": true,
	"POL":  true,
	"LTC":  true,
	"DOT":  true,
	"LINK": true,
	"TON":  true,
	"UNI":  true,
	"NEAR": true,
	"SUI":  true,
	"USDC": true,
	"USDT": true,
	"DAI":  true,
}

// IsCrypto reports whether a currency code is a crypto currency.
func IsCrypto(currency string) bool {
	return CryptoCurrencies[currency]
}

// RateFromAmounts is the stored rate for `currency` when `amount` of it was
// worth `usd`: units per USD for fiat (amount / usd), USD per coin for crypto
// (usd / amount). Returns 0 when either side is not positive (unknown rate).
func RateFromAmounts(currency string, amount, usd float64) float64 {
	if currency == "USD" {
		return 1
	}
	if amount <= 0 || usd <= 0 {
		return 0
	}
	if IsCrypto(currency) {
		return usd / amount
	}
	return amount / usd
}
