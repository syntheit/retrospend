"use client";

import { useTranslations } from "next-intl";
import { type KeyboardEvent, useEffect, useState } from "react";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";
import { useAutosave } from "../autosave";

export type ProfileIdentity = { name: string; username: string; email: string };

const USERNAME = /^[a-zA-Z0-9]+$/;

function commitOnEnter(e: KeyboardEvent<HTMLInputElement>) {
	if (e.key === "Enter") {
		e.preventDefault();
		e.currentTarget.blur();
	}
}

/**
 * Display name and username, saved when the field is left (or on Enter).
 * The name saves with Undo. A username can change once every 30 days and
 * the old one stays reserved, so it cannot be undone: it asks first, with
 * a named button. Each label points at its input (GAPS §8, "Profile form
 * labels point nowhere").
 */
export function NameFields({
	identity,
	onSaved,
}: {
	identity: ProfileIdentity;
	onSaved: () => Promise<unknown>;
}) {
	const t = useTranslations("settingsV2.profile");
	const save = useAutosave();
	const toast = useToast();
	const update = api.profile.update.useMutation();
	const [name, setName] = useState(identity.name);
	const [username, setUsername] = useState(identity.username);
	const [confirming, setConfirming] = useState(false);

	useEffect(() => setName(identity.name), [identity.name]);
	useEffect(() => setUsername(identity.username), [identity.username]);

	const write = async (patch: Partial<ProfileIdentity>) => {
		await update.mutateAsync({
			name: identity.name,
			username: identity.username,
			email: identity.email,
			...patch,
		});
		await onSaved();
	};

	const commitName = () => {
		const next = name.trim();
		if (!next) {
			setName(identity.name);
			toast.failed(t("nameRequired"));
			return;
		}
		void save({
			apply: (v: string) => write({ name: v }).then(() => setName(v)),
			next,
			prev: identity.name,
			message: t("nameSaved"),
		});
	};

	const nextUsername = username.trim().toLowerCase();
	const commitUsername = () => {
		if (nextUsername === identity.username) return;
		if (!USERNAME.test(nextUsername)) {
			setUsername(identity.username);
			toast.failed(t("usernameInvalid"));
			return;
		}
		setConfirming(true);
	};

	const changeUsername = async () => {
		setConfirming(false);
		const ok = await save({
			apply: (v: string) => write({ username: v }),
			next: nextUsername,
			prev: identity.username,
			message: t("usernameSaved", { username: nextUsername }),
			undoable: false,
		});
		if (!ok) setUsername(identity.username);
	};

	return (
		<div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
			<div className="flex flex-col gap-2">
				<Label htmlFor="p-name">{t("displayName")}</Label>
				<Input
					autoComplete="name"
					id="p-name"
					maxLength={100}
					name="name"
					onBlur={commitName}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={commitOnEnter}
					value={name}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="p-user">{t("username")}</Label>
				<div className="relative">
					<span
						aria-hidden="true"
						className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-fg-3"
					>
						@
					</span>
					<Input
						aria-describedby="p-user-hint"
						autoCapitalize="none"
						autoComplete="username"
						className="pl-6"
						id="p-user"
						maxLength={50}
						name="username"
						onBlur={commitUsername}
						onChange={(e) => setUsername(e.target.value)}
						onKeyDown={commitOnEnter}
						spellCheck={false}
						value={username}
					/>
				</div>
				<p className="text-fg-3 text-meta" id="p-user-hint">
					{t("usernameHint")}
				</p>
			</div>
			<ConfirmationDialog
				cancelLabel={t("keepUsername")}
				confirmLabel={t("changeUsername")}
				description={t("changeUsernameBody", { old: identity.username })}
				onConfirm={() => void changeUsername()}
				onOpenChange={(open) => {
					// Cancel, Escape and a click outside all keep the old username.
					if (open) return;
					setConfirming(false);
					setUsername(identity.username);
				}}
				open={confirming}
				title={t("changeUsernameTitle", { username: nextUsername })}
			/>
		</div>
	);
}
