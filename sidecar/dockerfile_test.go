package main

import (
	"os"
	"strings"
	"testing"
)

// The sidecar image is not built in unit tests; this checks the parts of the
// Dockerfile that keep the superuser's credentials away from the sidecar's
// own process. The image-level check (file owners and /proc/1/environ) is
// described in the pull request.
func TestDockerfileRunsTheRootOwnedWrapper(t *testing.T) {
	raw, err := os.ReadFile("Dockerfile")
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(string(raw), "\n")

	var entrypoint, cmd string
	userAt, copyEntrypointAt, copyBinaryAt := -1, -1, -1
	for i, line := range lines {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "ENTRYPOINT "):
			entrypoint = line
		case strings.HasPrefix(line, "CMD "):
			cmd = line
		case strings.HasPrefix(line, "USER "):
			userAt = i
		case strings.HasPrefix(line, "COPY ") && strings.Contains(line, "entrypoint.sh"):
			copyEntrypointAt = i
			if strings.Contains(line, "--chown") {
				t.Errorf("the entrypoint must stay root-owned: %s", line)
			}
			if !strings.HasSuffix(line, " /opt/sidecar/entrypoint.sh") {
				t.Errorf("the entrypoint belongs in /opt/sidecar: %s", line)
			}
		case strings.HasPrefix(line, "COPY ") && strings.Contains(line, "/app/sidecar "):
			copyBinaryAt = i
			if strings.Contains(line, "--chown") {
				t.Errorf("the binary must stay root-owned: %s", line)
			}
			if !strings.HasSuffix(line, " /opt/sidecar/sidecar") {
				t.Errorf("the binary belongs in /opt/sidecar: %s", line)
			}
		case strings.Contains(line, "chown") && strings.Contains(line, "/opt/sidecar"):
			t.Errorf("nothing in /opt/sidecar may be chowned to the sidecar's user: %s", line)
		}
	}

	if entrypoint != `ENTRYPOINT ["/opt/sidecar/entrypoint.sh"]` {
		t.Errorf("ENTRYPOINT = %q", entrypoint)
	}
	if cmd != `CMD ["/opt/sidecar/sidecar"]` {
		t.Errorf("CMD = %q", cmd)
	}
	if copyEntrypointAt < 0 || copyBinaryAt < 0 {
		t.Fatalf("the entrypoint or the binary is not copied into /opt/sidecar")
	}
	if userAt < copyEntrypointAt || userAt < copyBinaryAt {
		t.Error("USER must come after the root-owned copies")
	}
	if !strings.Contains(string(raw), "chmod 755 /opt/sidecar /opt/sidecar/sidecar /opt/sidecar/entrypoint.sh") {
		t.Error("the Dockerfile must set /opt/sidecar and its files to 755")
	}
}

func TestEntrypointScriptIsExecutableAndUnix(t *testing.T) {
	info, err := os.Stat("entrypoint.sh")
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&0o111 == 0 {
		t.Error("entrypoint.sh is not executable")
	}
	raw, _ := os.ReadFile("entrypoint.sh")
	if strings.Contains(string(raw), "\r") {
		t.Error("entrypoint.sh has CRLF line endings; the shebang would fail")
	}
	if !strings.HasPrefix(string(raw), "#!/bin/sh\n") {
		t.Error("entrypoint.sh must start with #!/bin/sh (the image has no bash)")
	}
}
