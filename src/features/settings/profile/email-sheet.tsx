"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Change email: the new address and the current password, then an explicit
 * Send confirmation. With email delivery on, the server keeps the old
 * address until the new one is confirmed (pending email); with it off, the
 * address changes at once. Same profile.update call as today's form.
 */
export function EmailSheet({
	open,
	onOpenChange,
	current,
	onChanged,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	current: { name: string; username: string; email: string };
	onChanged: () => Promise<unknown>;
}) {
	const t = useTranslations("settingsV2.email");
	const toast = useToast();
	const utils = api.useUtils();
	const update = api.profile.update.useMutation();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");

	// Cleared on close, so the password never waits in a closed sheet.
	useEffect(() => {
		if (open) return;
		setEmail("");
		setPassword("");
	}, [open]);

	const next = email.trim().toLowerCase();
	const valid =
		EMAIL.test(next) && next !== current.email.toLowerCase() && password !== "";

	const submit = async () => {
		const result = await update.mutateAsync({
			email: next,
			currentPassword: password,
		});
		const pending = "emailChangePending" in result && result.emailChangePending;
		await utils.profile.getPendingEmail.invalidate();
		await onChanged();
		toast.saved(
			pending ? t("sent", { email: next }) : t("changed", { email: next }),
		);
	};

	return (
		<Sheet
			onOpenChange={onOpenChange}
			onSubmit={submit}
			open={open}
			submitDisabled={!valid}
			submitLabel={t("send")}
			title={t("title")}
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Label htmlFor="em-new">{t("newEmail")}</Label>
					<Input
						autoComplete="email"
						id="em-new"
						inputMode="email"
						onChange={(e) => setEmail(e.target.value)}
						placeholder={t("placeholder")}
						type="email"
						value={email}
					/>
				</div>
				<div className="flex flex-col gap-2">
					<Label htmlFor="em-pw">{t("password")}</Label>
					<Input
						autoComplete="current-password"
						id="em-pw"
						onChange={(e) => setPassword(e.target.value)}
						type="password"
						value={password}
					/>
				</div>
			</div>
		</Sheet>
	);
}
