"use client";

import { BudgetsImportTab } from "~/components/data-management/budgets-import-tab";
import { ExpensesImportTab } from "~/components/data-management/expenses-import-tab";
import { WealthImportTab } from "~/components/data-management/wealth-import-tab";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";

export default function Page() {
	return (
		<>
			<SiteHeader title="Import" />
			<PageContent>
				<div className="mx-auto w-full max-w-4xl">
					<Card className="border-muted/50 shadow-lg">
						<CardHeader className="pb-3">
							<CardTitle className="font-bold text-2xl tracking-tight">
								Import Data
							</CardTitle>
							<CardDescription>
								Upload CSV files to import your financial data.
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
									<ExpensesImportTab />
								</TabsContent>
								<TabsContent value="budgets">
									<BudgetsImportTab />
								</TabsContent>
								<TabsContent value="wealth">
									<WealthImportTab />
								</TabsContent>
							</Tabs>
						</CardContent>
					</Card>
				</div>
			</PageContent>
		</>
	);
}
