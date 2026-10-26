"use client";

import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Notice } from "~/components/ui/notice";
import { useToast } from "~/components/ui/toast";

/**
 * A secret shown once (an API key, a webhook signing secret): the warning,
 * the value in a read-only field and Copy. The value lives only in the
 * sheet that made it: it is never put in the query cache, a toast or the
 * URL, and closing the sheet drops it.
 */
export function SecretPanel({
	label,
	value,
	copiedMessage,
}: {
	label: string;
	value: string;
	copiedMessage: string;
}) {
	const t = useTranslations("settingsV2.developer");
	const toast = useToast();
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value);
			toast.info(copiedMessage);
		} catch {
			toast.failed(t("copyFailed"));
		}
	};
	return (
		<div className="flex flex-col gap-3">
			<Notice tone="attention">{t("onceOnly")}</Notice>
			<div className="flex items-center gap-2">
				<Input
					aria-label={label}
					autoComplete="off"
					className="font-mono"
					onFocus={(e) => e.currentTarget.select()}
					readOnly
					spellCheck={false}
					value={value}
				/>
				<Button kind="secondary" onClick={() => void copy()}>
					<Copy aria-hidden="true" />
					{t("copy")}
				</Button>
			</div>
		</div>
	);
}
