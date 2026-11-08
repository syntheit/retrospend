package tasks

import (
	"testing"
	"time"
)

func zone(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

func instant(s string) time.Time {
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return v
}

func iso(v time.Time) string { return v.UTC().Format(time.RFC3339) }

func monthly(direction string, anchor *int) RecurringTemplate {
	return RecurringTemplate{Direction: direction, Frequency: "MONTHLY", AnchorDay: anchor}
}

// Hand-derived: Auckland is UTC+13 until 2027-04-04 (NZDT) and UTC+12 after,
// so local midnight is 11:00Z the evening before in summer, 12:00Z in winter.
func TestNextDueAucklandKeepsAnchor31(t *testing.T) {
	loc := zone(t, "Pacific/Auckland")
	// Jan 31 local midnight is 2027-01-30T11:00Z, which a UTC reader calls day 30.
	due := instant("2027-01-30T11:00:00Z")
	tpl := monthly("OUT", nil)
	anchor := dueAnchorDay(tpl, due, loc)
	if anchor != 31 {
		t.Fatalf("anchor: got %d, want 31", anchor)
	}
	tpl.AnchorDay = &anchor
	steps := []struct{ want, local string }{
		{"2027-02-27T11:00:00Z", "2027-02-28 00:00"},
		{"2027-03-30T11:00:00Z", "2027-03-31 00:00"},
		{"2027-04-29T12:00:00Z", "2027-04-30 00:00"},
	}
	for _, s := range steps {
		due = nextDueAfter(tpl, due, loc)
		if iso(due) != s.want {
			t.Fatalf("got %s, want %s", iso(due), s.want)
		}
		if got := due.In(loc).Format("2006-01-02 15:04"); got != s.local {
			t.Fatalf("local day: got %s, want %s", got, s.local)
		}
	}
}

func TestNextDueBuenosAiresUnchanged(t *testing.T) {
	loc := zone(t, "America/Argentina/Buenos_Aires")
	// UTC-3 all year: Jan 31 midnight local is 03:00Z.
	due := instant("2027-01-31T03:00:00Z")
	tpl := monthly("OUT", nil)
	anchor := dueAnchorDay(tpl, due, loc)
	if anchor != 31 {
		t.Fatalf("anchor: got %d", anchor)
	}
	tpl.AnchorDay = &anchor
	for _, want := range []string{"2027-02-28T03:00:00Z", "2027-03-31T03:00:00Z", "2027-04-30T03:00:00Z"} {
		due = nextDueAfter(tpl, due, loc)
		if iso(due) != want {
			t.Fatalf("got %s, want %s", iso(due), want)
		}
	}
}

// Chile skips midnight on the first Sunday of September: 2027-09-05 00:00
// does not exist, the day starts at 01:00 -03 (04:00Z). Winter is UTC-4.
func TestNextDueSantiagoDSTGap(t *testing.T) {
	loc := zone(t, "America/Santiago")
	due := instant("2027-08-05T04:00:00Z") // Aug 5, 00:00 -04
	got := nextDueAfter(monthly("OUT", nil), due, loc)
	if iso(got) != "2027-09-05T04:00:00Z" {
		t.Fatalf("got %s, want 2027-09-05T04:00:00Z (01:00 local)", iso(got))
	}
	if l := got.In(loc).Format("2006-01-02 15:04"); l != "2027-09-05 01:00" {
		t.Fatalf("local: %s", l)
	}
	// From the gap day the next step is back on a real midnight (-03 now).
	next := nextDueAfter(monthly("OUT", nil), got, loc)
	if iso(next) != "2027-10-05T03:00:00Z" {
		t.Fatalf("got %s, want 2027-10-05T03:00:00Z", iso(next))
	}
}

func TestNextDueNewYorkAcrossDST(t *testing.T) {
	loc := zone(t, "America/New_York")
	// Weekly over the March 14 2027 spring forward: Mar 10 05:00Z (EST) to
	// Mar 17 04:00Z (EDT), both local midnight.
	week := RecurringTemplate{Direction: "OUT", Frequency: "WEEKLY"}
	if got := nextDueAfter(week, instant("2027-03-10T05:00:00Z"), loc); iso(got) != "2027-03-17T04:00:00Z" {
		t.Fatalf("weekly: got %s", iso(got))
	}
	// Monthly Mar 1 EST to Apr 1 EDT.
	if got := nextDueAfter(monthly("OUT", nil), instant("2027-03-01T05:00:00Z"), loc); iso(got) != "2027-04-01T04:00:00Z" {
		t.Fatalf("monthly: got %s", iso(got))
	}
	// Biweekly over the fall back (Nov 7 2027): Oct 27 04:00Z (EDT) to Nov 10 05:00Z (EST).
	two := RecurringTemplate{Direction: "OUT", Frequency: "BIWEEKLY"}
	if got := nextDueAfter(two, instant("2027-10-27T04:00:00Z"), loc); iso(got) != "2027-11-10T05:00:00Z" {
		t.Fatalf("biweekly: got %s", iso(got))
	}
}

func TestNextDueYearlyAndQuarterlyInZone(t *testing.T) {
	loc := zone(t, "Pacific/Auckland")
	// Feb 29 2028 local midnight (NZDT) is 2028-02-28T11:00Z; a year on clamps to Feb 28.
	feb29 := 29
	yearly := RecurringTemplate{Direction: "OUT", Frequency: "YEARLY", AnchorDay: &feb29}
	if got := nextDueAfter(yearly, instant("2028-02-28T11:00:00Z"), loc); iso(got) != "2029-02-27T11:00:00Z" {
		t.Fatalf("yearly: got %s", iso(got))
	}
	// Nov 30 2026 (NZDT) plus 3 months with anchor 30 is Feb 28 2027.
	thirty := 30
	q := RecurringTemplate{Direction: "OUT", Frequency: "QUARTERLY", AnchorDay: &thirty}
	if got := nextDueAfter(q, instant("2026-11-29T11:00:00Z"), loc); iso(got) != "2027-02-27T11:00:00Z" {
		t.Fatalf("quarterly: got %s", iso(got))
	}
}

// Income is a calendar day stored as UTC midnight and steps as UTC days
// whatever zone the user is in.
func TestNextDueIncomeStepsUTCDays(t *testing.T) {
	loc := zone(t, "Pacific/Auckland")
	due := instant("2027-01-31T00:00:00Z")
	tpl := monthly("IN", nil)
	anchor := dueAnchorDay(tpl, due, loc)
	if anchor != 31 {
		t.Fatalf("income anchor: got %d, want 31 (UTC day)", anchor)
	}
	tpl.AnchorDay = &anchor
	for _, want := range []string{"2027-02-28T00:00:00Z", "2027-03-31T00:00:00Z", "2027-04-30T00:00:00Z"} {
		due = nextDueAfter(tpl, due, loc)
		if iso(due) != want {
			t.Fatalf("got %s, want %s", iso(due), want)
		}
	}
	week := RecurringTemplate{Direction: "IN", Frequency: "WEEKLY"}
	if got := nextDueAfter(week, instant("2027-03-05T00:00:00Z"), zone(t, "America/New_York")); iso(got) != "2027-03-12T00:00:00Z" {
		t.Fatalf("weekly income: got %s", iso(got))
	}
}

// Without a stored anchor the day is read from the due date in the zone: a
// UTC reader sees Jan 30 here and would land the week on Feb 6.
func TestNextDueAucklandWithoutAnchorReadsLocalDay(t *testing.T) {
	loc := zone(t, "Pacific/Auckland")
	due := instant("2027-01-30T11:00:00Z") // Jan 31 00:00 local
	week := RecurringTemplate{Direction: "OUT", Frequency: "WEEKLY"}
	if got := nextDueAfter(week, due, loc); iso(got) != "2027-02-06T11:00:00Z" {
		t.Fatalf("weekly: got %s, want Feb 7 local (2027-02-06T11:00:00Z)", iso(got))
	}
	if got := nextDueAfter(monthly("OUT", nil), due, loc); iso(got) != "2027-02-27T11:00:00Z" {
		t.Fatalf("monthly: got %s, want Feb 28 local (2027-02-27T11:00:00Z)", iso(got))
	}
}

// pgx writes a timestamp-without-zone parameter from the value's own wall
// clock, so a result carrying a zone would be stored shifted.
func TestNextDueIsUTC(t *testing.T) {
	got := nextDueAfter(monthly("OUT", nil), instant("2027-01-30T11:00:00Z"), zone(t, "Pacific/Auckland"))
	if got.Location() != time.UTC {
		t.Fatalf("got location %v, want UTC", got.Location())
	}
}

func TestDueAnchorDayStoredWins(t *testing.T) {
	loc := zone(t, "Pacific/Auckland")
	stored := 15
	tpl := RecurringTemplate{Direction: "OUT", AnchorDay: &stored}
	if got := dueAnchorDay(tpl, instant("2027-01-30T11:00:00Z"), loc); got != 15 {
		t.Fatalf("got %d, want stored 15", got)
	}
}

func TestResolveZoneDefaults(t *testing.T) {
	name := func(stored *string, env string) string { return resolveZone(stored, env).String() }
	tokyo, junk, empty, local, utc := "Asia/Tokyo", "Mars/Olympus_Mons", "", "Local", "UTC"
	cases := []struct {
		label  string
		stored *string
		env    string
		want   string
	}{
		{"stored wins", &tokyo, "Europe/Paris", "Asia/Tokyo"},
		{"unset uses DEFAULT_TIME_ZONE", nil, "Europe/Paris", "Europe/Paris"},
		{"unset and no env uses Buenos Aires", nil, "", "America/Argentina/Buenos_Aires"},
		{"unknown stored zone uses the default", &junk, "", "America/Argentina/Buenos_Aires"},
		{"empty stored zone with a bad env uses Buenos Aires", &empty, "Not/AZone", "America/Argentina/Buenos_Aires"},
		{"Local is not a user zone", &local, "", "America/Argentina/Buenos_Aires"},
		{"UTC is allowed", &utc, "Europe/Paris", "UTC"},
	}
	for _, c := range cases {
		if got := name(c.stored, c.env); got != c.want {
			t.Errorf("%s: got %s, want %s", c.label, got, c.want)
		}
	}
}
