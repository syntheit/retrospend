package tasks

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The app posts recurring expenses (src/server/services/recurring-auto-post.ts),
// so their names are sealed with the owner's key. The sidecar never inserts an
// expense or moves a template, which would copy a name it cannot seal.
var forbiddenSQL = []string{"INSERT INTO expense", "UPDATE recurring_template", "ProcessRecurring"}

func TestSidecarNeverPostsExpenses(t *testing.T) {
	root := ".."
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		if d.IsDir() || !strings.HasSuffix(rel, ".go") || strings.HasSuffix(rel, "_test.go") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		upper := strings.ToUpper(string(src))
		for _, s := range forbiddenSQL {
			if strings.Contains(upper, strings.ToUpper(s)) {
				t.Errorf("%s contains %q", rel, s)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
