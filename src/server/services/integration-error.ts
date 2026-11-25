/** An answer from an outside service with a status other than OK. */
export class IntegrationError extends Error {
	constructor(
		message: string,
		public status?: number,
		public statusText?: string,
	) {
		super(message);
		this.name = "IntegrationError";
	}
}
