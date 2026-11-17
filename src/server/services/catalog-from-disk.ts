import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
	assembleCatalog,
	assembleNamespace,
	type MessageCatalog,
} from "@retrospend/i18n/catalog";

const messagesRoot = () =>
	path.join(
		/* turbopackIgnore: true */ process.cwd(),
		"packages",
		"i18n",
		"messages",
	);

const read = async (file: string) =>
	JSON.parse(await readFile(file, "utf8")) as MessageCatalog;

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
	const root = messagesRoot();
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

/**
 * One namespace of one locale's messages, read like loadNamespace in the
 * Vite and Turbopack loader, by the same rule. Only a missing feature file
 * means the namespace may be in the shared file; a file that cannot be read
 * or parsed throws, as loadCatalogFromDisk does. `root` is for tests.
 */
export async function loadNamespaceFromDisk(
	locale: string,
	namespace: string,
	root = messagesRoot(),
): Promise<MessageCatalog> {
	const shared = await read(path.join(root, `${locale}.json`));
	const feature = await read(
		path.join(root, locale, `${namespace}.json`),
	).catch((error: unknown) => {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	});
	return assembleNamespace(shared, namespace, feature);
}
