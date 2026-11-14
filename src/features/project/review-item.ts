import type { NeedsItemDTO } from "~/server/services/people/types";
import type { ExpenseRow } from "./types";

/**
 * The review sheet's item for a project row waiting on you: the sheet the
 * People and Home pages open, so one place decides. Who is asking comes from
 * the server (the payer, or the creator when you paid); nothing is derived
 * here. Null when the row is not waiting or has no one asking.
 */
export function verifyOfRow(row: ExpenseRow): NeedsItemDTO | null {
	const { asking, share } = row;
	if (row.waiting !== "review" || !asking || !share) return null;
	const [type, id = ""] = asking.id.split(":");
	if (type !== "user" && type !== "guest" && type !== "shadow") return null;
	return {
		kind: "verify",
		id: row.id,
		person: {
			key: asking.id,
			type,
			id,
			name: asking.name,
			username: null,
			imageUrl: asking.imageUrl,
			onRetrospend: type === "user",
		},
		title: row.title,
		amount: share,
		date: row.date,
	};
}
