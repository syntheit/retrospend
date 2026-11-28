/**
 * Create and edit for the web's tRPC router: the same mutations /api/v1 runs,
 * applied as the signed-in user. The web names no client id and no
 * expectedVersion (its sheet re-reads on save), so neither is passed here.
 */
import type { db as globalDb } from "~/server/db";
import { getCategory } from "../category.service";
import { forUser } from "../preview";
import {
	type CreateCategoryInput,
	createCategoryWrite,
} from "./create.mutation";
import { type EditCategoryInput, editCategory } from "./edit.mutation";

export async function createCategoryAs(
	userId: string,
	input: CreateCategoryInput,
) {
	return (await forUser(userId).apply(createCategoryWrite, input)).value
		.category;
}

/**
 * An edit that names nothing writes nothing (no version, no event, no undo):
 * the web's sheet may save with no change, and the category is read as it is.
 */
export async function editCategoryAs(
	db: typeof globalDb,
	userId: string,
	input: EditCategoryInput,
) {
	if (Object.values(input.changes).every((value) => value === undefined))
		return getCategory(db, userId, input.id);
	return (await forUser(userId).apply(editCategory, input)).value.category;
}
