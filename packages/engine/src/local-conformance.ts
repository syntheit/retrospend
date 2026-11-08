/** Every conformance case for local writes: the repositories, then undo and preview. */

import { childCases } from "./child-conformance";
import type { ConformanceCase } from "./conformance";
import { repositoryCases } from "./repo-conformance";
import { undoCases } from "./undo-conformance";

export const localWriteCases: ConformanceCase[] = [
	...repositoryCases,
	...undoCases,
	...childCases,
];
