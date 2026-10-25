"use client";

import { invalidateForEvent } from "@retrospend/api-client/query";
import { useApi } from "@retrospend/api-client/react";
import type { Scope } from "@retrospend/api-contract/common";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Segmented } from "~/components/ui/segmented";
import { Sheet } from "~/components/ui/sheet";
import { SheetChanges } from "~/components/ui/sheet-changes";
import { useToast } from "~/components/ui/toast";
import { formatDateOnly } from "~/lib/date";
import { SecretPanel } from "./secret-panel";
import {
	DEFAULT_EXPIRY,
	DEFAULT_SCOPES,
	EXPIRY_DAYS,
	type ExpiryDays,
	expiryFrom,
	grantableScopes,
	orderScopes,
	scopeKey,
} from "./tokens";

/**
 * New API key: a name, how long it lasts and what it may do, with what the
 * key will be able to do spelled out before Create. Then the key itself,
 * shown once with Copy. Done ends with a toast whose Undo revokes the key
 * again. Admin access only appears for admins.
 */
export function CreateTokenSheet({
	open,
	onOpenChange,
	isAdmin,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	isAdmin: boolean;
}) {
	const t = useTranslations("settingsV2.developer");
	const tScope = useTranslations("device.scopes");
	const toast = useToast();
	const dates = useDateFormat();
	const queryClient = useQueryClient();
	const { client } = useApi();
	const [name, setName] = useState("");
	const [days, setDays] = useState<ExpiryDays>(DEFAULT_EXPIRY);
	const [scopes, setScopes] = useState<Scope[]>([...DEFAULT_SCOPES]);
	const [made, setMade] = useState<{ id: string; key: string; name: string } | null>(
		null,
	);

	useEffect(() => {
		if (open) return;
		setName("");
		setDays(DEFAULT_EXPIRY);
		setScopes([...DEFAULT_SCOPES]);
		setMade(null);
	}, [open]);

	const toggle = (s: Scope, on: boolean) =>
		setScopes((cur) => (on ? [...cur, s] : cur.filter((x) => x !== s)));

	const submit = async () => {
		if (made) {
			// Done: the key can still be taken back from the toast.
			const { id } = made;
			toast.saved(t("created", { name: made.name }), {
				undo: async () => {
					await client.tokens.revoke({ id });
					await invalidateForEvent(queryClient, "token.revoked");
				},
			});
			return true;
		}
		// Called on the client, not through a mutation hook: a mutation keeps
		// its result in the cache, and this result holds the key.
		const out = await client.tokens.create({
			name: name.trim(),
			scopes: orderScopes(scopes),
			expiresInDays: days,
		});
		setMade({ id: out.token.id, key: out.key, name: out.token.name });
		await invalidateForEvent(queryClient, "token.created");
		return false;
	};

	const expires = dates.medium(formatDateOnly(expiryFrom(days)));
	const words = orderScopes(scopes).map((s) => t(`scope.${s.replace(":", "_")}`));

	return (
		<Sheet
			detent="large"
			onOpenChange={onOpenChange}
			onSubmit={submit}
			open={open}
			submitDisabled={!made && (!name.trim() || scopes.length === 0)}
			submitLabel={made ? t("done") : t("create")}
			title={made ? t("keyTitle") : t("newTitle")}
		>
			{made ? (
				<SecretPanel
					copiedMessage={t("keyCopied")}
					label={t("keyLabel")}
					value={made.key}
				/>
			) : (
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="tok-name">{t("name")}</Label>
						<Input
							id="tok-name"
							maxLength={64}
							onChange={(e) => setName(e.target.value)}
							placeholder={t("namePlaceholder")}
							value={name}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<span className="font-medium text-fg-2 text-small">
							{t("expires")}
						</span>
						<Segmented<string>
							full
							label={t("expires")}
							onChange={(v) => setDays(Number(v) as ExpiryDays)}
							options={EXPIRY_DAYS.map((d) => ({
								value: String(d),
								label: t(`expiry.${d}`),
							}))}
							value={String(days)}
						/>
					</div>
					<fieldset className="flex flex-col gap-3">
						<legend className="mb-2 font-medium text-fg-2 text-small">
							{t("access")}
						</legend>
						{grantableScopes(isAdmin).map((s) => {
							const id = `tok-scope-${scopeKey(s)}`;
							return (
								<div className="flex items-start gap-3" key={s}>
									<Checkbox
										checked={scopes.includes(s)}
										id={id}
										onCheckedChange={(on) => toggle(s, on === true)}
									/>
									<Label className="font-normal" htmlFor={id}>
										{tScope(scopeKey(s))}
									</Label>
								</div>
							);
						})}
					</fieldset>
					<SheetChanges
						lines={[
							{
								key: "name",
								label: t("changes.adds"),
								value: <span>{name.trim() || t("changes.unnamed")}</span>,
							},
							{
								key: "access",
								label: t("changes.access"),
								value: <span>{words.join(", ") || t("noScopes")}</span>,
							},
							{
								key: "expires",
								label: t("changes.expires"),
								value: <span>{expires}</span>,
							},
						]}
						stays={[t("changes.yourData"), t("changes.otherKeys")]}
					/>
				</div>
			)}
		</Sheet>
	);
}
