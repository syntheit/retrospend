"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";
import { api } from "~/trpc/react";
import {
	type PasswordCheck,
	passwordChecks,
	passwordReady,
} from "./password-rules";

const CHECKS: PasswordCheck[] = ["length", "case", "number"];

/** Change password: three fields, the rules as checks, an explicit Update password. */
export function PasswordSheet({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("settingsV2.password");
	const toast = useToast();
	const change = api.profile.changePassword.useMutation();
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [confirm, setConfirm] = useState("");

	useEffect(() => {
		if (!open) return;
		setCurrent("");
		setNext("");
		setConfirm("");
	}, [open]);

	const checks = passwordChecks(next);
	const field = (
		id: string,
		label: string,
		value: string,
		set: (v: string) => void,
		auto: string,
	) => (
		<div className="flex flex-col gap-2">
			<Label htmlFor={id}>{label}</Label>
			<Input
				autoComplete={auto}
				id={id}
				onChange={(e) => set(e.target.value)}
				type="password"
				value={value}
			/>
		</div>
	);

	return (
		<Sheet
			onOpenChange={onOpenChange}
			onSubmit={async () => {
				await change.mutateAsync({
					currentPassword: current,
					newPassword: next,
					confirmPassword: confirm,
				});
				toast.saved(t("changed"));
			}}
			open={open}
			submitDisabled={!passwordReady({ current, next, confirm })}
			submitLabel={t("submit")}
			title={t("title")}
		>
			<div className="flex flex-col gap-4">
				{field(
					"pw-current",
					t("current"),
					current,
					setCurrent,
					"current-password",
				)}
				{field("pw-new", t("new"), next, setNext, "new-password")}
				<ul aria-label={t("rules")} className="flex flex-col gap-1 text-meta">
					{CHECKS.map((c) => (
						<li
							className={cn(
								"flex items-center gap-2",
								checks[c] ? "text-positive" : "text-fg-3",
							)}
							key={c}
						>
							<Check
								aria-hidden="true"
								className={cn("size-3.5", !checks[c] && "invisible")}
							/>
							{t(`check.${c}`)}
							<span className="sr-only">
								{checks[c] ? t("met") : t("notMet")}
							</span>
						</li>
					))}
				</ul>
				{field("pw-confirm", t("confirm"), confirm, setConfirm, "new-password")}
				{confirm !== "" && confirm !== next && (
					<p className="text-danger text-meta">{t("mismatch")}</p>
				)}
			</div>
		</Sheet>
	);
}
