"use client"

import { useMemo, useState } from "react"
import { Badge } from "~/components/ui/badge"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group"
import { cn } from "~/lib/utils"

type SplitMode = "equal" | "exact" | "percentage" | "shares"

const PARTICIPANTS = ["You", "Alex", "Jordan"]
const TOTAL = 120

export function DemoSplitCalculator() {
	const [mode, setMode] = useState<SplitMode>("equal")
	const [exactValues, setExactValues] = useState([60, 35, 25])
	const [percentValues, setPercentValues] = useState([50, 30, 20])
	const [shareValues, setShareValues] = useState([2, 1, 1])

	const breakdown = useMemo(() => {
		switch (mode) {
			case "equal":
				return PARTICIPANTS.map(() => Math.round((TOTAL / PARTICIPANTS.length) * 100) / 100)
			case "exact":
				return exactValues
			case "percentage":
				return percentValues.map((p) => Math.round((TOTAL * p) / 100 * 100) / 100)
			case "shares": {
				const totalShares = shareValues.reduce((a, b) => a + b, 0)
				if (totalShares === 0) return shareValues.map(() => 0)
				return shareValues.map((s) => Math.round((TOTAL * s) / totalShares * 100) / 100)
			}
		}
	}, [mode, exactValues, percentValues, shareValues])

	const total = breakdown.reduce((a, b) => a + b, 0)
	const isValid = mode === "equal" || mode === "shares" || Math.abs(total - TOTAL) < 0.02

	const updateValue = (index: number, value: number, setter: React.Dispatch<React.SetStateAction<number[]>>) => {
		setter((prev) => {
			const next = [...prev]
			next[index] = value
			return next
		})
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<p className="font-semibold text-sm">Dinner</p>
					<p className="text-muted-foreground text-sm">${TOTAL.toFixed(2)} total</p>
				</div>
				<Badge variant="secondary">{PARTICIPANTS.length} people</Badge>
			</div>

			<div>
				<Label className="mb-2 block text-xs text-muted-foreground">Split Mode</Label>
				<ToggleGroup
					type="single"
					value={mode}
					onValueChange={(v) => v && setMode(v as SplitMode)}
					className="justify-start"
				>
					<ToggleGroupItem value="equal" size="sm">Equal</ToggleGroupItem>
					<ToggleGroupItem value="exact" size="sm">Exact</ToggleGroupItem>
					<ToggleGroupItem value="percentage" size="sm">%</ToggleGroupItem>
					<ToggleGroupItem value="shares" size="sm">Shares</ToggleGroupItem>
				</ToggleGroup>
			</div>

			<div className="space-y-2">
				{PARTICIPANTS.map((name, i) => (
					<div key={name} className="flex items-center gap-3 rounded-lg border px-3 py-2">
						<span className="w-16 text-sm font-medium">{name}</span>
						<div className="flex-1">
							{mode === "equal" ? (
								<span className="text-muted-foreground text-sm">1/{PARTICIPANTS.length}</span>
							) : mode === "exact" ? (
								<Input
									type="number"
									value={exactValues[i]}
									onChange={(e) => updateValue(i, Number(e.target.value), setExactValues)}
									className="h-7 w-24 text-sm"
									step="0.01"
								/>
							) : mode === "percentage" ? (
								<div className="flex items-center gap-1">
									<Input
										type="number"
										value={percentValues[i]}
										onChange={(e) => updateValue(i, Number(e.target.value), setPercentValues)}
										className="h-7 w-20 text-sm"
										min={0}
										max={100}
									/>
									<span className="text-muted-foreground text-sm">%</span>
								</div>
							) : (
								<div className="flex items-center gap-1">
									<Input
										type="number"
										value={shareValues[i]}
										onChange={(e) => updateValue(i, Number(e.target.value), setShareValues)}
										className="h-7 w-20 text-sm"
										min={0}
									/>
									<span className="text-muted-foreground text-sm">shares</span>
								</div>
							)}
						</div>
						<span className="w-20 text-right font-mono text-sm">
							${breakdown[i]!.toFixed(2)}
						</span>
					</div>
				))}
			</div>

			<div className={cn(
				"flex items-center justify-between rounded-lg px-3 py-2 text-sm",
				isValid ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 text-red-700 dark:text-red-400",
			)}>
				<span>Total</span>
				<span className="font-mono font-medium">${total.toFixed(2)} / ${TOTAL.toFixed(2)}</span>
			</div>
		</div>
	)
}
