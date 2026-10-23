import * as categories from "~/server/services/api-v1/categories";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const c = v1.categories;

export const categoriesRouter = {
	list: c.list.handler(
		serve(({ context, input }) =>
			categories.listCategoryPage(signedIn(context), input),
		),
	),
	get: c.get.handler(
		serve(({ context, input }) =>
			categories.readCategory(signedIn(context), input.id),
		),
	),
	create: c.create.handler(
		serve(({ context, input }) =>
			categories.addCategory(signedIn(context), input),
		),
	),
	update: c.update.handler(
		serve(({ context, input }) => {
			const { id, ...changes } = input;
			return categories.changeCategory(signedIn(context), id, changes);
		}),
	),
	delete: c.delete.handler(
		serve(({ context, input }) =>
			categories.removeCategory(
				signedIn(context),
				input.id,
				input.uncategorize ?? false,
			),
		),
	),
	merge: c.merge.handler(
		serve(({ context, input }) =>
			categories.mergeCategories(signedIn(context), input.id, input.targetId),
		),
	),
};
