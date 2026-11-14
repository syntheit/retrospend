/**
 * The domain's plain DTO types (packages/domain/src/envelope/dto.ts) against
 * the zod schemas that are the wire contract. `expectTypeOf` checks run in
 * the typecheck (`pnpm typecheck`), which is where a field added on one side
 * only fails; each type must equal its schema's inferred type, so a client
 * built on either reads the same shape.
 */
import type {
	EnvelopeGroupDto as DomainGroup,
	GroupTargetDto as DomainGroupTarget,
	LeftToSpendDto as DomainLeftToSpend,
	OwedDto as DomainOwed,
	OwedSummaryDto as DomainOwedSummary,
	PayoffProjection as DomainPayoff,
	PlanCostDto as DomainPlanCost,
	EnvelopeRowDto as DomainRow,
	EnvelopeTargetDto as DomainTarget,
	VerdictDto as DomainVerdict,
	MissingRateDto,
	MoneyDto,
	MonthViewDto,
} from "@retrospend/domain/envelope/dto";
import type { Frequency } from "@retrospend/domain/envelope/target-input";
import { describe, expectTypeOf, it } from "vitest";
import type { RecurringTemplate } from "~prisma";
import type {
	EnvelopeGroupDto,
	EnvelopeRowDto,
	EnvelopeTargetDto,
	GetMonthOutput,
	GroupTargetDto,
	LeftToSpendDto,
	Money,
	OwedDto,
	OwedSummaryDto,
	VerdictDto,
} from "./envelope";
import type { PayoffProjection } from "./envelope-debt";
import type { PlanCostDto } from "./envelope-plan";

describe("the domain envelope DTO types", () => {
	it("equal the zod schemas' types, both ways", () => {
		expectTypeOf<MoneyDto>().toEqualTypeOf<Money>();
		expectTypeOf<MissingRateDto>().toEqualTypeOf<
			GetMonthOutput["missingRates"][number]
		>();
		expectTypeOf<DomainTarget>().toEqualTypeOf<EnvelopeTargetDto>();
		expectTypeOf<DomainRow>().toEqualTypeOf<EnvelopeRowDto>();
		expectTypeOf<DomainGroupTarget>().toEqualTypeOf<GroupTargetDto>();
		expectTypeOf<DomainGroup>().toEqualTypeOf<EnvelopeGroupDto>();
		expectTypeOf<DomainLeftToSpend>().toEqualTypeOf<LeftToSpendDto>();
		expectTypeOf<DomainVerdict>().toEqualTypeOf<VerdictDto>();
		expectTypeOf<DomainOwedSummary>().toEqualTypeOf<OwedSummaryDto>();
		expectTypeOf<DomainOwed>().toEqualTypeOf<OwedDto>();
		expectTypeOf<MonthViewDto>().toEqualTypeOf<GetMonthOutput>();
		expectTypeOf<DomainPlanCost>().toEqualTypeOf<PlanCostDto>();
		expectTypeOf<DomainPayoff>().toEqualTypeOf<PayoffProjection>();
	});

	it("keeps the recurring frequency the database's", () => {
		expectTypeOf<Frequency>().toEqualTypeOf<RecurringTemplate["frequency"]>();
	});
});
