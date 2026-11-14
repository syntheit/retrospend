/**
 * A figure that cannot be computed because rates are missing, naming the
 * currencies (R14: "Not available", never a guess). readFigure turns it,
 * or a thrown MissingRateError, into a null reading and notes the names on
 * the pass, so a missing rate never reaches a client as a server error.
 *
 * Its own module so figure files can return it without importing the
 * registry, which imports them.
 */
export class FigureUnavailable {
	readonly missingRates: readonly string[];
	constructor(missingRates: readonly string[]) {
		this.missingRates = [...new Set(missingRates)].sort();
	}
}
