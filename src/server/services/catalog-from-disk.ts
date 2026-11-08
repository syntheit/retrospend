import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { assembleCatalog, type MessageCatalog } from "@retrospend/i18n/catalog";

/**
 * One locale's messages read from packages/i18n/messages, for code that runs
 * in plain Node (the Playwright seed, tsx scripts), where the loader's
 * import.meta.glob does not exist. The app itself never takes this path: Next
 * and Vitest use @retrospend/i18n/load. Same shape as loadCatalog: the shared
 * file plus each feature file under a namespace named after it.
 */
export async function loadCatalogFromDisk(
	locale: string,
): Promise<MessageCatalog> {
	const root = path.join(
		/* turbopackIgnore: true */ process.cwd(),
		"packages",
		"i18n",
		"messages",
	);
	const read = async (file: string) =>
		JSON.parse(await readFile(file, "utf8")) as MessageCatalog;
	const features: Record<string, MessageCatalog> = {};
	const dir = path.join(root, locale);
	for (const name of await readdir(dir).catch(() => [] as string[])) {
		if (name.endsWith(".json"))
			features[name.slice(0, -".json".length)] = await read(
				path.join(dir, name),
			);
	}
	return assembleCatalog(
		await read(path.join(root, `${locale}.json`)),
		features,
	);
}
