package config

import (
	"bytes"
	"encoding/json"
	"net/url"
	"os"
	"strings"
	"testing"
)

type ownerVectors struct {
	Role  string `json:"role"`
	Cases []struct {
		Name          string `json:"name"`
		URL           string `json:"url"`
		Password      string `json:"password"`
		OwnerPassword string `json:"ownerPassword"`
	} `json:"cases"`
}

func loadOwnerVectors(t *testing.T, path string) (ownerVectors, []byte) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var v ownerVectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v, raw
}

// The Node side (scripts/db-owner) checks the same file, so a change to either
// derivation fails one of the two suites.
func TestOwnerPasswordVectors(t *testing.T) {
	v, _ := loadOwnerVectors(t, "testdata/owner-vectors.json")
	if v.Role != OwnerRole {
		t.Fatalf("role %q, want %q", v.Role, OwnerRole)
	}
	if len(v.Cases) < 3 {
		t.Fatalf("expected the shared vectors, got %d cases", len(v.Cases))
	}
	for _, c := range v.Cases {
		t.Run(c.Name, func(t *testing.T) {
			password, ok := URLPassword(c.URL)
			if !ok || password != c.Password {
				t.Fatalf("URLPassword = %q, %v; want %q", password, ok, c.Password)
			}
			if got := DeriveOwnerPassword(password); got != c.OwnerPassword {
				t.Fatalf("DeriveOwnerPassword = %s, want %s", got, c.OwnerPassword)
			}
		})
	}
}

// The Docker build context is sidecar/, so the vectors are copied in. This
// keeps the copy equal to the one the Node tests read.
func TestOwnerVectorsCopyMatchesNodeSide(t *testing.T) {
	_, copied := loadOwnerVectors(t, "testdata/owner-vectors.json")
	original, err := os.ReadFile("../../scripts/db-owner/vectors.json")
	if err != nil {
		t.Skipf("scripts/db-owner/vectors.json not found (building outside the repository): %v", err)
	}
	if !bytes.Equal(copied, original) {
		t.Fatal("sidecar/config/testdata/owner-vectors.json differs from scripts/db-owner/vectors.json: copy the file again")
	}
}

func TestURLPasswordRefusesWhatNodeRefuses(t *testing.T) {
	for name, raw := range map[string]string{
		"no password":        "postgresql://postgres@db/retro",
		"empty password":     "postgresql://postgres:@db/retro",
		"bad percent escape": "postgresql://postgres:ab%zz@db/retro",
		"not utf-8":          "postgresql://postgres:%ff%fe@db/retro",
		"no user info":       "postgresql://db/retro",
	} {
		if password, ok := URLPassword(raw); ok {
			t.Errorf("%s: got password %q, want none", name, password)
		}
	}
}

func TestOwnerURLKeepsHostDatabaseAndQuery(t *testing.T) {
	got, err := OwnerURL("postgresql://postgres:p%40ss@db.internal:5433/retro?sslmode=require&application_name=x", "abc123")
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(got)
	if err != nil {
		t.Fatal(err)
	}
	password, _ := u.User.Password()
	if u.User.Username() != OwnerRole || password != "abc123" || u.Host != "db.internal:5433" ||
		u.Path != "/retro" || u.Query().Get("sslmode") != "require" || u.Query().Get("application_name") != "x" {
		t.Fatalf("unexpected owner URL %q", got)
	}
	if strings.Contains(got, "postgres:") || strings.Contains(got, "p%40ss") {
		t.Fatalf("owner URL still holds the superuser's credentials: %q", got)
	}
}
