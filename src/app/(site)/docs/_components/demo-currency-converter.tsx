"use client"

import { ArrowUpDown } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { Button } from "~/components/ui/button"
import { Card, CardContent } from "~/components/ui/card"
import { CurrencyFlag } from "~/components/ui/currency-flag"
import { Input } from "~/components/ui/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { isCrypto } from "~/lib/currency-format"
import { convert } from "~/lib/currency-math"
import { getRateTypeLabel } from "~/lib/exchange-rates-shared"
import { cn } from "~/lib/utils"

// Fiat rates = units per USD, Crypto rates = USD per unit
// ARS has multiple rate types to demo the rate strip
const RATE_DATA: Record<string, { label: string; rates: { type: string; rate: number }[] }> = {
	USD: { label: "US Dollar", rates: [{ type: "official", rate: 1 }] },
	EUR: { label: "Euro", rates: [{ type: "official", rate: 0.92 }] },
	GBP: { label: "British Pound", rates: [{ type: "official", rate: 0.79 }] },
	JPY: { label: "Japanese Yen", rates: [{ type: "official", rate: 149.5 }] },
	ARS: {
		label: "Argentine Peso",
		rates: [
			{ type: "blue", rate: 1415 },
			{ type: "official", rate: 1065 },
			{ type: "mep", rate: 1380 },
			{ type: "crypto", rate: 1400 },
		],
	},
	BRL: { label: "Brazilian Real", rates: [{ type: "official", rate: 5.25 }] },
	BTC: { label: "Bitcoin", rates: [{ type: "official", rate: 97500 }] },
	ETH: { label: "Ethereum", rates: [{ type: "official", rate: 3450 }] },
}

const CURRENCIES = Object.keys(RATE_DATA)

function getDefaultRate(currency: string): number {
	const data = RATE_DATA[currency]
	if (!data) return 1
	const blue = data.rates.find((r) => r.type === "blue")
	if (blue) return blue.rate
	return data.rates[0]?.rate ?? 1
}

function getRateByType(currency: string, type: string): number | undefined {
	return RATE_DATA[currency]?.rates.find((r) => r.type === type)?.rate
}

function formatResult(value: number, currency: string): string {
	if (isCrypto(currency)) {
		return value.toFixed(8).replace(/\.?0+$/, "")
	}
	return value.toFixed(2)
}

