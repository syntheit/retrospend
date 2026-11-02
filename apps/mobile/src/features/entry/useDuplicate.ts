import { fromMinor, money } from "@retrospend/domain/money-minor";
import { useEffect, useState } from "react";
import { useSession } from "@/auth/session";

/** The title and amount must rest this long before the server is asked, as on the web. */
const SETTLE_MS = 800;

/**
 * "A similar expense is already on this day": the server's own check of a
 * title, an amount and a day (`GET /expenses/duplicates`, the one the web's
 * form asks). It only runs when adding, once a title and an amount are typed
 * and have rested. Offline, or when the read fails, it says nothing: the
 * warning never blocks Add.
 */
export function useDuplicate({
	enabled,
	title,
	minor,
	currency,
	date,
}: {
	/** Adding, not editing. */
	enabled: boolean;
	title: string;
	/** The typed amount in minor units; null until it reads as one. */
	minor: number | null;
	currency: string;
	/** The expense's day. */
	date: string;
}): boolean {
	const { api } = useSession();
	const text = title.trim();
	const key =
		enabled && api && text && minor
			? `${text}|${minor}|${currency}|${date}`
			: "";
	const [settled, setSettled] = useState("");
	const [found, setFound] = useState<{ key: string; duplicate: boolean }>({
		key: "",
		duplicate: false,
	});

	useEffect(() => {
		const id = setTimeout(() => setSettled(key), key ? SETTLE_MS : 0);
		return () => clearTimeout(id);
	}, [key]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the settled key stands for the title, amount, currency and day
	useEffect(() => {
		if (!settled || !api || !minor) return;
		let cancelled = false;
		Promise.resolve()
			.then(() =>
				api.expenses.duplicates({
					title: text,
					amount: fromMinor(money(minor, currency)),
					currency,
					date,
				}),
			)
			.then(({ duplicate }) => {
				if (!cancelled) setFound({ key: settled, duplicate });
			})
			.catch(() => {
				if (!cancelled) setFound({ key: settled, duplicate: false });
			});
		return () => {
			cancelled = true;
		};
	}, [settled, api]);

	// An answer is only for the entry it was asked about.
	return key !== "" && found.key === key && found.duplicate;
}
