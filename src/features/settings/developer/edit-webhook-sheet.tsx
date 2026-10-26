"use client";

import { invalidateForEvent } from "@retrospend/api-client/query";
import { useApi } from "@retrospend/api-client/react";
import type { WebhookDto } from "@retrospend/api-contract";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { ChangeValue, SheetChanges } from "~/components/ui/sheet-changes";
import { useToast } from "~/components/ui/toast";
import { EventPicker, tooManyEvents } from "./event-picker";
import {
	areaScopes,
	editPatch,
	isWebhookUrl,
	targetOf,
	undoPatch,
	type WebhookEdit,
} from "./webhooks";

/**
 * Edit webhook: name, URL, events and whether it sends, with only the
 * fields that change listed before Save. Saving ends with a toast whose Undo
 * puts the old values back. The signing secret and the delivery log stay.
 */
export function EditWebhookSheet({
	webhook,
	onOpenChange,
}: {
	webhook: WebhookDto | null;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("settingsV2.developer");
	const tEdit = useTranslations("settingsV2.developer.edit");
	const tArea = useTranslations("settingsV2.developer.areas");
	const toast = useToast();
	const queryClient = useQueryClient();
	const { client } = useApi();
	// The sheet keeps showing the webhook while it closes.
	const shown = useRef<WebhookDto | null>(null);
	if (webhook) shown.current = webhook;
	const current = shown.current;
	const [draft, setDraft] = useState<WebhookEdit | null>(null);

	useEffect(() => {
		if (webhook)
			setDraft({
				name: webhook.name,
				url: webhook.url,
				eventTypes: webhook.eventTypes,
				enabled: webhook.enabled,
			});
	}, [webhook]);

	if (!current || !draft)
		return (
			<Sheet
				onOpenChange={onOpenChange}
				open={false}
				title={tEdit("title", { name: "" })}
			/>
		);

	const patch = editPatch(current, draft);
	const changed = Object.keys(patch).length > 0;
	const urlBad = draft.url.trim() !== "" && !isWebhookUrl(draft.url);
	const valid =
		draft.name.trim() !== "" &&
		isWebhookUrl(draft.url) &&
		!tooManyEvents(draft.eventTypes);
	const set = (next: Partial<WebhookEdit>) => setDraft({ ...draft, ...next });

	const words = (filters: readonly string[]) =>
		filters.length === 0
			? t("events.all")
			: areaScopes(filters)
					.map(({ id, scope }) =>
						scope === "all" || scope === "some"
							? t(`events.scope.${scope}`, { area: tArea(id) })
							: t("events.scope.count", {
									area: tArea(id),
									count: scope.count,
								}),
					)
					.join(", ");

	const submit = async () => {
		if (!changed) return true;
		const { id, name } = current;
		const back = undoPatch(current, patch);
		await client.webhooks.update({ id, ...patch });
		await invalidateForEvent(queryClient, "webhook.updated");
		toast.saved(tEdit("saved", { name: patch.name ?? name }), {
			undo: async () => {
				await client.webhooks.update({ id, ...back });
				await invalidateForEvent(queryClient, "webhook.updated");
			},
		});
		return true;
	};

	const lines = [
		patch.name !== undefined && {
			key: "name",
			label: t("name"),
			value: <ChangeValue from={current.name} to={patch.name} />,
		},
		patch.url !== undefined && {
			key: "target",
			label: t("changes.sendsTo"),
			value: (
				<span className="font-mono">
					{isWebhookUrl(patch.url) ? targetOf(patch.url) : t("changes.noUrl")}
				</span>
			),
		},
		patch.eventTypes !== undefined && {
			key: "events",
			label: t("changes.events"),
			value: (
				<ChangeValue
					from={words(current.eventTypes)}
					to={words(patch.eventTypes)}
				/>
			),
		},
		patch.enabled !== undefined && {
			key: "enabled",
			label: tEdit("status"),
			value: (
				<ChangeValue
					from={tEdit(current.enabled ? "on" : "off")}
					to={tEdit(patch.enabled ? "on" : "off")}
				/>
			),
		},
	].filter((line) => line !== false);

	return (
		<Sheet
			detent="large"
			onOpenChange={onOpenChange}
			onSubmit={submit}
			open={webhook !== null}
			submitDisabled={!valid || !changed}
			submitLabel={tEdit("save")}
			title={tEdit("title", { name: current.name })}
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Label htmlFor="wh-edit-name">{t("name")}</Label>
					<Input
						id="wh-edit-name"
						maxLength={100}
						onChange={(e) => set({ name: e.target.value })}
						value={draft.name}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="wh-edit-url">{t("url")}</Label>
					<Input
						aria-describedby="wh-edit-url-hint"
						aria-invalid={urlBad}
						autoCapitalize="none"
						autoComplete="off"
						id="wh-edit-url"
						inputMode="url"
						maxLength={2048}
						onChange={(e) => set({ url: e.target.value })}
						spellCheck={false}
						type="url"
						value={draft.url}
					/>
					<p
						className={
							urlBad ? "text-danger text-small" : "text-fg-3 text-small"
						}
						id="wh-edit-url-hint"
					>
						{urlBad ? t("urlInvalid") : t("urlHint")}
					</p>
				</div>
				<div className="flex flex-col gap-2">
					<span className="text-fg-2 text-small font-medium">
						{t("eventsHeading")}
					</span>
					<EventPicker
						original={current.eventTypes}
						onChange={(eventTypes) => set({ eventTypes })}
						value={draft.eventTypes}
					/>
				</div>
				<div className="flex items-center gap-3">
					<Checkbox
						checked={draft.enabled}
						id="wh-edit-enabled"
						onCheckedChange={(on) => set({ enabled: on === true })}
					/>
					<Label className="font-normal" htmlFor="wh-edit-enabled">
						{tEdit("enabled")}
					</Label>
				</div>
				<SheetChanges
					lines={lines}
					status={changed ? undefined : tEdit("noChanges")}
					stays={[t("changes.secret"), t("changes.log")]}
				/>
			</div>
		</Sheet>
	);
}
