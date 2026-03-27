import { adminRouter } from "~/server/api/routers/admin";
import { auditLogRouter } from "~/server/api/routers/audit-log";
import { authRouter } from "~/server/api/routers/auth";
import { billingPeriodRouter } from "~/server/api/routers/billingPeriod";
import { budgetRouter } from "~/server/api/routers/budget";
import { categoriesRouter } from "~/server/api/routers/categories";
import { dashboardRouter } from "~/server/api/routers/dashboard";
import { exchangeRateRouter } from "~/server/api/routers/exchange-rate";
import { expenseRouter } from "~/server/api/routers/expense";
import { feedbackRouter } from "~/server/api/routers/feedback";
import { exportRouter } from "~/server/api/routers/export";
import { guestRouter } from "~/server/api/routers/guest";
import { importQueueRouter } from "~/server/api/routers/import-queue";
import { inviteRouter } from "~/server/api/routers/invite";
import { notificationRouter } from "~/server/api/routers/notification";
import { paymentMethodRouter } from "~/server/api/routers/paymentMethod";
import { peopleRouter } from "~/server/api/routers/people";
import { preferencesRouter } from "~/server/api/routers/preferences";
import { profileRouter } from "~/server/api/routers/profile";
import { projectRouter } from "~/server/api/routers/project";
import { recurringRouter } from "~/server/api/routers/recurring";
import { settingsRouter } from "~/server/api/routers/settings";
import { settlementRouter } from "~/server/api/routers/settlement";
import { sharedTransactionRouter } from "~/server/api/routers/shared-transaction";
import { statsRouter } from "~/server/api/routers/stats";
import { systemRouter } from "~/server/api/routers/system";
import { userRouter } from "~/server/api/routers/user";
import { verificationRouter } from "~/server/api/routers/verification";
import { wealthRouter } from "~/server/api/routers/wealth";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
	admin: adminRouter,
	auditLog: auditLogRouter,
	guest: guestRouter,
	auth: authRouter,
	billingPeriod: billingPeriodRouter,
	budget: budgetRouter,
	categories: categoriesRouter,
	dashboard: dashboardRouter,
	user: userRouter,
	expense: expenseRouter,
	feedback: feedbackRouter,
	exchangeRate: exchangeRateRouter,
	exportData: exportRouter,
	importQueue: importQueueRouter,
	invite: inviteRouter,
	recurring: recurringRouter,
	settings: settingsRouter,
	people: peopleRouter,
	project: projectRouter,
	settlement: settlementRouter,
	sharedTransaction: sharedTransactionRouter,
	verification: verificationRouter,
	profile: profileRouter,
	preferences: preferencesRouter,
	system: systemRouter,
	wealth: wealthRouter,
	paymentMethod: paymentMethodRouter,
	notification: notificationRouter,
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
