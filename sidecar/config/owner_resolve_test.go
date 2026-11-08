package config

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"
)

const (
	testSuperPassword = "S3cr3t:pa$$/w'rd"
	testSuperURL      = "postgresql://postgres:S3cr3t%3Apa%24%24%2Fw%27rd@db:5432/retro?sslmode=disable"
)

// fakeProbe answers from scripts, one entry per call; the last entry repeats.
type fakeProbe struct {
	superuser     []error // nil error means "reachable"
	isSuper       bool
	roleExists    []bool
	roleErr       error
	states        []fakeState
	roleCalls     int
	stateCalls    int
	stateOwnerURL string
}

type fakeState struct {
	state OwnerState
	err   error
}

// Facts answers both questions of one connection. The role question is only
// asked, and counted, of a superuser session, like the real probe.
func (f *fakeProbe) Facts(context.Context, string) (Facts, error) {
	if len(f.superuser) > 0 {
		err := f.superuser[0]
		if len(f.superuser) > 1 {
			f.superuser = f.superuser[1:]
		}
		if err != nil {
			return Facts{}, err
		}
	}
	facts := Facts{Superuser: f.isSuper}
	if !f.isSuper {
		return facts, nil
	}
	f.roleCalls++
	if f.roleErr != nil {
		facts.RoleErr = f.roleErr
		return facts, nil
	}
	i := f.roleCalls - 1
	if i >= len(f.roleExists) {
		i = len(f.roleExists) - 1
	}
	if i >= 0 {
		facts.RoleExists = f.roleExists[i]
	}
	return facts, nil
}

func (f *fakeProbe) OwnerState(_ context.Context, ownerURL string) (OwnerState, error) {
	f.stateOwnerURL = ownerURL
	i := f.stateCalls
	f.stateCalls++
	if i >= len(f.states) {
		i = len(f.states) - 1
	}
	return f.states[i].state, f.states[i].err
}

type harness struct {
	opts  OwnerOptions
	logs  []string
	slept time.Duration
}

func newHarness(probe *fakeProbe) *harness {
	h := &harness{}
	clock := time.Date(2026, 11, 8, 12, 0, 0, 0, time.UTC)
	h.opts = OwnerOptions{
		RoleWait:  2 * time.Minute,
		ReadyWait: 5 * time.Minute,
		Poll:      5 * time.Second,
		Logf:      func(format string, args ...any) { h.logs = append(h.logs, fmt.Sprintf(format, args...)) },
		Probe:     probe,
		Sleep: func(d time.Duration) {
			clock = clock.Add(d)
			h.slept += d
		},
		Now: func() time.Time { return clock },
	}
	return h
}

func (h *harness) logText() string { return strings.Join(h.logs, "\n") }

func ownerPasswordOf(t *testing.T, raw string) string {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil || u.User.Username() != OwnerRole {
		t.Fatalf("not an owner URL: %q (%v)", raw, err)
	}
	p, _ := u.User.Password()
	return p
}

func TestResolveUsesANonSuperuserURLAsGiven(t *testing.T) {
	probe := &fakeProbe{isSuper: false}
	h := newHarness(probe)
	got, err := ResolveOwnerURL(context.Background(), "postgresql://app:pw@db/retro", h.opts)
	if err != nil || got != "postgresql://app:pw@db/retro" {
		t.Fatalf("got %q, %v", got, err)
	}
	if probe.roleCalls != 0 || probe.stateCalls != 0 {
		t.Fatal("asked about the owner role for a URL that is not a superuser's")
	}
}

// Nothing to derive from, and no owner role: the sidecar has nothing else to
// connect with, so it keeps the URL as given, says so, and does not wait.
func TestResolvePasswordlessSuperuserWithNoOwnerRoleFallsBackWithAWarning(t *testing.T) {
	probe := &fakeProbe{isSuper: true, roleExists: []bool{false}}
	h := newHarness(probe)
	got, err := ResolveOwnerURL(context.Background(), "postgresql://postgres@db/retro", h.opts)
	if err != nil || got != "postgresql://postgres@db/retro" {
		t.Fatalf("got %q, %v", got, err)
	}
	if !strings.Contains(h.logText(), "WARNING") || probe.roleCalls != 1 || h.slept != 0 {
		t.Fatalf("want a warning, one role check and no wait; calls %d, slept %s, logs: %s", probe.roleCalls, h.slept, h.logText())
	}
	if probe.stateCalls != 0 {
		t.Fatal("signed in as an owner it cannot name")
	}
}

