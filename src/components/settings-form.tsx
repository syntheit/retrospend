"use client";

import { Card, CardContent } from "~/components/ui/card";
import { useSession } from "~/hooks/use-session";
import { CategorySettings } from "./settings/category-settings";
import { GeneralSettings } from "./settings/general-settings";
import { WealthExportCard } from "./settings/wealth-export-card";

export function SettingsForm() {
	const { data: session, isPending: sessionLoading } = useSession();

	if (sessionLoading) {
		return (
			<Card className="mx-auto w-full max-w-4xl">
				<CardContent className="p-6">
					<div className="text-center">Loading...</div>
				</CardContent>
			</Card>
		);
	}

	if (!session?.user) {
		return (
			<Card className="mx-auto w-full max-w-4xl">
				<CardContent className="p-6">
					<div className="text-center">
						Please sign in to access your settings
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-6">
			<GeneralSettings />
			<CategorySettings />
			<WealthExportCard />
		</div>
	);
}
