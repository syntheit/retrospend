"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { BudgetsImporterTab } from "~/components/data-management/budgets-importer-tab";
import { ExpensesImporterTab } from "~/components/data-management/expenses-importer-tab";
import { WealthImporterTab } from "~/components/data-management/wealth-importer-tab";
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
	const t = useTranslations("import");
	const [activeTab, setActiveTab] = useState("expenses");

	return (
		<>
			<SiteHeader title={t("title")} />
			<PageContent>
				<div className="mx-auto w-full max-w-7xl">
					<Card className="border-muted/50 shadow-lg">
						<CardHeader className="pb-3">
							<CardTitle className="font-bold text-2xl tracking-tight">
								{t("importData")}
							</CardTitle>
							<CardDescription>
								{t("importDescription")}
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
										{t("expenses")}
									</TabsTrigger>
									<TabsTrigger className="text-xs sm:text-sm" value="budgets">
										{t("budgets")}
									</TabsTrigger>
									<TabsTrigger className="text-xs sm:text-sm" value="wealth">
										{t("wealth")}
									</TabsTrigger>
								</TabsList>
								<TabsContent
									className="data-[state=inactive]:hidden"
									forceMount
									value="expenses"
								>
									<ExpensesImporterTab isActive={activeTab === "expenses"} />
								</TabsContent>
								<TabsContent
									className="data-[state=inactive]:hidden"
									forceMount
									value="budgets"
								>
									<BudgetsImporterTab isActive={activeTab === "budgets"} />
								</TabsContent>
								<TabsContent
									className="data-[state=inactive]:hidden"
									forceMount
									value="wealth"
								>
									<WealthImporterTab isActive={activeTab === "wealth"} />
								</TabsContent>
							</Tabs>
						</CardContent>
					</Card>
				</div>
			</PageContent>
		</>
	);
}