// The owner role exists (the app made it, with a password this container
// cannot derive): a superuser session must not run, because the owner owns
// the tables and can plant triggers. The container stops with a clear message.
func TestResolvePasswordlessSuperuserWithTheOwnerRolePresentExits(t *testing.T) {
	for name, url := range map[string]string{
		"no password":       "postgresql://postgres@db/retro",
		"unreadable escape": "postgresql://postgres:ab%zz@db/retro",
	} {
		t.Run(name, func(t *testing.T) {
			probe := &fakeProbe{isSuper: true, roleExists: []bool{true}}
			h := newHarness(probe)
			got, err := ResolveOwnerURL(context.Background(), url, h.opts)
			if !errors.Is(err, ErrOwnerUnusable) || got != "" {
				t.Fatalf("want ErrOwnerUnusable and no URL, got %q, %v", got, err)
			}
			for _, want := range []string{"retrospend_owner", "DATABASE_OWNER_PASSWORD"} {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("message does not name %s: %v", want, err)
				}
			}
			if strings.Contains(err.Error(), "postgresql://") || strings.Contains(err.Error(), "ab%zz") {
				t.Errorf("message holds the URL: %v", err)
			}
			if probe.stateCalls != 0 {
				t.Fatal("tried to sign in without a password")
			}
		})
	}
}

// A failed role check in the no-password case is retried, never read as
// "role missing" (which would fall back to the superuser).
func TestResolvePasswordlessSuperuserDoesNotFallBackOnAFailedRoleCheck(t *testing.T) {
	probe := &fakeProbe{isSuper: true, roleErr: errors.New("connection reset")}
	h := newHarness(probe)
	got, err := ResolveOwnerURL(context.Background(), "postgresql://postgres@db/retro", h.opts)
	if err == nil || got != "" {
		t.Fatalf("got %q, %v", got, err)
	}
}

// Characters pgx and Node accept unencoded but net/url rejects must derive an
// owner URL, not drop to the superuser.
func TestResolveDerivesFromAnUnencodedPassword(t *testing.T) {
	const superPassword = `a{b}|"[x]pässwörd`
	rawURL := "postgresql://postgres:" + superPassword + "@db:5432/retro?sslmode=disable"
	probe := &fakeProbe{isSuper: true, roleExists: []bool{true}, states: []fakeState{{}}}
	h := newHarness(probe)
	got, err := ResolveOwnerURL(context.Background(), rawURL, h.opts)
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := parseURL(got)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.User != OwnerRole || cfg.Password != DeriveOwnerPassword(superPassword) || cfg.Host != "db" || cfg.Database != "retro" {
		t.Fatalf("owner URL reads as user %q host %q db %q", cfg.User, cfg.Host, cfg.Database)
	}
	if strings.Contains(got, "{") || strings.Contains(got, "pässwörd") {
		t.Fatalf("owner URL still holds the superuser's password: %q", got)
	}
}

func TestResolveWithAnOverrideDerivesNothing(t *testing.T) {
	probe := &fakeProbe{isSuper: true, roleExists: []bool{true}, states: []fakeState{{}}}
	h := newHarness(probe)
	h.opts.OwnerPassword = "my-own-secret"
	got, err := ResolveOwnerURL(context.Background(), "postgresql://postgres@db/retro", h.opts)
	if err != nil {
		t.Fatal(err)
	}
	if ownerPasswordOf(t, got) != "my-own-secret" {
		t.Fatalf("override not used: %q", got)
	}
}

func TestResolveDerivesTheOwnerURLAndWaitsForTheHandover(t *testing.T) {
	probe := &fakeProbe{
		isSuper:    true,
		roleExists: []bool{false, false, true},
		states: []fakeState{
			{err: errors.New("password authentication failed")},
			{state: OwnerState{Pending: 12}},
			{state: OwnerState{Pending: 1}},
			{state: OwnerState{Pending: 0}},
		},
	}
	h := newHarness(probe)
	got, err := ResolveOwnerURL(context.Background(), testSuperURL, h.opts)
	if err != nil {
		t.Fatal(err)
	}
	if want := DeriveOwnerPassword(testSuperPassword); ownerPasswordOf(t, got) != want {
		t.Fatalf("owner URL %q does not carry the derived password", got)
	}
	if probe.stateOwnerURL != got {
		t.Fatal("the URL checked is not the URL returned")
	}
	if probe.stateCalls != 4 {
		t.Fatalf("expected 4 readiness checks, got %d", probe.stateCalls)
	}
	// 2 polls for the role, 3 for the sign-in and the handover.
	if h.slept != 5*5*time.Second {
		t.Fatalf("slept %s", h.slept)
	}
	if strings.Contains(h.logText(), testSuperPassword) || strings.Contains(h.logText(), DeriveOwnerPassword(testSuperPassword)) {
		t.Fatalf("a password reached the log:\n%s", h.logText())
	}
	for _, line := range h.logs {
		if strings.Contains(line, "postgresql://") {
			t.Fatalf("a URL reached the log: %s", line)
		}
	}
}

