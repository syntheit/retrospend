"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useRef } from "react";
import { PageHeader } from "~/components/layout/page-header";
import { Button } from "~/components/ui/button";
import { Tip } from "~/components/ui/tooltip";
import { useIsMobile } from "~/hooks/use-mobile";
import { useSession } from "~/hooks/use-session";
import { entryOf, hrefOf } from "~/lib/nav";
import { AboutFooter } from "./about-footer";
import { CategoriesSection } from "./categories/categories-section";
import { DangerSection } from "./danger/danger-section";
import { DataSection } from "./data/data-section";
import { DeveloperSection } from "./developer/developer-section";
import { NotificationsSection } from "./notifications/notifications-section";
import { PaymentSection } from "./payment/payment-section";
import { PreferencesSection } from "./preferences/preferences-section";
import { ProfileSection } from "./profile/profile-section";
import { SectionList, SectionTabs, useSectionSpy } from "./section-nav";
import { SECTIONS, type SectionId } from "./sections";
import { SecuritySection } from "./security/security-section";

/**
 * The redesigned Settings page (settings mockup, layout A): one page of flat
 * sections with a sticky section nav (a list beside them on desktop, scroll
 * tabs on phones). Every field saves on change with a quiet toast and Undo;
 * destructive actions confirm with a named button. Admins have no Danger
 * zone: they cannot delete their own account here.
 */
export function SettingsPage() {
	const t = useTranslations("settingsV2");
	const phone = useIsMobile();
	const scroller = useRef<HTMLDivElement>(null);
	const { data: session } = useSession();
	const isAdmin =
		(session?.user as { role?: string } | undefined)?.role === "ADMIN";
	const ids = useMemo<SectionId[]>(
		() => SECTIONS.filter((s) => s !== "danger" || !isAdmin),
		[isAdmin],
	);
	const { current, go } = useSectionSpy(scroller, ids);
	const home = hrefOf(entryOf("home")) ?? "/dashboard";

	return (
		<div
			className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 pt-4 pb-12 md:px-8 lg:px-12"
			data-page="settings-v2"
			ref={scroller}
		>
			<div className="w-full max-w-222">
				<PageHeader
					lead={
						phone ? (
							<Tip content={t("back")}>
								<Button aria-label={t("back")} asChild icon kind="ghost">
									<Link href={home}>
										<ChevronLeft />
									</Link>
								</Button>
							</Tip>
						) : undefined
					}
					sub={t("autosaveNote")}
					title={t("title")}
				/>
				{phone && <SectionTabs current={current} ids={ids} onGo={go} />}
				<div className="md:flex md:items-start md:gap-12">
					{!phone && (
						<div className="sticky top-0 w-50 shrink-0">
							<SectionList current={current} ids={ids} onGo={go} />
						</div>
					)}
					<div className="min-w-0 max-w-160 flex-1">
						<ProfileSection />
						<PreferencesSection />
						<CategoriesSection />
						<PaymentSection />
						<NotificationsSection />
						<SecuritySection />
						<DeveloperSection />
						<DataSection />
						{!isAdmin && <DangerSection />}
						<AboutFooter />
					</div>
				</div>
			</div>
		</div>
	);
}
