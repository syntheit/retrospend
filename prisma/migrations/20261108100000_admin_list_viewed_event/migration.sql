-- An admin looking at a list that spans many people (users, event log,
-- feedback, and so on) is one admin audit event, not an entry in anyone's
-- own access log.
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'ADMIN_LIST_VIEWED';
