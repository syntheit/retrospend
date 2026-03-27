-- Performance: composite indexes for common query patterns

-- Expense: dashboard aggregation queries filter on userId + status + date
CREATE INDEX IF NOT EXISTS "expense_userId_status_date_idx" ON "expense" ("userId", "status", "date");

-- Expense: stats queries filter on userId + excludeFromAnalytics + date
CREATE INDEX IF NOT EXISTS "expense_userId_excludeFromAnalytics_date_idx" ON "expense" ("userId", "excludeFromAnalytics", "date");

-- Expense: budget pacing queries filter on userId + isAmortizedParent + date
CREATE INDEX IF NOT EXISTS "expense_userId_isAmortizedParent_date_idx" ON "expense" ("userId", "isAmortizedParent", "date");

-- EventLog: admin panel queries filter on eventType and sort by timestamp
CREATE INDEX IF NOT EXISTS "event_log_eventType_timestamp_idx" ON "event_log" ("eventType", "timestamp");

-- SplitParticipant: covering index for RLS EXISTS subquery and balance lookups
CREATE INDEX IF NOT EXISTS "split_participant_participantType_participantId_transactionId_idx" ON "split_participant" ("participantType", "participantId", "transactionId");

-- Settlement: queries filter on status + participant type/id
CREATE INDEX IF NOT EXISTS "settlement_status_fromParticipantType_fromParticipantId_idx" ON "settlement" ("status", "fromParticipantType", "fromParticipantId");
CREATE INDEX IF NOT EXISTS "settlement_status_toParticipantType_toParticipantId_idx" ON "settlement" ("status", "toParticipantType", "toParticipantId");

-- SharedTransaction: billing period listing with date sort
CREATE INDEX IF NOT EXISTS "shared_transaction_billingPeriodId_date_idx" ON "shared_transaction" ("billingPeriodId", "date");
