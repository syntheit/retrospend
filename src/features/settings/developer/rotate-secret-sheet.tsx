"use client";

import { invalidateForEvent } from "@retrospend/api-client/query";
import { useApi } from "@retrospend/api-client/react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Segmented } from "~/components/ui/segmented";
import { Sheet } from "~/components/ui/sheet";
import { SheetChanges } from "~/components/ui/sheet-changes";
import { GRACE_CHOICES, type GraceSeconds, graceKey } from "./webhooks";

/**
 * Rotate secret: how long the old secret keeps signing next to the new one,
 * with what rotating changes spelled out first. Stopping at once is the
 * default (the right answer when the secret leaked). The new secret is shown
 * once by the sheet that follows. There is no Undo: the old secret cannot
 * come back, so the sheet says so.
 */
export function RotateSecretSheet({
	webhook,
	onOpenChange,
	onRotated,
}: {
	webhook: { id: string; name: string } | null;
	onOpenChange: (open: boolean) => void;
	onRotated: (rotated: { name: string; secret: string }) => void;
}) {
	const t = useTranslations("settingsV2.developer");
	const tRotate = useTranslations("settingsV2.developer.rotate");
	const queryClient = useQueryClient();
	const { client } = useApi();
	const [grace, setGrace] = useState<GraceSeconds>(0);

	useEffect(() => {
		if (webhook) setGrace(0);
	}, [webhook]);

	const submit = async () => {
		if (!webhook) return false;
		// Called on the client, not through a mutation hook: a mutation keeps
		// its result in the cache, and this result holds the secret.
		const out = await client.webhooks.rotateSecret({
			id: webhook.id,
			graceSeconds: grace,
		});
		onRotated({ name: webhook.name, secret: out.secret });
		await invalidateForEvent(queryClient, "webhook.secret_rotated");
		return true;
	};

	const key = graceKey(grace);
	return (
		<Sheet
			detent="medium"
			onOpenChange={onOpenChange}
			onSubmit={submit}
			open={webhook !== null}
			submitLabel={tRotate("submit")}
			title={tRotate("title", { name: webhook?.name ?? "" })}
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<span className="text-fg-2 text-small font-medium">
						{tRotate("graceLabel")}
					</span>
					<Segmented<string>
						full
						label={tRotate("graceLabel")}
						onChange={(v) => setGrace(Number(v) as GraceSeconds)}
						options={GRACE_CHOICES.map((seconds) => ({
							value: String(seconds),
							label: tRotate(`grace.${graceKey(seconds)}`),
						}))}
						value={String(grace)}
					/>
					<p className="text-fg-3 text-small">{tRotate(`graceHint.${key}`)}</p>
				</div>
				<SheetChanges
					lines={[
						{
							key: "signing",
							label: tRotate("signing"),
							value: <span>{tRotate("replaced")}</span>,
						},
						{
							key: "old",
							label: tRotate("oldSecret"),
							value: <span>{tRotate(`oldEnds.${key}`)}</span>,
						},
					]}
					stays={[t("changes.log"), t("changes.otherWebhooks")]}
				/>
				<p className="text-fg-3 text-small">{tRotate("permanent")}</p>
			</div>
		</Sheet>
	);
}
