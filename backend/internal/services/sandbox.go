package services

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"golang-katas/backend/internal/models"
)

func ExecuteGoCode(code string) models.ExecutionResult {
	start := time.Now()

	tmpDir, err := os.MkdirTemp("", "go-sandbox-*")
	if err != nil {
		return models.ExecutionResult{
			Error:   "Failed to create temp directory",
			Success: false,
		}
	}
	defer os.RemoveAll(tmpDir)

	mainFile := filepath.Join(tmpDir, "main.go")
	if err := os.WriteFile(mainFile, []byte(code), 0644); err != nil {
		return models.ExecutionResult{
			Error:   "Failed to write source file",
			Success: false,
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "go", "run", mainFile)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	elapsed := time.Since(start).Milliseconds()

	if ctx.Err() == context.DeadlineExceeded {
		return models.ExecutionResult{
			Stderr:          stderr.String(),
			Error:           "Execution timed out (10s limit)",
			Success:         false,
			ExecutionTimeMs: elapsed,
		}
	}

	return models.ExecutionResult{
		Stdout:          stdout.String(),
		Stderr:          stderr.String(),
		Success:         err == nil,
		ExecutionTimeMs: elapsed,
	}
}
