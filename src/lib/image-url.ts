export function getImageUrl(path: string | null): string | null {
	if (!path) return null;
	return `/api/images/${path}`;
}
