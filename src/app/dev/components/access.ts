/**
 * Who may open the gallery: everyone in development (the proxy already asks
 * for a session), only admins in production. Everyone else gets a 404, so
 * production does not even reveal that the page exists.
 */
export function canSeeGallery(
	env: string | undefined,
	role: string | null | undefined,
): boolean {
	if (env !== "production") return true;
	return role === "ADMIN";
}