func TestResolveFallsBackOnlyWhenTheOwnerRoleNeverAppears(t *testing.T) {
	probe := &fakeProbe{isSuper: true, roleExists: []bool{false}}
	h := newHarness(probe)
	got, err := ResolveOwnerURL(context.Background(), testSuperURL, h.opts)
	if err != nil || got != testSuperURL {
		t.Fatalf("got %q, %v", got, err)
	}
	if h.slept != h.opts.RoleWait {
		t.Fatalf("waited %s, want the whole %s", h.slept, h.opts.RoleWait)
	}
	if probe.stateCalls != 0 {
		t.Fatal("tried to sign in as a role that does not exist")
	}
	if !strings.Contains(h.logText(), "WARNING: the retrospend_owner role does not exist") {
		t.Fatalf("no loud warning:\n%s", h.logText())
	}
}

func TestResolveNeverFallsBackOnATimeoutOnceTheRoleExists(t *testing.T) {
	cases := map[string][]fakeState{
		"cannot sign in":            {{err: errors.New("password authentication failed")}},
		"handover not finished":     {{state: OwnerState{Pending: 3}}},
		"owner role is a superuser": {{state: OwnerState{Superuser: true}}},
	}
	for name, states := range cases {
		t.Run(name, func(t *testing.T) {
			probe := &fakeProbe{isSuper: true, roleExists: []bool{true}, states: states}
			h := newHarness(probe)
			got, err := ResolveOwnerURL(context.Background(), testSuperURL, h.opts)
			if !errors.Is(err, ErrOwnerNotReady) {
				t.Fatalf("want ErrOwnerNotReady, got %q, %v", got, err)
			}
			if got != "" {
				t.Fatalf("returned a URL on failure: %q", got)
			}
			if h.slept != h.opts.ReadyWait {
				t.Fatalf("waited %s, want %s", h.slept, h.opts.ReadyWait)
			}
		})
	}
}

func TestResolveTreatsAFailedRoleCheckAsNotKnown(t *testing.T) {
	probe := &fakeProbe{isSuper: true, roleErr: errors.New("connection reset")}
	h := newHarness(probe)
	got, err := ResolveOwnerURL(context.Background(), testSuperURL, h.opts)
	if err == nil || got != "" {
		t.Fatalf("a failed check must not read as 'role missing': %q, %v", got, err)
	}
}

// A superuser session must not read app tables (the owner can plant a trigger
// or function that runs with the superuser's rights), so every query this
// package sends names only pg_catalog relations and its own CTEs.
func TestOwnerQueriesTouchOnlyCatalogs(t *testing.T) {
	relation := regexp.MustCompile(`(?i)\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_.]*)`)
	allowed := map[string]bool{"schemas": true, "owner": true}
	for name, sql := range map[string]string{
		"isSuperuser":     isSuperuserSQL,
		"roleExists":      roleExistsSQL,
		"pendingHandover": pendingHandoverSQL,
	} {
		matches := relation.FindAllStringSubmatch(sql, -1)
		if len(matches) == 0 {
			t.Fatalf("%s: found no relations to check", name)
		}
		for _, m := range matches {
			if !strings.HasPrefix(m[1], "pg_catalog.") && !allowed[m[1]] {
				t.Errorf("%s reads %s, which is not a catalog", name, m[1])
			}
		}
		if strings.Contains(sql, "_prisma_migrations") {
			t.Errorf("%s reads an app table", name)
		}
	}
}

func TestResolveWaitsForTheDatabaseToAnswer(t *testing.T) {
	probe := &fakeProbe{
		superuser:  []error{errors.New("connection refused"), errors.New("connection refused"), nil},
		isSuper:    true,
		roleExists: []bool{true},
		states:     []fakeState{{}},
	}
	h := newHarness(probe)
	if _, err := ResolveOwnerURL(context.Background(), testSuperURL, h.opts); err != nil {
		t.Fatal(err)
	}
	if h.slept != 2*h.opts.Poll {
		t.Fatalf("slept %s", h.slept)
	}

	down := &fakeProbe{superuser: []error{errors.New("connection refused")}}
	h = newHarness(down)
	if got, err := ResolveOwnerURL(context.Background(), testSuperURL, h.opts); err == nil || got != "" {
		t.Fatalf("a database that never answers is an error, not a fallback: %q, %v", got, err)
	}
}
