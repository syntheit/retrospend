import { useServerConnection } from "@/auth/server-connection";
import type { Face } from "@/ui/Avatar";

/** An image address the phone can load: the server sends paths, not hosts. */
export function absoluteImage(
	imageUrl: string | null | undefined,
	baseUrl: string | null,
): string | null {
	if (!imageUrl) return null;
	if (/^https?:\/\//.test(imageUrl)) return imageUrl;
	return baseUrl ? `${baseUrl.replace(/\/$/, "")}${imageUrl}` : null;
}

/** Builds faces for people the server sent (`key` or `id` names them). */
export function useFaces() {
	const { connection } = useServerConnection();
	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;
	return (
		people: { key: string; name: string; imageUrl: string | null }[],
	): Face[] =>
		people.map((p) => ({
			key: p.key,
			name: p.name,
			imageUri: absoluteImage(p.imageUrl, baseUrl),
		}));
}
