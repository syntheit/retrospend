import { Share } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useOptionalAddEntry } from "@/features/entry/AddEntryProvider";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useDataExport } from "@/features/settings/security/useDataExport";
import { menuOf } from "@/ui/actionRegistry";
import { useToast } from "@/ui/Toast";
import type { MenuItem } from "@/ui/types";
import { sideOf } from "./groups";
import {
	PERSON_ACTIONS,
	type PersonActionId,
	personActionsOf,
} from "./personActions";
import type { PersonRef, PersonSummary } from "./source";

/**
 * Remind someone of what they owe. Someone not on Retrospend has no app to
 * nudge: the share sheet opens a message you send yourself.
 */
export function useRemind() {
	const t = useTranslations("mobile.person");
	const toast = useToast();
	const money = useMoneyText();
	const { api } = useSession();
	return async (
		person: { type: PersonRef["type"]; id: string; name: string },
		onRetrospend: boolean,
		parts: { amount: { minor: number; currency: string } }[],
	) => {
		if (!onRetrospend) {
			const first = person.name.split(/\s+/)[0] ?? person.name;
			try {
				await Share.share({
					message: t("remindMessage", {
						name: first,
						amount: parts
							.filter((p) => p.amount.minor !== 0)
							.map((p) =>
								money({
									minor: Math.abs(p.amount.minor),
									currency: p.amount.currency,
								}),
							)
							.join(" + "),
					}),
				});
			} catch {
				toast.show({ message: t("remindFailed") });
			}
			return;
		}
		try {
			await api?.people.remind(
				{ type: person.type, id: person.id },
				{ context: { idempotencyKey: newClientId() } },
			);
			toast.show({ message: t("reminded") });
		} catch {
			toast.show({ message: t("remindFailed") });
		}
	};
}

/**
 * The long-press menu of a person row, from the same registry as the person
 * page: Settle up, Remind, Expense, then the two exports. One hook for the
 * whole list, so a row costs no hooks of its own. `settle` opens the person
 * with Settle up showing.
 */
export function usePersonMenu(
	settle: (ref: PersonRef) => void,
): (summary: PersonSummary) => MenuItem[] {
	const t = useTranslations("mobile.person");
	const failed = useTranslations("mobile.settings.data")("failed");
	const add = useOptionalAddEntry();
	const toast = useToast();
	const exporter = useDataExport();
	const remind = useRemind();
	const words: Record<PersonActionId, string> = {
		settle: t("settleUp"),
		remind: t("remind"),
		expense: t("expense"),
		"export-history": t("exportHistory"),
		"share-statement": t("shareStatement"),
	};
	return (summary) => {
		const { person } = summary;
		const ref = { type: person.type, id: person.id };
		const send = (kind: "person_history" | "person_pdf") => () => {
			if (exporter.busy) return;
			void exporter
				.run({
					kind,
					participantType: ref.type,
					participantId: ref.id,
				})
				.then((ok) => {
					if (!ok) toast.show({ message: failed });
				});
		};
		return menuOf(
			personActionsOf({
				nothingShared: summary.lastShared === null,
				owesYou: sideOf(summary.net, summary.parts) === "owesYou",
				canAdd: add !== null,
			}),
			PERSON_ACTIONS,
			words,
			{
				settle: () => settle(ref),
				remind: () => void remind(person, person.onRetrospend, summary.parts),
				expense: () =>
					add?.open("expense", { mode: "expense", withKeys: [person.key] }),
				"export-history": send("person_history"),
				"share-statement": send("person_pdf"),
			},
		);
	};
}
