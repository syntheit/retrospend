"use client";

import { Github, Globe, Hash, Heart } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AppPreferencesContent } from "~/components/settings/app-preferences-card";
import { CategorySettings } from "~/components/settings/category-settings";
import { DeleteAccountDialog } from "~/components/settings/delete-account-dialog";
import { NotificationPreferencesCard } from "~/components/settings/notification-preferences-card";
import { PasswordForm } from "~/components/settings/password-form";
import { BackgroundCustomizationCard } from "~/components/settings/background-customization-card";
import { PaymentMethodsCard } from "~/components/settings/payment-methods-card";
import { ProfileSection } from "~/components/settings/profile-section";
import { SectionNav } from "~/components/settings/section-nav";
import { TwoFactorSettings } from "~/components/settings/two-factor-settings";
import { DataManagementCard } from "~/components/data-management/data-management-card";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { useSession } from "~/hooks/use-session";
import { env } from "~/env";
import { APP_VERSION } from "~/lib/version";

const SECTIONS = [
	{ id: "profile", label: "Profile" },
	{ id: "preferences", label: "Preferences" },
	{ id: "categories", label: "Categories" },
	{ id: "payment", label: "Payment" },
	{ id: "notifications", label: "Notifications" },
	{ id: "security", label: "Security" },
	{ id: "data", label: "Data" },
];

type ExtendedUser = NonNullable<
	ReturnType<typeof useSession>["data"]
>["user"] & {
	role: string;
};

export function SettingsForm() {
	const { data: session, isPending: sessionLoading } = useSession();
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);

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

	const user = session.user as ExtendedUser;
	const isAdmin = user.role === "ADMIN";

	return (
		<div className="space-y-6">
			<SectionNav sections={SECTIONS} />

			{/* Profile */}
			<section id="profile" className="scroll-mt-16">
				<ProfileSection />
			</section>

			{/* Preferences */}
			<section id="preferences" className="scroll-mt-16">
				<Card className="border-border/50 shadow-sm">
					<CardHeader>
						<CardTitle>Preferences</CardTitle>
						<CardDescription>
							Customize your visual and regional experience.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<AppPreferencesContent />
					</CardContent>
				</Card>
			</section>

			{/* Categories */}
			<section id="categories" className="scroll-mt-16">
				<CategorySettings />
			</section>

			{/* Profile Background */}
			<BackgroundCustomizationCard />

			{/* Payment Methods */}
			<section id="payment" className="scroll-mt-16">
				<PaymentMethodsCard />
			</section>

			{/* Notifications */}
			<section id="notifications" className="scroll-mt-16">
				<NotificationPreferencesCard />
			</section>

			{/* Security */}
			<section id="security" className="scroll-mt-16">
				<div className="space-y-6">
					<PasswordForm />
					<TwoFactorSettings />
				</div>
			</section>

			{/* Data */}
			<section id="data" className="scroll-mt-16">
				<DataManagementCard />
			</section>

			{/* Danger Zone */}
			{!isAdmin && (
				<div className="flex flex-col items-center justify-between gap-4 border-border/20 border-t pt-8 md:flex-row">
					<p className="text-muted-foreground text-sm">Want to leave?</p>
					<Button
						className="h-9 font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
						onClick={() => setShowDeleteDialog(true)}
						variant="ghost"
					>
						Delete Account
					</Button>
				</div>
			)}

			<DeleteAccountDialog
				onOpenChange={setShowDeleteDialog}
				open={showDeleteDialog}
			/>

			{/* About Card */}
			<Card>
				<CardContent className="py-4">
					<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h2 className="font-bold text-2xl tracking-tight">
								Retrospend
							</h2>
							<p className="text-muted-foreground">
								The Financial Multitool
							</p>
							<div className="mt-3 flex gap-3">
								<a
									className="-m-2 p-2 text-primary transition-colors hover:text-primary/80"
									href="https://retrospend.app"
									rel="noopener noreferrer"
									target="_blank"
									title="Visit Retrospend website"
								>
									<Globe className="h-5 w-5" />
								</a>
								<a
									className="-m-2 p-2 text-primary transition-colors hover:text-primary/80"
									href="https://github.com/syntheit/retrospend"
									rel="noopener noreferrer"
									target="_blank"
									title="View on GitHub"
								>
									<Github className="h-5 w-5" />
								</a>
								<a
									className="-m-2 p-2 text-primary transition-colors hover:text-primary/80"
									href="https://matrix.to/#/#retrospend:matrix.org"
									rel="noopener noreferrer"
									target="_blank"
									title="Join the Matrix room"
								>
									<Hash className="h-5 w-5" />
								</a>
								<a
									className="-m-2 p-2 text-primary transition-colors hover:text-primary/80"
									href="https://retrospend.app/u/daniel?donate"
									rel="noopener noreferrer"
									target="_blank"
									title="Support Retrospend"
								>
									<Heart className="h-5 w-5" />
								</a>
							</div>
						</div>
						<div className="space-y-1 sm:text-right">
							<p className="text-muted-foreground text-sm">
								Version {APP_VERSION} •{" "}
								<a
									className="text-primary hover:underline"
									href="https://www.gnu.org/licenses/gpl-3.0.en.html"
									rel="noopener noreferrer"
									target="_blank"
								>
									GPL v3
								</a>
							</p>
							<p className="text-muted-foreground text-sm">
								Made by{" "}
								<a
									className="text-primary hover:underline"
									href="https://matv.io"
									rel="noopener noreferrer"
									target="_blank"
								>
									Daniel Miller
								</a>
							</p>
							{env.NEXT_PUBLIC_ENABLE_LEGAL_PAGES === "true" && (
								<p className="pt-2 text-muted-foreground text-sm">
									<Link
										className="text-primary hover:underline"
										href="/settings/terms"
									>
										Terms
									</Link>
									{" • "}
									<Link
										className="text-primary hover:underline"
										href="/settings/privacy"
									>
										Privacy
									</Link>
								</p>
							)}
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
