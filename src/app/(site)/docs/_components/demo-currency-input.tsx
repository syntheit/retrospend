"use client"

import { Pencil } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { CurrencyFlag } from "~/components/ui/currency-flag"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select"
import { cn } from "~/lib/utils"

/*
 * Hardcoded exchange rate data - mirrors what useExchangeRates returns from the API.
 * Fiat rates = units per USD. Crypto rates = USD per unit.
 */
type RateOption = { type: string; rate: number; label: string }

const RATE_DATA: Record<string, RateOption[]> = {
	EUR: [{ type: "official", rate: 0.92, label: "Official" }],
	GBP: [{ type: "official", rate: 0.79, label: "Official" }],
	JPY: [{ type: "official", rate: 149.5, label: "Official" }],
	BRL: [{ type: "official", rate: 5.25, label: "Official" }],
	ARS: [
		{ type: "official", rate: 1070, label: "Official" },
		{ type: "blue", rate: 1415, label: "Blue" },
		{ type: "mep", rate: 1380, label: "MEP" },
	],
	BTC: [{ type: "crypto", rate: 97500, label: "Crypto" }],
	ETH: [{ type: "crypto", rate: 3450, label: "Crypto" }],
}

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "BRL", "ARS", "BTC", "ETH"]
const CRYPTO_SET = new Set(["BTC", "ETH"])
const HOME_CURRENCY = "USD"

const RATE_TYPE_LABELS: Record<string, string> = {
	official: "Official",
	blue: "Blue",
	mep: "MEP",
	crypto: "Crypto",
	custom: "Custom",
}