export function DemoCurrencyConverter() {
	const [topCurrency, setTopCurrency] = useState("USD")
	const [bottomCurrency, setBottomCurrency] = useState("ARS")
	const [topAmount, setTopAmount] = useState("100")
	const [bottomAmount, setBottomAmount] = useState("")
	const [lastEdited, setLastEdited] = useState<"top" | "bottom">("top")
	const [selectedRateType, setSelectedRateType] = useState<string | null>("blue")

	// Determine which side shows the rate strip
	const topRates = RATE_DATA[topCurrency]?.rates ?? []
	const bottomRates = RATE_DATA[bottomCurrency]?.rates ?? []
	const stripCurrency = bottomRates.length > 1 ? "bottom" : topRates.length > 1 ? "top" : null
	const stripRateOptions = stripCurrency === "bottom" ? bottomRates : stripCurrency === "top" ? topRates : []

	const getActiveRate = useCallback(
		(currency: string, side: "top" | "bottom"): number => {
			if (currency === "USD") return 1
			if (stripCurrency === side && selectedRateType) {
				const r = getRateByType(currency, selectedRateType)
				if (r) return r
			}
			return getDefaultRate(currency)
		},
		[stripCurrency, selectedRateType],
	)

	const recompute = useCallback(
		(direction: "top" | "bottom", tAmt: string, bAmt: string) => {
			const topRate = getActiveRate(topCurrency, "top")
			const bottomRate = getActiveRate(bottomCurrency, "bottom")

			if (direction === "top") {
				const parsed = parseFloat(tAmt)
				if (!tAmt || isNaN(parsed)) { setBottomAmount(""); return }
				const result = convert(parsed, topCurrency, topRate, bottomCurrency, bottomRate)
				setBottomAmount(result ? formatResult(result, bottomCurrency) : "")
			} else {
				const parsed = parseFloat(bAmt)
				if (!bAmt || isNaN(parsed)) { setTopAmount(""); return }
				const result = convert(parsed, bottomCurrency, bottomRate, topCurrency, topRate)
				setTopAmount(result ? formatResult(result, topCurrency) : "")
			}
		},
		[topCurrency, bottomCurrency, getActiveRate],
	)

	// Initial computation
	useMemo(() => {
		if (lastEdited === "top" && topAmount) {
			const topRate = getActiveRate(topCurrency, "top")
			const bottomRate = getActiveRate(bottomCurrency, "bottom")
			const parsed = parseFloat(topAmount)
			if (!isNaN(parsed)) {
				const result = convert(parsed, topCurrency, topRate, bottomCurrency, bottomRate)
				setBottomAmount(result ? formatResult(result, bottomCurrency) : "")
			}
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedRateType, topCurrency, bottomCurrency])

	const displayRate = useMemo(() => {
		const topRate = getActiveRate(topCurrency, "top")
		const bottomRate = getActiveRate(bottomCurrency, "bottom")
		return convert(1, topCurrency, topRate, bottomCurrency, bottomRate) || null
	}, [topCurrency, bottomCurrency, getActiveRate])

	const handleTopAmountChange = (value: string) => {
		setTopAmount(value)
		setLastEdited("top")
		recompute("top", value, bottomAmount)
	}

	const handleBottomAmountChange = (value: string) => {
		setBottomAmount(value)
		setLastEdited("bottom")
		recompute("bottom", topAmount, value)
	}

	const handleRateTypeChange = (type: string) => {
		setSelectedRateType(type)
	}

	const swap = () => {
		setTopCurrency(bottomCurrency)
		setBottomCurrency(topCurrency)
		setTopAmount(bottomAmount)
		setBottomAmount(topAmount)
		setLastEdited((prev) => (prev === "top" ? "bottom" : "top"))
	}

	return (
		<Card>
			<CardContent className="space-y-0 p-4">
				{/* Top row */}
				<div className="flex items-center gap-3">
					<CurrencySelect onChange={setTopCurrency} value={topCurrency} />
					<Input
						className="flex-1 text-right tabular-nums text-lg"
						inputMode="decimal"
						onChange={(e) => handleTopAmountChange(e.target.value)}
						placeholder="0.00"
						type="text"
						value={topAmount}
					/>
				</div>

				{/* Divider with rate strip or pill + swap */}
				<div className="relative flex items-center py-3">
					<div className="flex-1">
						{stripRateOptions.length > 1 ? (
							<div className="flex items-center justify-center gap-1">
								{stripRateOptions.map((option) => {
									const isSelected = selectedRateType === option.type
									return (
										<button
											className={cn(
												"rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
												isSelected
													? "bg-primary text-primary-foreground"
													: "bg-muted/60 text-muted-foreground hover:bg-muted",
											)}
											key={option.type}
											onClick={() => handleRateTypeChange(option.type)}
											type="button"
										>
											{getRateTypeLabel(option.type)}
										</button>
									)
								})}
							</div>
						) : displayRate ? (
							<div className="flex justify-center">
								<span className="rounded-full bg-muted/60 px-3 py-1 text-muted-foreground text-sm tabular-nums">
									1 {topCurrency} ={" "}
									{displayRate.toLocaleString(undefined, {
										minimumFractionDigits: 2,
										maximumFractionDigits: 6,
									})}{" "}
									{bottomCurrency}
								</span>
							</div>
						) : (
							<div className="border-t border-border" />
						)}
					</div>
					<Button
						className="absolute right-0 h-8 w-8 rounded-full"
						onClick={swap}
						size="icon"
						variant="outline"
					>
						<ArrowUpDown className="h-4 w-4" />
					</Button>
				</div>

				{/* Bottom row */}
				<div className="flex items-center gap-3">
					<CurrencySelect onChange={setBottomCurrency} value={bottomCurrency} />
					<Input
						className="flex-1 text-right tabular-nums text-lg"
						inputMode="decimal"
						onChange={(e) => handleBottomAmountChange(e.target.value)}
						placeholder="0.00"
						type="text"
						value={bottomAmount}
					/>
				</div>
			</CardContent>
		</Card>
	)
}

function CurrencySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
	return (
		<Select value={value} onValueChange={onChange}>
			<SelectTrigger className="w-28 shrink-0 gap-1.5">
				<div className="flex items-center gap-1.5">
					<CurrencyFlag className="h-4 w-4" currencyCode={value} />
					<span className="font-medium text-sm">{value}</span>
				</div>
			</SelectTrigger>
			<SelectContent position="popper">
				{CURRENCIES.map((c) => (
					<SelectItem key={c} value={c}>
						<div className="flex items-center gap-2">
							<CurrencyFlag className="h-4 w-4" currencyCode={c} />
							<span>{c}</span>
							<span className="text-muted-foreground text-xs">{RATE_DATA[c]?.label}</span>
						</div>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}
