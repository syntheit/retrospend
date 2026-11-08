package tasks

import (
	"os"
	"time"
	_ "time/tzdata" // zone data in the binary: the alpine runtime image ships none
)

// fallbackTimeZone is the zone when a user has none stored and
// DEFAULT_TIME_ZONE is unset. Mirrors FALLBACK_TIME_ZONE in
// src/server/services/user-time-zone.ts.
const fallbackTimeZone = "America/Argentina/Buenos_Aires"

// loadZone is the IANA zone called name, or nil. "Local" and the empty name
// are not user zones: LoadLocation would read the process zone or UTC.
func loadZone(name string) *time.Location {
	if name == "" || name == "Local" || len(name) > 64 {
		return nil
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil
	}
	return loc
}

// resolveZone is the zone a user's due dates are stored in: their saved zone
// (user.timeZone), else DEFAULT_TIME_ZONE, else Buenos Aires. Mirrors
// resolveTimeZone in src/server/services/user-time-zone.ts without a request
// zone: a background job has none, and never uses the process zone.
func resolveZone(stored *string, defaultName string) *time.Location {
	if stored != nil {
		if loc := loadZone(*stored); loc != nil {
			return loc
		}
	}
	if loc := loadZone(defaultName); loc != nil {
		return loc
	}
	return loadZone(fallbackTimeZone)
}

// defaultZoneName is DEFAULT_TIME_ZONE, read the way the web server reads it.
func defaultZoneName() string { return os.Getenv("DEFAULT_TIME_ZONE") }

// startOfWallDay is the first instant of the calendar day y-m-d in loc
// (out-of-range parts roll over like time.Date). Where DST skips local
// midnight (Santiago, Havana) that is the first valid time of the day, 01:00,
// never the evening before. The result is in UTC: the due date columns are
// timestamp without time zone, and pgx writes such a value's wall clock in
// whatever location it carries, so a zoned time would be stored shifted.
// Mirrors startOfWallDayIn in
// packages/domain/src/time-zone.ts.
func startOfWallDay(year int, month time.Month, day int, loc *time.Location) time.Time {
	target := time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
	dayOf := func(t time.Time) time.Time {
		y, m, d := t.In(loc).Date()
		return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	}
	candidate := time.Date(target.Year(), target.Month(), target.Day(), 0, 0, 0, 0, loc)
	if !dayOf(candidate).Before(target) {
		return candidate.UTC()
	}
	// Midnight is skipped: search the minutes after it for the day's first.
	lo, hi := candidate.Unix()/60, candidate.Unix()/60+6*60
	for hi-lo > 1 {
		mid := (lo + hi) / 2
		if dayOf(time.Unix(mid*60, 0)).Before(target) {
			lo = mid
		} else {
			hi = mid
		}
	}
	return time.Unix(hi*60, 0).UTC()
}

// nextRecurringDate steps current as calendar days in loc and returns the
// first instant of the result day, so no time of day drifts across steps.
// Month-based frequencies land on anchorDay (default: current's own day in
// loc) or the month's last day. Mirrors nextRecurringDate in
// packages/domain/src/recurring.ts.
func nextRecurringDate(current time.Time, frequency string, anchorDay *int, loc *time.Location) time.Time {
	year, month, day := current.In(loc).Date()
	switch frequency {
	case "WEEKLY":
		return startOfWallDay(year, month, day+7, loc)
	case "BIWEEKLY":
		return startOfWallDay(year, month, day+14, loc)
	case "MONTHLY":
		return onMonthsLater(year, month, day, 1, anchorDay, loc)
	case "QUARTERLY":
		return onMonthsLater(year, month, day, 3, anchorDay, loc)
	case "YEARLY":
		return onMonthsLater(year, month, day, 12, anchorDay, loc)
	}
	return current
}

func onMonthsLater(year int, month time.Month, day, months int, anchorDay *int, loc *time.Location) time.Time {
	if anchorDay != nil {
		day = *anchorDay
	}
	lastDay := time.Date(year, month+time.Month(months)+1, 0, 0, 0, 0, 0, time.UTC).Day()
	return startOfWallDay(year, month+time.Month(months), min(day, lastDay), loc)
}

// nextDueAfter is the due date after from: income (IN) is a calendar day
// stored as UTC midnight and steps UTC days, an expense steps days in loc.
// Mirrors nextDueAfter in src/server/services/income/due-day.ts.
func nextDueAfter(t RecurringTemplate, from time.Time, loc *time.Location) time.Time {
	if t.Direction == "IN" {
		anchor := dueAnchorDay(t, from, loc)
		return nextRecurringDate(from, t.Frequency, &anchor, time.UTC)
	}
	return nextRecurringDate(from, t.Frequency, t.AnchorDay, loc)
}

// dueAnchorDay is the day of month the template is anchored to: the stored
// one, else the day its due date is stored as (UTC for income, loc for an
// expense). Mirrors dueAnchorDay in src/server/services/income/due-day.ts.
func dueAnchorDay(t RecurringTemplate, nextDue time.Time, loc *time.Location) int {
	if t.AnchorDay != nil {
		return *t.AnchorDay
	}
	if t.Direction == "IN" {
		return nextDue.UTC().Day()
	}
	return nextDue.In(loc).Day()
}
