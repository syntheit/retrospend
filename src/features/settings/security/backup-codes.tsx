"use client";

import { Copy, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";

/** The text file a person keeps: a header line, then one code per line. */
export function backupCodesFile(
	header: string,
	codes: readonly string[],
): string {
	return `${header}\n\n${codes.join("\n")}\n`;
}

function download(text: string) {
	const blob = new Blob([text], { type: "text/plain;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = "retrospend-backup-codes.txt";
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

/**
 * Backup codes as the mockup shows them (two columns, mono) with Copy and
 * Download. They are shown once, right after they are made; the server
 * keeps them encrypted and the web client cannot read them back.
 */
export function BackupCodes({ codes }: { codes: readonly string[] }) {
	const t = useTranslations("settingsV2.twoFactor");
	const toast = useToast();
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(codes.join("\n"));
			toast.info(t("codesCopied"));
		} catch {
			toast.failed(t("copyFailed"));
		}
	};
	return (
		<div className="flex flex-col gap-3">
			<ul
				aria-label={t("codesLabel")}
				className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-ctl bg-raised px-4 py-3 font-mono text-small tabular-nums"
			>
				{codes.map((c) => (
					<li key={c}>{c}</li>
				))}
			</ul>
			<p className="text-fg-2 text-small">{t("codesHint")}</p>
			<div className="flex flex-wrap gap-2">
				<Button kind="secondary" onClick={() => void copy()} size="sm">
					<Copy aria-hidden="true" />
					{t("copy")}
				</Button>
				<Button
					kind="secondary"
					onClick={() => download(backupCodesFile(t("fileHeader"), codes))}
					size="sm"
				>
					<Download aria-hidden="true" />
					{t("download")}
				</Button>
			</div>
		</div>
	);
}
