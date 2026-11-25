"use client";

import {
	isFinalRecoveryFailure,
	type RecoveryFailureCode,
} from "@retrospend/crypto/client";
import { useTranslations } from "next-intl";
import { Notice } from "~/components/ui/notice";

/**
 * A failure after which the screen cannot be used again: the link is gone, the
 * server does not offer the feature, a new key was not saved, or the account
 * has no recovery key to try. The rest can be tried again.
 */
export const blocksScreen = (code: RecoveryFailureCode | null): boolean =>
	isFinalRecoveryFailure(code) || code === "unavailable";

/**
 * What went wrong on a recovery or Make new key step. A try-again failure is
 * one line under the fields; a blocking one is the sheet's one Notice.
 */
export function RecoveryError({ code }: { code: RecoveryFailureCode | null }) {
	const t = useTranslations("protection.recover.errors");
	if (!code) return null;
	if (blocksScreen(code)) return <Notice tone="danger">{t(code)}</Notice>;
	return (
		<p className="text-danger text-small" role="alert">
			{t(code)}
		</p>
	);
}
