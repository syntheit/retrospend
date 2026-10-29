import { useServerBaseUrl } from "@/auth/server-connection";
import { absoluteImage } from "@/features/read/faces";
import { useTheme } from "@/theme";
import { Avatar, type Face as AvatarFace, type AvatarSize } from "@/ui/Avatar";

/**
 * A person's face for the screens that know a size in points: their picture
 * (a path the server sends loads from the server), else initials on one of
 * the avatar colors. It draws the shared Avatar at the avatar size nearest
 * to `diameter`, so a face is the same face everywhere.
 */
export function Face({
	name,
	seed,
	imageUrl,
	diameter,
}: {
	name: string;
	seed: string;
	imageUrl?: string | null;
	diameter: number;
}) {
	const { size } = useTheme();
	const base = useServerBaseUrl();
	const keys = Object.keys(size.avatar) as AvatarSize[];
	const nearest = keys.reduce((best, key) =>
		Math.abs(size.avatar[key] - diameter) <
		Math.abs(size.avatar[best] - diameter)
			? key
			: best,
	);
	return (
		<Avatar
			face={{ key: seed, name, imageUri: absoluteImage(imageUrl, base) }}
			size={nearest}
		/>
	);
}

/**
 * Builds shared-Avatar faces for the people the composer names, with their
 * pictures loading from the server. Like Face, it works with no server
 * connection around it (a picture is then left out, never an error).
 */
export function usePersonFaces() {
	const base = useServerBaseUrl();
	return (
		people: { key: string; name: string; imageUrl?: string | null }[],
	): AvatarFace[] =>
		people.map((p) => ({
			key: p.key,
			name: p.name,
			imageUri: absoluteImage(p.imageUrl, base),
		}));
}
