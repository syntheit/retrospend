"use client"

import { useState } from "react"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Checkbox } from "~/components/ui/checkbox"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table"
import { cn } from "~/lib/utils"

type DemoTransaction = {
	id: string
	date: string
	title: string
	amount: number
	category: string
	categoryColor: string
	isDuplicate: boolean
}

const DEMO_TRANSACTIONS: DemoTransaction[] = [
	{ id: "1", date: "Mar 7", title: "Whole Foods Market", amount: -84.32, category: "Groceries", categoryColor: "bg-green-500/15 text-green-700 dark:text-green-400", isDuplicate: false },
	{ id: "2", date: "Mar 6", title: "Netflix Subscription", amount: -15.99, category: "Entertainment", categoryColor: "bg-purple-500/15 text-purple-700 dark:text-purple-400", isDuplicate: true },
	{ id: "3", date: "Mar 5", title: "Shell Gas Station", amount: -52.10, category: "Transport", categoryColor: "bg-blue-500/15 text-blue-700 dark:text-blue-400", isDuplicate: false },
	{ id: "4", date: "Mar 4", title: "Uber Eats - Sushi Palace", amount: -38.50, category: "Dining Out", categoryColor: "bg-orange-500/15 text-orange-700 dark:text-orange-400", isDuplicate: false },
	{ id: "5", date: "Mar 3", title: "Amazon.com", amount: -129.99, category: "Shopping", categoryColor: "bg-pink-500/15 text-pink-700 dark:text-pink-400", isDuplicate: true },
	{ id: "6", date: "Mar 2", title: "Trader Joe's", amount: -61.28, category: "Groceries", categoryColor: "bg-green-500/15 text-green-700 dark:text-green-400", isDuplicate: false },
]

export function DemoBankImport() {
	const [selected, setSelected] = useState<Set<string>>(() => {
		const initial = new Set<string>()
		for (const t of DEMO_TRANSACTIONS) {
			if (!t.isDuplicate) initial.add(t.id)
		}
		return initial
	})

	const toggle = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	const toggleAll = () => {
		if (selected.size === DEMO_TRANSACTIONS.length) {
			setSelected(new Set())
		} else {
			setSelected(new Set(DEMO_TRANSACTIONS.map((t) => t.id)))
		}
	}

	const selectedCount = selected.size

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<p className="text-muted-foreground text-sm">
					<span className="font-medium text-foreground">{selectedCount}</span> of {DEMO_TRANSACTIONS.length} selected
				</p>
				<Button size="sm" disabled={selectedCount === 0}>
					Import Selected
				</Button>
			</div>
			<div className="overflow-x-auto rounded-lg border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-10">
								<Checkbox
									checked={selected.size === DEMO_TRANSACTIONS.length}
									onCheckedChange={toggleAll}
								/>
							</TableHead>
							<TableHead className="w-20">Date</TableHead>
							<TableHead>Title</TableHead>
							<TableHead className="w-24 text-right">Amount</TableHead>
							<TableHead className="w-28">Category</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{DEMO_TRANSACTIONS.map((t) => (
							<TableRow key={t.id} className={cn(t.isDuplicate && "opacity-50")}>
								<TableCell>
									<Checkbox
										checked={selected.has(t.id)}
										onCheckedChange={() => toggle(t.id)}
									/>
								</TableCell>
								<TableCell className="text-muted-foreground text-sm">{t.date}</TableCell>
								<TableCell>
									<div className="flex items-center gap-2">
										<span className="text-sm">{t.title}</span>
										{t.isDuplicate && (
											<Badge variant="secondary" className="text-[10px]">Duplicate</Badge>
										)}
									</div>
								</TableCell>
								<TableCell className="text-right font-mono text-sm">
									${Math.abs(t.amount).toFixed(2)}
								</TableCell>
								<TableCell>
									<span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", t.categoryColor)}>
										{t.category}
									</span>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	)
}
