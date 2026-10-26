/**
 * A figure was read without a narrowing it cannot do without (`entry.amount`
 * with no `entryId`). It is the caller's mistake, not a bug in the figure, so
 * readFigure lets it through unwrapped and the API answers `bad_request`.
 *
 * Its own module so figure files can throw it without importing the
 * registry, which imports them.
 */
export class FigureNarrowingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FigureNarrowingError";
	}
}
