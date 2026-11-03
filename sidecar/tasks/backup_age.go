package tasks

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

// encryptStream reads src and writes it to outPath, encrypted to every recipient
// with the age command. The plain bytes never touch the disk. On any failure
// nothing is left at outPath: a backup is either encrypted or absent.
// Recipients must already be validated by config.ParseAgeRecipients.
func encryptStream(src io.Reader, outPath string, recipients []string) error {
	if len(recipients) == 0 {
		return fmt.Errorf("no age recipients")
	}
	args := []string{"--encrypt", "--output", outPath}
	for _, r := range recipients {
		args = append(args, "--recipient", r)
	}
	cmd := exec.Command("age", args...)
	cmd.Stdin = src
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		os.Remove(outPath)
		return fmt.Errorf("age failed: %v: %s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

// dumpEncrypted runs a pg_dump command that writes to stdout and pipes it
// through age into outPath. It returns pg_dump's stderr, or age's error.
func dumpEncrypted(dump *exec.Cmd, outPath string, recipients []string) ([]byte, error) {
	var stderr bytes.Buffer
	dump.Stderr = &stderr
	stdout, err := dump.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := dump.Start(); err != nil {
		return stderr.Bytes(), err
	}
	encErr := encryptStream(stdout, outPath, recipients)
	if encErr != nil {
		// Drain so pg_dump can exit instead of blocking on a closed pipe.
		io.Copy(io.Discard, stdout)
	}
	dumpErr := dump.Wait()
	if dumpErr != nil {
		os.Remove(outPath)
		return stderr.Bytes(), dumpErr
	}
	return stderr.Bytes(), encErr
}

func isBackupFile(name string) bool {
	return strings.HasSuffix(name, ".dump") || strings.HasSuffix(name, ".dump.age")
}
