# Retrospend T3 Architecture Rules

You are operating in a mature T3 Stack environment (Next.js, tRPC, Prisma, Tailwind). You must strictly follow these rules:

## 1. Backend: Controller/Service Pattern

- **PROHIBITED**: Writing business logic, complex data transformations, or raw Prisma logic inside tRPC routers.
- **REQUIRED**: tRPC routers must be thin (Validation & Auth only).
- **REQUIRED**: All database logic must live in `src/server/services/*.service.ts` as pure TypeScript classes. Inject Prisma via the constructor: `constructor(private db: PrismaClient | Prisma.TransactionClient) {}`.

## 2. Data Fetching & Aggregation

- **PROHIBITED**: Fetching large datasets to the client to calculate sums or averages using `useMemo`.
- **REQUIRED**: Use Prisma's native `aggregate` and `groupBy` functions in the service layer. Send only the final computed numbers to the frontend.

## 3. Frontend: Generic & Dumb UI

- **PROHIBITED**: Hardcoding tRPC hooks or Modals directly into core UI components like tables or generic forms.
- **REQUIRED**: Use Inversion of Control. Components like `DataTable` must be strictly presentational. Pass actions and data down via props.

## 4. Type Safety & Constants

- **PROHIBITED**: Using loose magic strings (e.g., "USD" or "blue") in business logic or database schemas.
- **REQUIRED**: Import centralized constants from `src/lib/constants.ts` (e.g., `BASE_CURRENCY`, `CATEGORY_COLORS`). Use `z.enum()` combined with `as const` for strict API boundaries.
