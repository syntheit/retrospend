/** What the Add family sheets open with (src/features/entry). */

export type ParticipantType = "user" | "guest" | "shadow";

/** A person on a split, with what the faces need. */
export interface EntryPerson {
	readonly participantType: ParticipantType;
	readonly participantId: string;
	readonly name: string;
	readonly avatarUrl?: string | null;
}

/** Prefill for a new expense (Duplicate, Add expense with them, from a project). */
export interface ExpensePrefill {
	readonly title?: string | null;
	/** Minor units in `currency`. */
	readonly minor?: number | null;
	readonly currency?: string;
	readonly categoryId?: string | null;
	readonly description?: string | null;
	readonly location?: string | null;
	readonly with?: readonly EntryPerson[];
}

export type EntryRequest =
	| {
			readonly kind: "expense";
			readonly mode: "create";
			readonly projectId?: string;
			readonly projectName?: string;
			readonly projectCurrency?: string;
			readonly duplicate?: boolean;
			readonly prefill?: ExpensePrefill;
	  }
	| { readonly kind: "expense"; readonly mode: "edit"; readonly id: string }
	| { readonly kind: "shared"; readonly id: string }
	| { readonly kind: "income"; readonly accountId?: string }
	| { readonly kind: "transfer"; readonly fromAccountId?: string };
