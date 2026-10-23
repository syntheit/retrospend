"use client";

import { SCOPES, type Scope } from "@retrospend/api-contract/common";
import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Notice } from "~/components/ui/notice";
import { Segmented } from "~/components/ui/segmented";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import {
	CREATABLE_SCOPES,
	createToken,
	DEFAULT_EXPIRY,
	EXPIRY_DAYS,
	type ExpiryDays,
	scopeKey,
} from "./tokens";

/**
 * New API key: a name, how long it lasts and what it may do, then the key
 * itself, shown once with Copy. Scopes the server cannot set yet show
 * disabled with the reason (GAPS, "Developer: token scopes"); admin only
 * appears for admins.
 */
export function CreateTokenSheet({
	open,
	onOpenChange,
	isAdmin,
	onCreated,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	isAdmin: boolean;
	onCreated: () => unknown;
}) {
	const t = useTranslations("settingsV2.developer");
	const tScope = useTranslations("device.scopes");
	const toast = useToast();
	const [name, setName] = useState("");
	const [days, setDays] = useState<ExpiryDays>(DEFAULT_EXPIRY);
	const [scopes, setScopes] = useState<Scope[]>(["read"]);
	const [secret, setSecret] = useState<string | null>(null);

	useEffect(() => {
		if (open) return;
		setName("");
		setDays(DEFAULT_EXPIRY);
		setScopes(["read"]);
		setSecret(null);
	}, [open]);

	const shown = SCOPES.filter((s) => s !== "admin" || isAdmin);
	const toggle = (s: Scope, on: boolean) =>
		setScopes((cur) => (on ? [...cur, s] : cur.filter((x) => x !== s)));

	const submit = async () => {
		if (secret) return true;
		const out = await createToken({
			name: name.trim(),
			expiresInDays: days,
			scopes,
		});
		setSecret(out.key);
		toast.saved(t("created", { name: name.trim() }));
		await onCreated();
		return false;
	};
	const copy = async () => {
		if (!secret) return;
		try {
			await navigator.clipboard.writeText(secret);
			toast.info(t("keyCopied"));
		} catch {
			toast.failed(t("copyFailed"));
		}
	};

	return (
		<Sheet
			detent="large"
			onOpenChange={onOpenChange}
			onSubmit={submit}
			open={open}
			submitDisabled={!secret && (!name.trim() || scopes.length === 0)}
			submitLabel={secret ? t("done") : t("create")}
			title={secret ? t("keyTitle") : t("newTitle")}
		>
			{secret ? (
				<div className="flex flex-col gap-3">
					<Notice tone="attention">{t("onceOnly")}</Notice>
					<div className="flex items-center gap-2">
						<Input
							aria-label={t("keyLabel")}
							className="font-mono"
							readOnly
							value={secret}
						/>
						<Button kind="secondary" onClick={() => void copy()}>
							<Copy aria-hidden="true" />
							{t("copy")}
						</Button>
					</div>
				</div>
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
						{shown.map((s) => {
							const can = CREATABLE_SCOPES.includes(s);
							const id = `tok-scope-${scopeKey(s)}`;
							return (
								<div className="flex items-start gap-3" key={s}>
									<Checkbox
										checked={scopes.includes(s)}
										disabled={!can}
										id={id}
										onCheckedChange={(on) => toggle(s, on === true)}
									/>
									<Label
										className="flex flex-col items-start gap-1 font-normal"
										htmlFor={id}
									>
										<span className={can ? "text-fg" : "text-fg-3"}>
											{tScope(scopeKey(s))}
										</span>
										{!can && (
											<span className="text-fg-3 text-meta">
												{t("scopeLater")}
											</span>
										)}
									</Label>
								</div>
							);
						})}
					</fieldset>
				</div>
			)}
		</Sheet>
	);
}
