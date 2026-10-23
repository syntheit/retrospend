"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";

/**
 * Add person (people.createShadow): a name and an optional email. With an
 * email that belongs to someone on Retrospend, that account is used.
 */
export function AddPersonSheet({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("peoplePage.addPerson");
	const toast = useToast();
	const router = useRouter();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const create = api.people.createShadow.useMutation();
	const close = (o: boolean) => {
		if (!o) {
			setName("");
			setEmail("");
		}
		onOpenChange(o);
	};
	return (
		<Sheet
			detent="medium"
			onOpenChange={close}
			onSubmit={async () => {
				const person = await create.mutateAsync({
					name: name.trim(),
					email: email.trim() || undefined,
				});
				router.refresh();
				toast.saved(t("added", { name: person.name }));
				close(false);
			}}
			open={open}
			submitDisabled={!name.trim()}
			submitLabel={t("submit")}
			title={t("title")}
		>
			<div className="flex flex-col gap-4 pb-2">
				<div className="flex flex-col gap-1">
					<Label htmlFor="add-person-name">{t("name")}</Label>
					<Input
						autoComplete="off"
						autoFocus
						id="add-person-name"
						maxLength={191}
						onChange={(e) => setName(e.target.value)}
						value={name}
					/>
				</div>
				<div className="flex flex-col gap-1">
					<Label htmlFor="add-person-email">{t("email")}</Label>
					<Input
						autoComplete="off"
						id="add-person-email"
						inputMode="email"
						maxLength={255}
						onChange={(e) => setEmail(e.target.value)}
						type="email"
						value={email}
					/>
					<span className="text-fg-3 text-meta">{t("emailHint")}</span>
				</div>
			</div>
		</Sheet>
	);
}
