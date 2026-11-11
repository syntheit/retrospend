package tasks

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The keystore dump takes the whole schema (--schema=keystore), so a new
// keystore table is backed up without a code change. What does not follow by
// itself is the restore: docs/self-hosting.md empties the key tables before it
// loads the dump with --data-only, and a table missing from that TRUNCATE makes
// the restore fail on the rows the app made at its first start. This keeps the
// docs in step with the migrations: every table a migration creates in
// keystore must be named in the TRUNCATE.
func TestRestoreDocsTruncateEveryKeystoreTable(t *testing.T) {
	migrations, err := filepath.Glob(filepath.Join("..", "..", "prisma", "migrations", "*", "migration.sql"))
	if err != nil || len(migrations) == 0 {
		t.Skip("prisma migrations are not next to the sidecar in this checkout")
	}
	doc, err := os.ReadFile(filepath.Join("..", "..", "docs", "self-hosting.md"))
	if err != nil {
		t.Skip("docs/self-hosting.md is not next to the sidecar in this checkout")
	}
	truncate := regexp.MustCompile(`TRUNCATE ([^'"]+)['"]`).FindStringSubmatch(string(doc))
	if truncate == nil {
		t.Fatal("docs/self-hosting.md has no TRUNCATE step for the key tables")
	}
	create := regexp.MustCompile(`(?i)CREATE TABLE IF NOT EXISTS keystore\."?([a-z_]+)"?`)
	var tables []string
	for _, path := range migrations {
		sql, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range create.FindAllStringSubmatch(string(sql), -1) {
			tables = append(tables, m[1])
		}
	}
	if len(tables) < 2 {
		t.Fatalf("expected the user and instance key tables in the migrations, found %v", tables)
	}
	for _, table := range tables {
		if !strings.Contains(truncate[1], "keystore."+table) {
			t.Errorf("the restore TRUNCATE in docs/self-hosting.md does not name keystore.%s", table)
		}
	}
}
