package config

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"unicode/utf8"
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

// URLPassword is the password of a connection URL as the database sees it
// (percent-decoded), the way urlPassword in scripts/db-owner/index.mjs reads
// it. ok is false when the URL has no password, does not parse, or the
// decoded password is not valid UTF-8 (the Node side refuses those too).
func URLPassword(connectionString string) (password string, ok bool) {
	u, err := url.Parse(connectionString)
	if err != nil || u.User == nil {
		return "", false
	}
	password, has := u.User.Password()
	if !has || password == "" || !utf8.ValidString(password) {
		return "", false
	}
	return password, true
}

// OwnerURL is connectionString with the owner's name and password in place of
// the user's; host, database and query string stay.
func OwnerURL(connectionString, ownerPassword string) (string, error) {
	u, err := url.Parse(connectionString)
	if err != nil {
		return "", err
	}
	u.User = url.UserPassword(OwnerRole, ownerPassword)
	return u.String(), nil
}
