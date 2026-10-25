"use client";

import { useTranslations } from "next-intl";
import { useRef } from "react";
import { BackButton } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { useIsMobile } from "~/hooks/use-mobile";
import { entryOf } from "~/lib/nav";
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
import { SECTIONS } from "./sections";
import { SecuritySection } from "./security/security-section";

/**
 * The Settings page (settings mockup, layout A): one page of flat
 * sections with a sticky section nav (a list beside them on desktop, scroll
 * tabs on phones). Every field saves on change with a quiet toast and Undo;
 * destructive actions confirm with a named button. An admin may delete their
 * own account while another admin remains; the Delete account sheet says so
 * when they are the only one.
 */
export function SettingsPage() {
	const t = useTranslations("settingsV2");
	const phone = useIsMobile();
	const scroller = useRef<HTMLDivElement>(null);
	const { current, go } = useSectionSpy(scroller, SECTIONS);
	const home = entryOf("home").href;

	return (
		<div
			className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pt-6 pb-12"
			data-page="settings-v2"
			ref={scroller}
		>
			{/* The page column (mockup .page): 1120 wide with the gutter inside, centered; nav and sections sit at its start. */}
			<div className="px-gutter mx-auto w-full max-w-280">
				<PageHeader
					lead={<BackButton href={home} label={t("back")} />}
					sub={t("autosaveNote")}
					title={t("title")}
				/>
				{phone && <SectionTabs current={current} ids={SECTIONS} onGo={go} />}
				<div className="md:flex md:items-start md:gap-12">
					{!phone && (
						<div className="sticky top-0 w-50 shrink-0">
							<SectionList current={current} ids={SECTIONS} onGo={go} />
						</div>
					)}
					<div className="max-w-160 min-w-0 flex-1">
						<ProfileSection />
						<PreferencesSection />
						<CategoriesSection />
						<PaymentSection />
						<NotificationsSection />
						<SecuritySection />
						<DeveloperSection />
						<DataSection />
						<DangerSection />
						<AboutFooter />
					</div>
				</div>
			</div>
		</div>
	);
}
