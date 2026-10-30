import { useMemo } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { announceEntryChange } from "@/features/entry/events";
import type { PersonSummary } from "@/features/people/source";
import { usePeopleOverview } from "@/features/people/usePeople";
import { useFaces } from "@/features/read/faces";
import { Avatar } from "@/ui/Avatar";
import { PickerSheet } from "@/ui/PickerSheet";
import { useToast } from "@/ui/Toast";
import { membersToAdd } from "./addMember";
import type { ProjectMember } from "./source";

/**
 * Add person to a project: a search over the people you share with who are
 * not in it yet. A tap adds the person at once, as a Contributor (the API's
 * default), and says so; it moves no money, so there is no preview. Someone
 * new is added by name from People first.
 */
export function AddMemberSheet({
	projectId,
	members,
	visible,
	onClose,
	onDone,
}: {
	projectId: string;
	members: ProjectMember[];
	visible: boolean;
	onClose: () => void;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.projects.addPerson");
	const tp = useTranslations("mobile.pickers");
	const { api } = useSession();
	const toast = useToast();
	const faces = useFaces();
	const overview = usePeopleOverview();
	const people: PersonSummary[] = useMemo(
		() =>
			overview.state.status === "ready"
				? membersToAdd(overview.state.data.people, members)
				: [],
		[overview.state, members],
	);

	async function add(key: string) {
		const person = people.find((p) => p.person.key === key)?.person;
		if (!api || !person) return;
		onClose();
		try {
			await api.projects.addMember(
				{ id: projectId, person: { type: person.type, id: person.id } },
				{ context: { idempotencyKey: newClientId() } },
			);
			announceEntryChange();
			onDone();
			toast.show({ message: t("added", { name: person.name }) });
		} catch {
			toast.show({ message: t("error", { name: person.name }) });
		}
	}

	return (
		<PickerSheet
			clear={tp("clear")}
			empty={t("empty")}
			find={t("find")}
			groups={[
				{
					key: "people",
					heading: t("heading"),
					rows: people.map(({ person }) => {
						const [face] = faces([
							{ key: person.key, name: person.name, imageUrl: person.imageUrl },
						]);
						return {
							id: person.key,
							label: person.name,
							lead: face ? <Avatar face={face} size="sm" /> : null,
							selected: false,
						};
					}),
				},
			]}
			onClose={onClose}
			onSelect={(key) => void add(key)}
			title={t("title")}
			visible={visible}
		/>
	);
}
