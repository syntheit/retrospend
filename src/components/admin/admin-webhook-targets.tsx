"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import { Switch } from "~/components/ui/switch";
import { SettingRow } from "~/features/settings/setting-row";
import type { RouterOutputs } from "~/trpc/react";

type AdminSettings = RouterOutputs["admin"]["getSettings"];

/**
 * Whether webhooks may point at a private network address. Turning it on
 * lets every user's webhook reach services inside the server's network, so it
 * asks first with a named button; turning it off is safe and runs at once.
 */
export function PrivateTargetsRow({
	settings,
	isUpdating,
	onSave,
}: {
	settings?: Pick<AdminSettings, "webhooksAllowPrivateTargets">;
	isUpdating: boolean;
	onSave: (
		updates: { webhooksAllowPrivateTargets: boolean },
		message: string,
	) => Promise<void>;
}) {
	const t = useTranslations("admin");
	const [asking, setAsking] = useState(false);
	return (
		<>
			<SettingRow
				label={t("webhookPrivateTargets")}
				labelFor="webhook-private-targets-switch"
				meta={t("webhookPrivateTargetsDescription")}
			>
				<Switch
					checked={settings?.webhooksAllowPrivateTargets ?? false}
					disabled={isUpdating || !settings}
					id="webhook-private-targets-switch"
					onCheckedChange={(on) =>
						on
							? setAsking(true)
							: void onSave(
									{ webhooksAllowPrivateTargets: false },
									t("webhookPrivateTargetsOff"),
								)
					}
				/>
			</SettingRow>
			<ConfirmationDialog
				confirmLabel={t("webhookPrivateTargetsConfirm")}
				description={t("webhookPrivateTargetsConfirmBody")}
				onConfirm={() => {
					setAsking(false);
					void onSave(
						{ webhooksAllowPrivateTargets: true },
						t("webhookPrivateTargetsOn"),
					);
				}}
				onOpenChange={setAsking}
				open={asking}
				title={t("webhookPrivateTargetsConfirmTitle")}
				variant="destructive"
			/>
		</>
	);
}
