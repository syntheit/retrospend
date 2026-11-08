package config

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
)

// OwnerRole is the login role that owns every table. The app's entrypoint
// creates it (scripts/db-owner, prisma/bootstrap); the sidecar only signs in
// as it, so it never needs the database superuser's credentials after its
// wrapper (entrypoint.sh) has run.
const OwnerRole = "retrospend_owner"

// DeriveOwnerPassword is the owner's password: hex(HMAC-SHA256(key = the
// superuser's password, message = "retrospend_owner")). It must stay equal to
// deriveOwnerPassword in scripts/db-owner/index.mjs; both are checked against
// the same vectors (testdata/owner-vectors.json, a copy of
// scripts/db-owner/vectors.json).
func DeriveOwnerPassword(superuserPassword string) string {
	mac := hmac.New(sha256.New, []byte(superuserPassword))
	mac.Write([]byte(OwnerRole))
	return hex.EncodeToString(mac.Sum(nil))
}

// pgEnvMu guards the process environment while parseURL hides the variables
// that would add a password the URL does not carry.
var pgEnvMu sync.Mutex

// parseURL is pgconn.ParseConfig with the environment that could supply a
// password or a different connection (PGPASSWORD, PGPASSFILE, PGSERVICE,
// PGSERVICEFILE) set aside, so the result describes the URL alone, the way
// urlPassword in scripts/db-owner/index.mjs does.
func parseURL(connectionString string) (*pgconn.Config, error) {
	pgEnvMu.Lock()
	defer pgEnvMu.Unlock()
	saved := map[string]*string{}
	for _, name := range []string{"PGPASSWORD", "PGPASSFILE", "PGSERVICE", "PGSERVICEFILE"} {
		if v, ok := os.LookupEnv(name); ok {
			v := v
			saved[name] = &v
		} else {
			saved[name] = nil
		}
		if name == "PGPASSFILE" {
			os.Setenv(name, os.DevNull)
		} else {
			os.Unsetenv(name)
		}
	}
	defer func() {
		for name, v := range saved {
			if v == nil {
				os.Unsetenv(name)
			} else {
				os.Setenv(name, *v)
			}
		}
	}()
	return pgconn.ParseConfig(connectionString)
}

// URLPassword is the password of a connection URL as the database driver
// reads it: the value pgx (which opens every connection here) takes from the
// URL, so unencoded characters that net/url rejects (braces, quotes, pipes,
// brackets, non-ASCII) work, and Go and Node (scripts/db-owner urlPassword)
// derive from the same bytes. ok is false when the URL has no password, does
// not parse, or the password is not valid UTF-8 (the Node side refuses those).
//
// Known differences from Node, where the two readers disagree on a URL that
// this sidecar could not use anyway or never gets a role for: a space,
// "@" or "/" in the password. See vectors.json for what both agree on.
func URLPassword(connectionString string) (password string, ok bool) {
	cfg, err := parseURL(connectionString)
	if err != nil || cfg.Password == "" || !utf8.ValidString(cfg.Password) {
		return "", false
	}
	return cfg.Password, true
}

// OwnerURL is connectionString with the owner's name and password in place of
// the user's; host, database and query string stay. It rewrites the userinfo
// the way pgx finds it (up to the first "@" before any "/"), so it works for
// every URL pgx accepts, and checks that pgx reads the result as the same
// server and database with the owner's login.
func OwnerURL(connectionString, ownerPassword string) (string, error) {
	prefix, rest, ok := splitScheme(connectionString)
	if !ok {
		return "", fmt.Errorf("DATABASE_URL is not a postgres:// or postgresql:// URL")
	}
	if i := strings.IndexAny(rest, "@/"); i >= 0 && rest[i] == '@' {
		rest = rest[i+1:]
	}
	owner := prefix + OwnerRole + ":" + escapeUserinfo(ownerPassword) + "@" + rest

	before, err := parseURL(connectionString)
	if err != nil {
		return "", fmt.Errorf("DATABASE_URL does not parse")
	}
	after, err := parseURL(owner)
	if err != nil {
		return "", fmt.Errorf("the owner URL does not parse")
	}
	if after.User != OwnerRole || after.Password != ownerPassword ||
		after.Host != before.Host || after.Port != before.Port || after.Database != before.Database {
		return "", fmt.Errorf("the owner URL does not read back as the same server and database")
	}
	return owner, nil
}

func splitScheme(s string) (prefix, rest string, ok bool) {
	for _, p := range []string{"postgresql://", "postgres://"} {
		if r, found := strings.CutPrefix(s, p); found {
			return p, r, true
		}
	}
	return "", "", false
}

// escapeUserinfo percent-encodes every byte but the unreserved ones, so any
// password (a derived one is plain hex) survives pgx's userinfo reader.
func escapeUserinfo(s string) string {
	const hexDigits = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '-', c == '.', c == '_', c == '~':
			b.WriteByte(c)
		default:
			b.WriteByte('%')
			b.WriteByte(hexDigits[c>>4])
			b.WriteByte(hexDigits[c&15])
		}
	}
	return b.String()
}
