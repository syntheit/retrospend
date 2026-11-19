"use client";

import { type FailureCode, isFinalFailure } from "@retrospend/crypto/client";
import { useTranslations } from "next-intl";
import { Notice } from "~/components/ui/notice";

/**
 * What went wrong on this step. A try-again failure is one line under the
 * fields; a final one (nothing left to try) is the page's one Notice.
 */
export function StepError({ code }: { code: FailureCode | null }) {
	const t = useTranslations("protection.errors");
	if (!code) return null;
	if (isFinalFailure(code)) return <Notice tone="danger">{t(code)}</Notice>;
	return (
		<p className="text-danger text-small" role="alert">
			{t(code)}
		</p>
	);
}
