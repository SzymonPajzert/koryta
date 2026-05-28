package config

import (
	"flag"
	"os"
	"testing"
)

func TestParse(t *testing.T) {
	// Save original args
	oldArgs := os.Args
	defer func() { os.Args = oldArgs }()
	
	// Reset flags for testing
	flag.CommandLine = flag.NewFlagSet(os.Args[0], flag.ExitOnError)

	os.Args = []string{
		"cmd",
		"-in-bucket", "my-src-bucket",
		"-out-bucket", "my-dst-bucket",
		"-hostname-only",
		"-source-prefix", "raw/",
		"-dry-run",
	}

	cfg := Parse()

	if cfg.BucketName != "my-src-bucket" {
		t.Errorf("expected bucket my-src-bucket, got %s", cfg.BucketName)
	}
	if cfg.OutBucket != "my-dst-bucket" {
		t.Errorf("expected out-bucket my-dst-bucket, got %s", cfg.OutBucket)
	}
	if !cfg.HostnameOnly {
		t.Errorf("expected HostnameOnly to be true")
	}
	if cfg.SourcePrefix != "raw/" {
		t.Errorf("expected source-prefix raw/, got %s", cfg.SourcePrefix)
	}
	if !cfg.DryRun {
		t.Errorf("expected DryRun to be true")
	}
}

func TestParseDefaultOutBucket(t *testing.T) {
	oldArgs := os.Args
	defer func() { os.Args = oldArgs }()
	
	flag.CommandLine = flag.NewFlagSet(os.Args[0], flag.ExitOnError)

	os.Args = []string{
		"cmd",
		"-in-bucket", "same-bucket",
	}

	cfg := Parse()

	if cfg.BucketName != "same-bucket" {
		t.Errorf("expected bucket same-bucket, got %s", cfg.BucketName)
	}
	// out-bucket should default to bucket if not provided
	if cfg.OutBucket != "same-bucket" {
		t.Errorf("expected out-bucket to fallback to same-bucket, got %s", cfg.OutBucket)
	}
}
