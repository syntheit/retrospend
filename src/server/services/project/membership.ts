/**
 * Membership dates (RC-11), as pure rules. A person is a member of a project
 * on day D when they joined on or before D and had not left by D. A missing
 * join date means "from the project's start", a missing leave date "still a
 * member".
 *
 * The dates only decide who a new expense includes by default. A split that
 * already exists is never changed by them: what someone was charged stays
 * exactly as it was saved.
 */

/** A calendar day, `YYYY-MM-DD`. */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class InvalidMembershipDatesError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidMembershipDatesError";
	}
}

export function isIsoDate(value: string): boolean {
	const m = ISO_DATE.exec(value);
	if (!m) return false;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	return d.toISOString().slice(0, 10) === value;
}

/** The UTC calendar day of a stored date (DATE columns come back as UTC midnight). */
export function toIsoDate(date: Date): IsoDate {
	return date.toISOString().slice(0, 10);
}

/** The value to store in a DATE column for `day`. */
export function fromIsoDate(day: IsoDate): Date {
	if (!isIsoDate(day)) {
		throw new InvalidMembershipDatesError(`"${day}" is not a calendar day`);
	}
	return new Date(`${day}T00:00:00.000Z`);
}

export interface MembershipDates {
	joinedOn: IsoDate | null;
	leftOn: IsoDate | null;
}

/** The dates of a project_participant row as calendar days. */
export function membershipOf(row: {
	joinedOn: Date | null;
	leftOn: Date | null;
}): MembershipDates {
	return {
		joinedOn: row.joinedOn ? toIsoDate(row.joinedOn) : null,
		leftOn: row.leftOn ? toIsoDate(row.leftOn) : null,
	};
}

/** ISO days compare correctly as strings. */
export function isMemberOn(m: MembershipDates, day: IsoDate): boolean {
	return (
		(m.joinedOn === null || m.joinedOn <= day) &&
		(m.leftOn === null || m.leftOn > day)
	);
}

/** Leaving must come after joining; the database enforces the same rule. */
export function assertValidMembership(m: MembershipDates): void {
	if (m.joinedOn !== null && m.leftOn !== null && m.leftOn <= m.joinedOn) {
		throw new InvalidMembershipDatesError(
			"The leave date must be after the join date",
		);
	}
}

/** True when `day` is before the member joined, so a default split leaves them out. */
export function joinedAfter(
	m: Pick<MembershipDates, "joinedOn">,
	day: IsoDate,
): boolean {
	return m.joinedOn !== null && day < m.joinedOn;
}
