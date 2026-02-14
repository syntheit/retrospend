"use client";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { BudgetsTab } from "./budgets-tab";
import { ExpensesTab } from "./expenses-tab";
import { WealthTab } from "./wealth-tab";

export function DataManagementCard() {
	return (
		<Card className="border-muted/50 shadow-lg">
			<CardHeader className="pb-3">
				<CardTitle className="font-bold text-2xl tracking-tight">
					Data Management
				</CardTitle>
				<CardDescription>
					Import and export your financial data across different modules.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Tabs className="w-full" defaultValue="expenses">
					<TabsList className="mb-2 grid w-full grid-cols-3">
						<TabsTrigger className="text-xs sm:text-sm" value="expenses">
							Expenses
						</TabsTrigger>
						<TabsTrigger className="text-xs sm:text-sm" value="budgets">
							Budgets
						</TabsTrigger>
						<TabsTrigger className="text-xs sm:text-sm" value="wealth">
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
