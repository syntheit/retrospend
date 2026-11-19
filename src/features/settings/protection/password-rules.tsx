"use client";

import { PASSWORD_CHECKS, passwordChecks } from "@retrospend/api-contract";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "~/lib/cn";

/** The new password's rules as checks that light up while typing (words from the change password sheet). */
export function PasswordRules({ value }: { value: string }) {
	const t = useTranslations("settingsV2.password");
	const checks = passwordChecks(value);
	return (
		<ul aria-label={t("rules")} className="text-meta flex flex-col gap-1">
			{PASSWORD_CHECKS.map((c) => (
				<li
					className={cn(
						"flex items-center gap-2",
						checks[c] ? "text-positive" : "text-fg-3",
					)}
					key={c}
				>
					<Check
						aria-hidden="true"
						className={cn("size-3.5", !checks[c] && "invisible")}
					/>
					{t(`check.${c}`)}
					<span className="sr-only">{checks[c] ? t("met") : t("notMet")}</span>
				</li>
			))}
		</ul>
	);
}
