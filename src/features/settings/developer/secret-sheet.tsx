"use client";

import { useTranslations } from "next-intl";
import { Sheet } from "~/components/ui/sheet";
import { SecretPanel } from "./secret-panel";

/** A webhook's new signing secret after Rotate secret: shown once, then gone. */
export function SecretSheet({
	secret,
	name,
	onClose,
}: {
	secret: string | null;
	name: string;
	onClose: () => void;
}) {
	const t = useTranslations("settingsV2.developer");
	return (
		<Sheet
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			onSubmit={() => true}
			open={secret !== null}
			submitLabel={t("done")}
			title={t("rotatedTitle", { name })}
		>
			{secret ? (
				<SecretPanel
					copiedMessage={t("secretCopied")}
					label={t("secretLabel")}
					value={secret}
				/>
			) : null}
		</Sheet>
	);
}
