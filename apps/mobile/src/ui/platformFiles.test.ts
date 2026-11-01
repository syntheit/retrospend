import { readdirSync } from "node:fs";

/** Metro's source extensions, in the order it tries them. */
const EXTS = ["js", "jsx", "ts", "tsx"];

/**
 * Metro walks the source extensions one at a time and, for each, tries the
 * platform file and then the plain file. A plain `X.ts` therefore wins over
 * `X.android.tsx` (".ts" comes before ".tsx"), and Android silently runs the
 * iOS code. A platform twin may not sit beside a plain file whose extension
 * Metro tries first.
 */
describe("platform files", () => {
	it("are not hidden by a plain file with an earlier extension", () => {
		const files = readdirSync(__dirname);
		const clashes: string[] = [];
		for (const file of files) {
			const twin = /^(.*)\.(ios|android)\.(js|jsx|ts|tsx)$/.exec(file);
			if (!twin) continue;
			const [, base, , ext] = twin;
			for (const earlier of EXTS.slice(0, EXTS.indexOf(ext as string))) {
				if (files.includes(`${base}.${earlier}`)) clashes.push(file);
			}
		}
		expect(clashes).toEqual([]);
	});
});
