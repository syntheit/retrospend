"use client";

import { invalidateForEvent } from "@retrospend/api-client/query";
import { useApi } from "@retrospend/api-client/react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { SheetChanges } from "~/components/ui/sheet-changes";
import { useToast } from "~/components/ui/toast";
import { EventPicker } from "./event-picker";
import { SecretPanel } from "./secret-panel";
import { isWebhookUrl, targetOf } from "./webhooks";

/**
 * New webhook: a name, the URL it posts to and the events it gets, with what
 * Create will do spelled out first. Then the signing secret, shown once.
 * Done ends with a toast whose Undo deletes the webhook again.
 */
export function CreateWebhookSheet({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("settingsV2.developer");
	const toast = useToast();
	const queryClient = useQueryClient();
	const { client } = useApi();
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");
	const [filters, setFilters] = useState<string[]>([]);
	const [made, setMade] = useState<{
		id: string;
		name: string;
		secret: string;
	} | null>(null);

	useEffect(() => {
		if (open) return;
		setName("");
		setUrl("");
		setFilters([]);
		setMade(null);
	}, [open]);

	const submit = async () => {
		if (made) {
			const { id } = made;
			toast.saved(t("webhookCreated", { name: made.name }), {
				undo: async () => {
					await client.webhooks.delete({ id });
					await invalidateForEvent(queryClient, "webhook.deleted");
				},
			});
			return true;
		}
		// Called on the client, not through a mutation hook: a mutation keeps
		// its result in the cache, and this result holds the secret.
		const out = await client.webhooks.create({
			name: name.trim(),
			url: url.trim(),
			eventTypes: filters,
		});
		setMade({ id: out.webhook.id, name: out.webhook.name, secret: out.secret });
		await invalidateForEvent(queryClient, "webhook.created");
		return false;
	};

	const valid = name.trim() !== "" && isWebhookUrl(url);
	const urlBad = url.trim() !== "" && !isWebhookUrl(url);

	return (
		<Sheet
			detent="large"
			onOpenChange={onOpenChange}
			onSubmit={submit}
			open={open}
			submitDisabled={!made && !valid}
			submitLabel={made ? t("done") : t("createWebhook")}
			title={made ? t("secretTitle") : t("newWebhookTitle")}
		>
			{made ? (
				<SecretPanel
					copiedMessage={t("secretCopied")}
					label={t("secretLabel")}
					value={made.secret}
				/>
			) : (
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="wh-name">{t("name")}</Label>
						<Input
							id="wh-name"
							maxLength={100}
							onChange={(e) => setName(e.target.value)}
							placeholder={t("webhookNamePlaceholder")}
							value={name}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="wh-url">{t("url")}</Label>
						<Input
							aria-describedby="wh-url-hint"
							aria-invalid={urlBad}
							autoCapitalize="none"
							autoComplete="off"
							id="wh-url"
							inputMode="url"
							maxLength={2048}
							onChange={(e) => setUrl(e.target.value)}
							placeholder="https://example.com/retrospend"
							spellCheck={false}
							type="url"
							value={url}
						/>
						<p
							className={urlBad ? "text-danger text-small" : "text-fg-3 text-small"}
							id="wh-url-hint"
						>
							{urlBad ? t("urlInvalid") : t("urlHint")}
						</p>
					</div>
					<div className="flex flex-col gap-2">
						<span className="font-medium text-fg-2 text-small">
							{t("eventsHeading")}
						</span>
						<EventPicker onChange={setFilters} value={filters} />
					</div>
					<SheetChanges
						lines={[
							{
								key: "name",
								label: t("changes.adds"),
								value: <span>{name.trim() || t("changes.unnamed")}</span>,
							},
							{
								key: "target",
								label: t("changes.sendsTo"),
								value: (
									<span className="font-mono">
										{isWebhookUrl(url) ? targetOf(url.trim()) : t("changes.noUrl")}
									</span>
								),
							},
							{
								key: "events",
								label: t("changes.events"),
								value: (
									<span>
										{filters.length === 0
											? t("events.all")
											: t("changes.eventCount", { count: filters.length })}
									</span>
								),
							},
						]}
						stays={[t("changes.yourData"), t("changes.otherWebhooks")]}
					/>
				</div>
			)}
		</Sheet>
	);
}
