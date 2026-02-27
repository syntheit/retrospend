import { adminRouter } from "~/server/api/routers/admin";
import { authRouter } from "~/server/api/routers/auth";
import { budgetRouter } from "~/server/api/routers/budget";
import { categoriesRouter } from "~/server/api/routers/categories";
import { dashboardRouter } from "~/server/api/routers/dashboard";
import { exchangeRateRouter } from "~/server/api/routers/exchange-rate";
import { expenseRouter } from "~/server/api/routers/expense";
import { exportRouter } from "~/server/api/routers/export";
import { inviteRouter } from "~/server/api/routers/invite";
import { preferencesRouter } from "~/server/api/routers/preferences";
import { profileRouter } from "~/server/api/routers/profile";
import { recurringRouter } from "~/server/api/routers/recurring";
import { settingsRouter } from "~/server/api/routers/settings";
import { statsRouter } from "~/server/api/routers/stats";
import { systemRouter } from "~/server/api/routers/system";
import { userRouter } from "~/server/api/routers/user";
import { wealthRouter } from "~/server/api/routers/wealth";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
	admin: adminRouter,
	auth: authRouter,
	budget: budgetRouter,
	categories: categoriesRouter,
	dashboard: dashboardRouter,
	user: userRouter,
	expense: expenseRouter,
	exchangeRate: exchangeRateRouter,
	exportData: exportRouter,
	invite: inviteRouter,
	recurring: recurringRouter,
	settings: settingsRouter,
	profile: profileRouter,
	preferences: preferencesRouter,
	system: systemRouter,
	wealth: wealthRouter,
	stats: statsRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 */
export const createCaller = createCallerFactory(appRouter);
