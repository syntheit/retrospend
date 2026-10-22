"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { env } from "~/env";
import { APP_VERSION } from "~/lib/version";

const LINK =
	"rounded-ctl text-fg-3 focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 can-hover:hover:text-fg can-hover:hover:underline";

/** About, as a quiet footer with labeled links (today's About card). */
export function AboutFooter() {
	const t = useTranslations("settingsV2.about");
	const external = [
		["website", "https://retrospend.app"],
		["github", "https://github.com/syntheit/retrospend"],
		["matrix", "https://matrix.to/#/#retrospend:matrix.org"],
		["donate", "https://retrospend.app/u/daniel?donate"],
	] as const;
	return (
		<footer className="mt-12 flex flex-wrap gap-x-4 gap-y-1 border-line border-t pt-4 text-fg-3 text-small">
			<span>{t("version", { version: APP_VERSION })}</span>
			<a
				className={LINK}
				href="https://www.gnu.org/licenses/gpl-3.0.en.html"
				rel="noopener noreferrer"
				target="_blank"
			>
				{t("license")}
			</a>
			{env.NEXT_PUBLIC_ENABLE_LEGAL_PAGES === "true" && (
				<>
					<Link className={LINK} href="/settings/privacy">
						{t("privacy")}
					</Link>
					<Link className={LINK} href="/settings/terms">
						{t("terms")}
					</Link>
				</>
			)}
			{external.map(([key, href]) => (
				<a
					className={LINK}
					href={href}
					key={key}
					rel="noopener noreferrer"
					target="_blank"
				>
					{t(key)}
				</a>
			))}
			<span>
				{t.rich("madeBy", {
					name: (chunks) => (
						<a
							className={LINK}
							href="https://matv.io"
							rel="noopener noreferrer"
							target="_blank"
						>
							{chunks}
						</a>
					),
				})}
			</span>
		</footer>
	);
}