export function DemoCurrencyInput() {
	const [currency, setCurrency] = useState("ARS")
	const [amount, setAmount] = useState(50000)
	const [selectedRateType, setSelectedRateType] = useState("blue")
	const [customRate, setCustomRate] = useState("")
	const [showCustomInput, setShowCustomInput] = useState(false)

	const isCrypto = CRYPTO_SET.has(currency)
	const isForeign = currency !== HOME_CURRENCY
	const rateOptions = RATE_DATA[currency] ?? []

	// Mode: 1 = same currency, 2 = foreign single rate, 3 = foreign multi rate
	const mode = !isForeign ? 1 : rateOptions.length <= 1 ? 2 : 3

	// Active exchange rate
	const activeRate = useMemo(() => {
		if (!isForeign) return 1
		if (selectedRateType === "custom") {
			const v = parseFloat(customRate)
			return Number.isNaN(v) ? 0 : v
		}
		const match = rateOptions.find((r) => r.type === selectedRateType)
		return match?.rate ?? rateOptions[0]?.rate ?? 0
	}, [isForeign, selectedRateType, customRate, rateOptions])

	// Converted amount in home currency
	const convertedAmount = useMemo(() => {
		if (!amount || !activeRate) return 0
		if (!isForeign) return amount
		if (isCrypto) return amount * activeRate
		return amount / activeRate
	}, [amount, activeRate, isForeign, isCrypto])

	const formatRate = (rate: number) =>
		rate.toLocaleString(undefined, {
			minimumFractionDigits: isCrypto ? 2 : 0,
			maximumFractionDigits: isCrypto ? 2 : 6,
		})

	const formatAmount = (v: number) =>
		v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

	// Auto-select best rate on currency change
	const handleCurrencyChange = useCallback((c: string) => {
		setCurrency(c)
		setShowCustomInput(false)
		setCustomRate("")
		const rates = RATE_DATA[c] ?? []
		const blue = rates.find((r) => r.type === "blue")
		setSelectedRateType(blue ? "blue" : rates[0]?.type ?? "official")
	}, [])

	const handleRateSelect = useCallback((type: string) => {
		setSelectedRateType(type)
		if (type === "custom") {
			setShowCustomInput(true)
		} else {
			setShowCustomInput(false)
		}
	}, [])

	const getPreview = (dbRate: number) => {
		if (!amount || !dbRate) return 0
		return isCrypto ? amount * dbRate : amount / dbRate
	}

	return (
		<div className="mx-auto max-w-sm space-y-2">
			<Label>Amount</Label>

			{mode === 1 ? (
				/* === MODE 1: Same currency === */
				<div className="flex h-9 w-full overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
					<CurrencySelect value={currency} onChange={handleCurrencyChange} />
					<Input
						className="h-full w-full border-0 bg-transparent px-3 py-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
						placeholder="0.00"
						step="0.01"
						type="number"
						value={amount || ""}
						onChange={(e) => setAmount(Number(e.target.value))}
					/>
				</div>
			) : (
				/* === MODE 2 & 3: Foreign currency === */
				<div className="w-full overflow-hidden rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
					{/* Top row: currency + amount */}
					<div className="flex h-9 items-center">
						<CurrencySelect value={currency} onChange={handleCurrencyChange} />
						<Input
							className="h-full w-full border-0 bg-transparent px-3 py-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
							placeholder="0.00"
							step="0.01"
							type="number"
							value={amount || ""}
							onChange={(e) => setAmount(Number(e.target.value))}
						/>
						<span className="hidden shrink-0 pr-3 text-muted-foreground text-sm sm:block">
							You spent
						</span>
					</div>

					{/* Rate strip */}
					<div className="border-t border-input">
						{mode === 2 ? (
							/* Single rate pill */
							<div className="flex items-center justify-center px-3 py-1.5">
								{rateOptions.length === 0 ? (
									<span className="text-muted-foreground text-sm">No rate available</span>
								) : (
									<span className="rounded-full bg-muted/60 px-2.5 py-0.5 text-sm tabular-nums text-muted-foreground">
										{isCrypto && `1 ${currency} = `}
										{formatRate(rateOptions[0]!.rate)}
										{!isCrypto && ` ${currency}/${HOME_CURRENCY}`}
										{isCrypto && ` ${HOME_CURRENCY}`}
									</span>
								)}
							</div>
						) : (
							/* Mode 3: segmented rate toggle strip */
							<div className="flex overflow-x-auto">
								{rateOptions.map((option, i) => {
									const isSelected = selectedRateType === option.type
									const preview = getPreview(option.rate)
									return (
										<button
											key={option.type}
											type="button"
											onClick={() => handleRateSelect(option.type)}
											className={cn(
												"flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-0.5 px-2 py-1.5 transition-colors",
												i < rateOptions.length - 1 && "border-r border-input",
												isSelected
													? "bg-primary/10 text-primary"
													: "text-muted-foreground hover:bg-muted/60",
											)}
										>
											<span className="text-xs font-medium leading-tight">
												{RATE_TYPE_LABELS[option.type] ?? option.type}
											</span>
											<span className="text-sm tabular-nums leading-tight">
												{formatRate(option.rate)}
											</span>
											{preview > 0 && (
												<span className="text-xs tabular-nums text-muted-foreground leading-tight">
													{"\u2248"} ${formatAmount(preview)}
												</span>
											)}
										</button>
									)
								})}
								{/* Custom segment */}
								<button
									type="button"
									onClick={() => handleRateSelect("custom")}
									className={cn(
										"flex min-w-0 flex-shrink-0 cursor-pointer flex-col items-center gap-0.5 px-2 py-1.5 transition-colors",
										selectedRateType === "custom"
											? "bg-primary/10 text-primary"
											: "text-muted-foreground hover:bg-muted/60",
									)}
								>
									<span className="text-xs font-medium leading-tight">Custom</span>
									<span className="flex items-center gap-0.5 text-sm tabular-nums leading-tight">
										<Pencil className="h-3 w-3" />
										{showCustomInput ? "..." : "Set"}
									</span>
								</button>
							</div>
						)}
					</div>

					{/* Custom rate input */}
					{showCustomInput && mode === 3 && (
						<div className="flex items-center gap-2 border-t border-input bg-muted/10 px-3 py-1.5">
							<span className="shrink-0 text-muted-foreground text-sm">Custom rate:</span>
							<Input
								autoFocus
								className="h-7 w-28 border-input bg-transparent px-2 py-0 text-sm tabular-nums shadow-none focus-visible:ring-1 dark:bg-transparent"
								onChange={(e) => setCustomRate(e.target.value)}
								placeholder="Enter rate"
								step="0.00000001"
								type="number"
								value={customRate}
							/>
						</div>
					)}

					{/* Bottom row: home currency + converted */}
					<div className="flex h-9 items-center border-t border-input bg-muted/20">
						<div className="flex shrink-0 items-center gap-1.5 border-r border-input px-3">
							<CurrencyFlag className="h-4 w-4" currencyCode={HOME_CURRENCY} />
							<span className="text-muted-foreground text-sm font-medium">{HOME_CURRENCY}</span>
						</div>
						<div className="flex flex-1 items-center px-3">
							<span className={cn(
								"tabular-nums text-sm",
								convertedAmount > 0 ? "text-foreground" : "text-muted-foreground",
							)}>
								${formatAmount(convertedAmount)}
							</span>
						</div>
						<span className="hidden shrink-0 pr-3 text-muted-foreground text-sm sm:block">
							In budget as
						</span>
					</div>
				</div>
			)}

			<p className="text-center text-muted-foreground text-xs">
				Try switching currencies. ARS shows multiple rate options.
			</p>
		</div>
	)
}

function CurrencySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
	return (
		<div className="flex shrink-0 items-center border-r border-input">
			<Select value={value} onValueChange={onChange}>
				<SelectTrigger className="h-full gap-1.5 rounded-none border-0 px-3 shadow-none focus:ring-0">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{CURRENCIES.map((c) => (
						<SelectItem key={c} value={c}>
							<div className="flex items-center gap-2">
								<CurrencyFlag className="h-4 w-4" currencyCode={c} />
								{c}
							</div>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	)
}
