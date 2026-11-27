/**
 * Whether a save renames the category: the name about to be sent is not the
 * stored one. A rename is a new version of the category on the server, so a
 * save that changes something else leaves `name` out (the server never
 * compares names), and a device's pending edit does not park because of it.
 */
export function nameChanged(stored: string | undefined, next: string): boolean {
	return stored === undefined || stored !== next;
}
