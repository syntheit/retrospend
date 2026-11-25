"use client";

import {
	blocksRecoveryScreen,
	type RecoveryFailureCode,
} from "@retrospend/crypto/client";
import { useTranslations } from "next-intl";
import { Notice } from "~/components/ui/notice";

/**
 * What went wrong on a recovery or Make new key step. A try-again failure is
 * one line under the fields; a blocking one is the sheet's one Notice.
 */
export function RecoveryError({ code }: { code: RecoveryFailureCode | null }) {
	const t = useTranslations("protection.recover.errors");
	if (!code) return null;
	if (blocksRecoveryScreen(code))
		return <Notice tone="danger">{t(code)}</Notice>;
	return (
		<p className="text-danger text-small" role="alert">
			{t(code)}
		</p>
	);
}
