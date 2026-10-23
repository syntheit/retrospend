"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { DatePicker } from "~/components/pickers/date-picker";
import { PersonPicker } from "~/components/pickers/person-picker";
import { useRowDates } from "~/components/rows/dates";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";
import type { PageView } from "../types";

type Ref = {
	participantType: "user" | "guest" | "shadow";
	participantId: string;
};

/**
 * Add person: someone you already share with (found as you type the name),
 * or a new name with an optional email, and the day they join. Expenses
 * before that day stay as they are; new ones can include them (RC-11, past
 * splits are never re-split). Adding moves no money, so the toast's Undo
 * removes them again.
 */
export function AddPersonSheet({
	view,
	onOpenChange,
}: {
	view: PageView;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("projectV2.addPerson");
	const toast = useToast();
	const { short } = useRowDates();
	const utils = api.useUtils();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [picked, setPicked] = useState<string[]>([]);
	const [joins, setJoins] = useState(view.today);
	const [tried, setTried] = useState(false);
	const typed = name.trim();
	const search = api.people.search.useQuery(
		{ query: typed },
		{ enabled: typed.length >= 2 },
	);
	const inProject = new Set(view.members.map((m) => m.id));
	const found = [
		...(search.data && "users" in search.data ? search.data.users : []).map(
			(p) => ({
				id: `user:${p.participantId}`,
				name: p.name,
				avatarUrl: p.avatarUrl,
				onRetrospend: true,
			}),
		),
		...(search.data && "shadows" in search.data ? search.data.shadows : []).map(
			(p) => ({
				id: `shadow:${p.participantId}`,
				name: p.name,
				avatarUrl: null,
				onRetrospend: false,
			}),
		),
	].filter((p) => !inProject.has(p.id));
	const createShadow = api.people.createShadow.useMutation();
	const add = api.project.addParticipant.useMutation();
	const remove = api.project.removeParticipant.useMutation();
	const refresh = () => utils.project.invalidate();

	const submit = async () => {
		setTried(true);
		const chosen = found.find((p) => p.id === picked[0]);
		if (!chosen && !typed) return false;
		let ref: Ref;
		let who = chosen?.name ?? typed;
		if (chosen) {
			const [participantType, participantId] = chosen.id.split(/:(.*)/s) as [
				Ref["participantType"],
				string,
			];
			ref = { participantType, participantId };
		} else {
			const created = await createShadow.mutateAsync({
				name: typed,
				email: email.trim() || undefined,
			});
			ref = {
				participantType: created.participantType,
				participantId: created.participantId,
			};
			who = created.name ?? typed;
		}
		await add.mutateAsync({
			projectId: view.id,
			...ref,
			role: "CONTRIBUTOR",
			joinedOn: joins,
		});
		await refresh();
		toast.saved(
			t("added", { name: who, project: view.name, date: short(joins) }),
			{
				undo: async () => {
					await remove.mutateAsync({ projectId: view.id, ...ref });
					await refresh();
				},
			},
		);
	};

	return (
		<Sheet
			detent="large"
			onOpenChange={onOpenChange}
			onSubmit={submit}
			open
			submitLabel={t("submit")}
			title={t("title", { project: view.name })}
		>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-1">
					<Label htmlFor="ap-name">{t("name")}</Label>
					<Input
						aria-invalid={
							tried && !typed && picked.length === 0 ? true : undefined
						}
						autoComplete="off"
						autoFocus
						id="ap-name"
						maxLength={191}
						onChange={(e) => {
							setName(e.target.value);
							setPicked([]);
						}}
						placeholder={t("namePlaceholder")}
						value={name}
					/>
					{tried && !typed ? (
						<span className="text-danger text-meta" role="alert">
							{t("nameMissing")}
						</span>
					) : null}
				</div>
				{found.length > 0 ? (
					<div className="flex flex-col gap-1">
						<span className="text-fg-2 text-small">{t("known")}</span>
						<PersonPicker
							onChange={(ids) => setPicked(ids.slice(-1))}
							people={found}
							value={picked}
						/>
					</div>
				) : null}
				{picked.length === 0 ? (
					<div className="flex flex-col gap-1">
						<Label htmlFor="ap-email">{t("email")}</Label>
						<Input
							autoComplete="off"
							id="ap-email"
							onChange={(e) => setEmail(e.target.value)}
							placeholder={t("emailPlaceholder")}
							type="email"
							value={email}
						/>
						<span className="text-fg-3 text-meta">{t("emailHint")}</span>
					</div>
				) : null}
				<div className="flex flex-col gap-1">
					<Label>{t("joins", { project: view.name })}</Label>
					<DatePicker onChange={setJoins} today={view.today} value={joins} />
					<span className="text-fg-3 text-meta">{t("joinsHint")}</span>
				</div>
			</div>
		</Sheet>
	);
}
