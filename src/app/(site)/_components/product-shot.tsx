import Image from "next/image";
import { useTranslations } from "next-intl";

export type ShotName = "home" | "budget" | "people" | "wealth";

/**
 * A screenshot of the real app (public/images/shots, taken from the e2e seed in both
 * themes). The page's theme picks the file: the landing page is always dark,
 * the docs follow the reader.
 */
export function ProductShot({ name }: { name: ShotName }) {
	const t = useTranslations("productShots");
	const alt = t(name);
	return (
		<figure className="border-line rounded-panel overflow-hidden border">
			<Image
				alt={alt}
				className="block h-auto w-full dark:hidden"
				height={900}
				src={`/images/shots/${name}-light.webp`}
				width={1440}
			/>
			<Image
				alt={alt}
				className="hidden h-auto w-full dark:block"
				height={900}
				src={`/images/shots/${name}-dark.webp`}
				width={1440}
			/>
		</figure>
	);
}
