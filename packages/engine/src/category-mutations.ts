/**
 * The category writes as device money mutations, for the preview runner and
 * the Undo sheet: each is the write function LocalDb runs (so a preview is the
 * write). A category moves no figure, as the server's category mutations
 * (category/create.mutation.ts, edit.mutation.ts: `touches: []`);
 * src/server/services/__tests__/category-conformance.pg.test.ts holds each
 * equal to its server mutation.
 */
import {
	CATEGORY_CREATE,
	CATEGORY_UPDATE,
	createCategory,
	updateCategory,
} from "./category-write-local";
import { deviceMutation } from "./preview";

export const CATEGORY_CREATE_MUTATION = deviceMutation({
	id: CATEGORY_CREATE,
	touches: [],
	write: createCategory,
});

export const CATEGORY_UPDATE_MUTATION = deviceMutation({
	id: CATEGORY_UPDATE,
	touches: [],
	write: updateCategory,
});
