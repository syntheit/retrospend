import { useTranslations } from "use-intl";
import type { Face } from "@/ui/Avatar";
import { knownPeople } from "./draft";
import { usePersonFaces } from "./Face";
import type { SavedEntry } from "./hooks";
import { sharesAfter } from "./preview";
import type { SplitMode } from "./splitParts";
import { personKey } from "./types";
import type { ComposerPreview } from "./useComposerPreview";
import type { EntryForm } from "./useEntryForm";

type Money = { minor: number; currency: string };

export interface SplitPerson {
	key: string;
	name: string;
	face: Face;
}

/** What the Split group shows: who paid, how it divides, and each person's part. */
export interface SplitView {
	mode: SplitMode;
	/** Who paid. */
	paidBy: SplitPerson;
	/** Who can have paid: you, the others on it, and a saved payer who holds no share. */
	payers: SplitPerson[];
	/** One row per person who shares it. */
	rows: (SplitPerson & { share: Money | null; you: boolean })[];
	yourShare: Money | null;
	/** The dry run of this exact split has not answered: shares shown would be stale. */
	pending: boolean;
}

/**
 * The split of the open expense, or null for one that is yours alone. Who
 * paid and how it divides are the draft's; each share is the server's, from
 * the dry run of this very body (an edit shows the saved share until
 * something changes). Nothing here divides an amount.
 */
export function useSplitView(
	form: EntryForm,
	preview: ComposerPreview,
	edit: SavedEntry | undefined,
): SplitView | null {
	const t = useTranslations("mobile.composer");
	const faces = usePersonFaces();
	const { meId, expense: draft } = form;
	const sharedEdit = edit?.kind === "shared";
	if (form.editing && !sharedEdit) return null;
	if (!form.editing && draft.withKeys.length === 0) return null;

	const youKey = personKey({ type: "user", id: meId });
	const people = knownPeople(draft, form.catalog.people);
	const person = (key: string, name: string, imageUrl: string | null) => {
		const [face] = faces([{ key, name, imageUrl }]);
		return { key, name, face: face as Face };
	};
	const you = person(youKey, t("you"), form.me?.avatarUrl ?? null);
	const others = draft.withKeys.flatMap((key) => {
		const p = people.find((x) => personKey(x) === key);
		return p ? [person(key, p.name, p.imageUrl)] : [];
	});
	const youOn = draft.editing?.split?.youOnSplit ?? true;

	// The server's share after this very body; an edit shows the saved share
	// until something changes, and nothing while its dry run is out.
	const diff = preview.preview.status === "ready" ? preview.preview.diff : null;
	const after = diff ? sharesAfter(diff) : null;
	const saved = new Map(
		(sharedEdit ? edit.entry.splits : []).map((s) => [
			personKey(s),
			s.share as Money,
		]),
	);
	const pending = sharedEdit
		? form.dirty && !after
		: preview.preview.status === "loading";
	const shareOf = (key: string): Money | null => {
		if (pending) return null;
		return (
			after?.get(key) ??
			(sharedEdit && !form.dirty ? saved.get(key) : null) ??
			null
		);
	};

	const members = [...(youOn ? [you] : []), ...others];
	const rows = members.map((m) => ({
		...m,
		share: shareOf(m.key),
		you: m.key === youKey,
	}));
	const outside =
		draft.paidByKey !== null &&
		!draft.withKeys.includes(draft.paidByKey) &&
		draft.editing
			? people.find((x) => personKey(x) === draft.paidByKey)
			: undefined;
	const payers = [
		you,
		...others,
		...(outside
			? [person(personKey(outside), outside.name, outside.imageUrl)]
			: []),
	];
	const paidBy = payers.find((p) => p.key === draft.paidByKey) ?? you;
	return {
		mode: draft.splitMode,
		paidBy,
		payers,
		rows,
		yourShare: rows.find((r) => r.you)?.share ?? null,
		pending,
	};
}
