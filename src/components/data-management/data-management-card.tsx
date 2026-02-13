"use client";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { ExpensesTab } from "./expenses-tab";
import { BudgetsTab } from "./budgets-tab";
import { WealthTab } from "./wealth-tab";

export function DataManagementCard() {
	return (
		<Card className="border-muted/50 shadow-lg">
			<CardHeader className="pb-3">
				<CardTitle className="text-2xl font-bold tracking-tight">
					Data Management
				</CardTitle>
				<CardDescription>
					Import and export your financial data across different modules.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Tabs defaultValue="expenses" className="w-full">
					<TabsList className="mb-2 grid w-full grid-cols-3">
						<TabsTrigger value="expenses" className="text-xs sm:text-sm">
							Expenses
						</TabsTrigger>
						<TabsTrigger value="budgets" className="text-xs sm:text-sm">
							Budgets
						</TabsTrigger>
						<TabsTrigger value="wealth" className="text-xs sm:text-sm">
							Wealth
						</TabsTrigger>
					</TabsList>
					<TabsContent value="expenses">
						<ExpensesTab />
					</TabsContent>
					<TabsContent value="budgets">
						<BudgetsTab />
					</TabsContent>
					<TabsContent value="wealth">
						<WealthTab />
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>
	);
}
