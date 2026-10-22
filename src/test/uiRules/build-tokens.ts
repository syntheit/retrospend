// pnpm ui:tokens: regenerate src/styles/tokens.css and the hex values in
// docs/ui/design.json from design.json. Run it after any token change and
// commit both files. tokens.test.ts fails while either is stale.
import { writeFileSync } from "node:fs";
import {
	buildTokensCss,
	DESIGN_PATH,
	formatDesign,
	loadDesign,
	TOKENS_CSS_PATH,
	withHex,
} from "./tokens";

const design = withHex(loadDesign());
writeFileSync(DESIGN_PATH, formatDesign(design));
writeFileSync(TOKENS_CSS_PATH, buildTokensCss(design));
console.log(
	`wrote ${Object.keys(design.color).length} colors to docs/ui/design.json and src/styles/tokens.css`,
);
