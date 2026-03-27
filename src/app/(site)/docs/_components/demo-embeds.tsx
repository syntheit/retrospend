"use client"

import dynamic from "next/dynamic"
import { DemoContainer } from "./demo-container"

const LazyDashboard = dynamic(
	() => import("~/app/(site)/_components/landing/demo-dashboard-overview").then((m) => m.DemoDashboardOverview),
	{ ssr: false },
)

const LazyBudget = dynamic(
	() => import("~/app/(site)/_components/landing/demo-budget").then((m) => m.DemoBudget),
	{ ssr: false },
)

const LazyWealth = dynamic(
	() => import("./demo-wealth-docs").then((m) => m.DemoWealthDocs),
	{ ssr: false },
)

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

export function DashboardDemoEmbed() {
	return <DemoContainer title="Dashboard Overview"><LazyDashboard /></DemoContainer>
}

export function BudgetDemoEmbed() {
	return <DemoContainer title="Budget Overview"><LazyBudget /></DemoContainer>
}

export function WealthDemoEmbed() {
	return <DemoContainer title="Wealth Dashboard"><LazyWealth /></DemoContainer>
}

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
