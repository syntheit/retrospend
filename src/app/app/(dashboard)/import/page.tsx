"use client";

import { useState } from "react";
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
	const [activeTab, setActiveTab] = useState("expenses");

	return (
		<>
			<SiteHeader title="Import" />
			<PageContent>
				<div className="mx-auto w-full max-w-7xl">
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
							<Tabs
								className="w-full"
								onValueChange={setActiveTab}
								value={activeTab}
							>
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
								<TabsContent
									className="data-[state=inactive]:hidden"
									forceMount
									value="expenses"
								>
									<ExpensesImportTab isActive={activeTab === "expenses"} />
								</TabsContent>
								<TabsContent
									className="data-[state=inactive]:hidden"
									forceMount
									value="budgets"
								>
									<BudgetsImportTab isActive={activeTab === "budgets"} />
								</TabsContent>
								<TabsContent
									className="data-[state=inactive]:hidden"
									forceMount
									value="wealth"
								>
									<WealthImportTab isActive={activeTab === "wealth"} />
								</TabsContent>
							</Tabs>
						</CardContent>
					</Card>
				</div>
			</PageContent>
		</>
	);
}
