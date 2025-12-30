import { adminRouter } from "~/server/api/routers/admin";
import { budgetRouter } from "~/server/api/routers/budget";
import { dashboardRouter } from "~/server/api/routers/dashboard";
import { exchangeRateRouter } from "~/server/api/routers/exchange-rate";
import { expenseRouter } from "~/server/api/routers/expense";
import { inviteRouter } from "~/server/api/routers/invite";
import { settingsRouter } from "~/server/api/routers/settings";
import { userRouter } from "~/server/api/routers/user";
import { wealthRouter } from "~/server/api/routers/wealth";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
	admin: adminRouter,
	budget: budgetRouter,
	dashboard: dashboardRouter,
	user: userRouter,
	expense: expenseRouter,
	exchangeRate: exchangeRateRouter,
	invite: inviteRouter,
	settings: settingsRouter,
	wealth: wealthRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 */
export const createCaller = createCallerFactory(appRouter);
