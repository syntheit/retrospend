"use client";

import { AppPreferencesCard } from "~/components/settings/app-preferences-card";
import { CategorySettings } from "~/components/settings/category-settings";
import { InteractionCard } from "~/components/settings/interaction-card";
import { Card, CardContent } from "~/components/ui/card";
import { useSession } from "~/hooks/use-session";

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
		<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
			{/* Left Column: App Preferences */}
			<div className="space-y-6">
				<AppPreferencesCard />
			</div>

			{/* Right Column: Interaction & Categories */}
			<div className="space-y-6">
				<InteractionCard />
				<CategorySettings />
			</div>
		</div>
	);
}
