"use client"

import dynamic from "next/dynamic"
import { DemoContainer } from "./demo-container"

const LazyBankImport = dynamic(
	() => import("./demo-bank-import").then((m) => m.DemoBankImport),
	{ ssr: false },
)

const LazySplitCalculator = dynamic(
	() => import("./demo-split-calculator").then((m) => m.DemoSplitCalculator),
	{ ssr: false },
)

const LazyCurrencyConverter = dynamic(
	() => import("./demo-currency-converter").then((m) => m.DemoCurrencyConverter),
	{ ssr: false },
)

const LazyCurrencyInput = dynamic(
	() => import("./demo-currency-input").then((m) => m.DemoCurrencyInput),
	{ ssr: false },
)

export function BankImportDemoEmbed() {
	return <DemoContainer title="Import Review"><LazyBankImport /></DemoContainer>
}

export function SplitCalculatorDemoEmbed() {
	return <DemoContainer title="Split Calculator"><LazySplitCalculator /></DemoContainer>
}

export function CurrencyConverterDemoEmbed() {
	return <DemoContainer title="Currency Converter"><LazyCurrencyConverter /></DemoContainer>
}

export function CurrencyInputDemoEmbed() {
	return <DemoContainer title="Currency Amount Input"><LazyCurrencyInput /></DemoContainer>
}
