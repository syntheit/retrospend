import type { MoveDirection, Peer } from "./bodies";

/** The pool ("Not planned yet", "To assign") stands in the places by this id. */
export const POOL = "pool";

/**
 * Where the money goes in Move money: a From and a To, each a place (the pool
 * or an envelope id). The envelope the sheet was opened from is always one of
 * the two, because the server's move is always relative to one envelope.
 */
export interface MoveEnds {
	from: string;
	to: string;
}

/**
 * Picks one end. Picking the sheet's own envelope on a side puts it there and,
 * if it was on the other side, sends that side to the pool (the person turned
 * the move around). Picking any other place puts it on that side and keeps
 * the envelope on the other, so a pick can never leave the envelope out.
 */
export function pickEnd(
	ends: MoveEnds,
	side: "from" | "to",
	id: string,
	self: string,
): MoveEnds {
	const other = side === "from" ? "to" : "from";
	const next = { ...ends, [side]: id };
	if (id === self) {
		if (ends[other] === self) next[other] = POOL;
	} else {
		next[other] = self;
	}
	return next;
}

/**
 * The request's direction and the other place: money out of the envelope when
 * it is the From end, in when it is the To end. Null when neither end is the
 * envelope (it cannot be, see `pickEnd`) or both are.
 */
export function readEnds(
	ends: MoveEnds,
	self: string,
): { direction: MoveDirection; peer: Peer } | null {
	if ((ends.from === self) === (ends.to === self)) return null;
	const direction: MoveDirection = ends.from === self ? "out" : "in";
	const other = direction === "out" ? ends.to : ends.from;
	return {
		direction,
		peer: other === POOL ? { kind: "pool" } : { kind: "envelope", id: other },
	};
}

/**
 * Where a fresh Move money starts: the pool into the envelope when the pool
 * has something, else the first envelope that does, else the envelope out to
 * the pool.
 */
export function firstEnds(
	self: string,
	sources: readonly { id: string; minor: number }[],
): MoveEnds {
	const source = sources.find((s) => s.id !== self && s.minor > 0);
	return source
		? { from: source.id, to: self }
		: { from: self, to: POOL };
}
