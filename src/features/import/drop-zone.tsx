"use client";

import { FileUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useIsMobile } from "~/hooks/use-mobile";
import { cn } from "~/lib/cn";
import { ACCEPT } from "./file";

/**
 * One drop zone (import.html step 1, a page-local part): drop a file, or
 * Choose file. Phones only choose. The size and type checks run in the
 * flow, and their error shows under the zone.
 */
export function DropZone({
	onFile,
	busy,
}: {
	onFile: (file: File) => void;
	busy?: boolean;
}) {
	const t = useTranslations("importPage.drop");
	const phone = useIsMobile();
	const input = useRef<HTMLInputElement>(null);
	const [over, setOver] = useState(false);
	const take = (files: FileList | null | undefined) => {
		const file = files?.[0];
		if (file) onFile(file);
	};
	return (
		<section
			aria-label={t("label")}
			className={cn(
				"rounded-panel bg-surface flex flex-col items-center gap-3 border border-dashed px-6 py-12 text-center transition-colors duration-(--t-state) max-md:px-4 max-md:py-6",
				over ? "border-brand bg-brand-soft" : "border-line-strong",
			)}
			data-testid="import-drop"
			onDragLeave={() => setOver(false)}
			onDragOver={(e) => {
				e.preventDefault();
				setOver(true);
			}}
			onDrop={(e) => {
				e.preventDefault();
				setOver(false);
				take(e.dataTransfer.files);
			}}
		>
			<FileUp aria-hidden="true" className="text-fg-3 size-6" />
			<p className="text-fg text-section font-semibold">
				{phone ? t("titlePhone") : t("title")}
			</p>
			<p className="text-fg-2 text-small">{t("hint")}</p>
			<Button
				kind="primary"
				loading={busy}
				onClick={() => input.current?.click()}
			>
				{t("choose")}
			</Button>
			<Input
				accept={ACCEPT}
				aria-label={t("choose")}
				className="hidden"
				data-testid="import-file"
				onChange={(e) => {
					take(e.target.files);
					e.target.value = "";
				}}
				ref={input}
				type="file"
			/>
		</section>
	);
}
