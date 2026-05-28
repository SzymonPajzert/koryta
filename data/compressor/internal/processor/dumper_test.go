package processor

import (
	"context"
	"testing"

	"github.com/koryta/compressor/internal/config"
)

func TestGetTarHeaderName(t *testing.T) {
	tests := []struct {
		name     string
		hostname string
		filename string
		expected string
	}{
		{
			name:     "User provided complex path",
			hostname: "06-400.pl",
			filename: "koryta-pl-crawled/hostname=06-400.pl/aktualnosc-czytnik/drodzy-towarzysze/date=2026-05-08",
			expected: "06-400.pl/aktualnosc-czytnik/drodzy-towarzysze/date=2026-05-08",
		},
		{
			name:     "Simple path with extension",
			hostname: "esesja.tv",
			filename: "hostname=esesja.tv/date=2025-09-19.json",
			expected: "esesja.tv/date=2025-09-19.json",
		},
		{
			name:     "Deeply nested with date as folder",
			hostname: "example.com",
			filename: "raw/data/hostname=example.com/some/path/date=2023-01-01/file.txt",
			expected: "example.com/some/path/date=2023-01-01/file.txt",
		},
		{
			name:     "Hostname missing (fallback)",
			hostname: "example.com",
			filename: "raw/data/date=2023-01-01.json",
			expected: "example.com/date=2023-01-01.json",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := getTarHeaderName(tt.hostname, tt.filename)
			if got != tt.expected {
				t.Errorf("getTarHeaderName() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestProcessHostnameIncremental(t *testing.T) {
	mockSrc := NewMockStorageClient()
	mockDst := NewMockStorageClient()

	data1 := []byte("data1")
	data2 := []byte("data2")
	todayData := []byte("today_data")

	mockSrc.AddObject("hostname=example.com/date=2026-05-01.json", int64(len(data1)), data1)
	mockSrc.AddObject("hostname=example.com/date=2026-05-02.json", int64(len(data2)), data2)
	mockSrc.AddObject("hostname=example.com/date=2026-05-28.json", int64(len(todayData)), todayData)

	cfg := &config.Config{
		Incremental: true,
		SourcePrefix: "",
	}
	
	dumper := NewDumper(mockSrc, mockDst, cfg)
	
	ctx := context.Background()
	today := "2026-05-28"
	yesterday := "2026-05-27"
	
	err := dumper.processHostnameIncremental(ctx, "example.com", today, yesterday)
	if err != nil {
		t.Fatalf("processHostnameIncremental failed: %v", err)
	}

	// Verify that an incremental dump was created
	destPath := "hostname=example.com/from=2025-01-01/date=2026-05-27.tar.gz"
	exists, err := mockDst.ObjectExists(ctx, destPath)
	if err != nil {
		t.Fatalf("ObjectExists failed: %v", err)
	}
	if !exists {
		t.Errorf("Expected incremental dump %s to exist, but it doesn't", destPath)
	}
}

func TestRunConcurrency(t *testing.T) {
	mockSrc := NewMockStorageClient()
	mockDst := NewMockStorageClient()

	data := []byte("data")

	// Add 3 hostnames
	mockSrc.AddObject("hostname=site1.com/date=2026-05-01.json", int64(len(data)), data)
	mockSrc.AddObject("hostname=site2.com/date=2026-05-01.json", int64(len(data)), data)
	mockSrc.AddObject("hostname=site3.com/date=2026-05-01.json", int64(len(data)), data)

	cfg := &config.Config{
		Incremental: true,
		SourcePrefix: "",
	}
	
	dumper := NewDumper(mockSrc, mockDst, cfg)
	err := dumper.Run(context.Background())
	if err != nil {
		t.Fatalf("Run failed: %v", err)
	}

	// Because of concurrency, all 3 should have been processed.
	mockDst.mu.RLock()
	defer mockDst.mu.RUnlock()

	if len(mockDst.WriteTracker) != 3 {
		t.Errorf("Expected 3 tarballs to be created, got %d", len(mockDst.WriteTracker))
	}
}

func TestProcessHostnameIncremental_SkipRedundant(t *testing.T) {
	mockSrc := NewMockStorageClient()
	mockDst := NewMockStorageClient()

	// Data up to 05-25 only
	mockSrc.AddObject("hostname=example.com/date=2026-05-25.json", 10, []byte("some data!"))
	
	// Destination already has a dump for 05-25
	mockDst.AddObject("hostname=example.com/from=2025-01-01/date=2026-05-25.tar.gz", 100, []byte("tarball"))

	cfg := &config.Config{Incremental: true}
	dumper := NewDumper(mockSrc, mockDst, cfg)

	// Running for today = 05-28, yesterday = 05-27
	err := dumper.processHostnameIncremental(context.Background(), "example.com", "2026-05-28", "2026-05-27")
	if err != nil {
		t.Fatalf("Failed: %v", err)
	}

	mockDst.mu.RLock()
	defer mockDst.mu.RUnlock()
	// Should be no newly created tarballs because state hasn't changed since 05-25
	if len(mockDst.WriteTracker) != 0 {
		t.Errorf("Expected 0 tarballs to be created, got %d", len(mockDst.WriteTracker))
	}
}

func TestProcessHostnameIncremental_CreatesWhenNewData(t *testing.T) {
	mockSrc := NewMockStorageClient()
	mockDst := NewMockStorageClient()

	// Data up to 05-26
	mockSrc.AddObject("hostname=example.com/date=2026-05-25.json", 10, []byte("some data!"))
	mockSrc.AddObject("hostname=example.com/date=2026-05-26.json", 10, []byte("some data!"))
	
	// Destination has a dump for 05-25
	mockDst.AddObject("hostname=example.com/from=2025-01-01/date=2026-05-25.tar.gz", 100, []byte("tarball"))

	cfg := &config.Config{Incremental: true}
	dumper := NewDumper(mockSrc, mockDst, cfg)

	// Running for today = 05-28, yesterday = 05-27
	err := dumper.processHostnameIncremental(context.Background(), "example.com", "2026-05-28", "2026-05-27")
	if err != nil {
		t.Fatalf("Failed: %v", err)
	}

	mockDst.mu.RLock()
	defer mockDst.mu.RUnlock()
	// Should have created a dump because there was a new file on 05-26 (which is > 05-25)
	if len(mockDst.WriteTracker) != 1 {
		t.Errorf("Expected 1 tarball to be created, got %d", len(mockDst.WriteTracker))
	}
	expected := "hostname=example.com/from=2026-05-25/date=2026-05-27.tar.gz"
	if mockDst.WriteTracker[0] != expected {
		t.Errorf("Expected dump %s, got %s", expected, mockDst.WriteTracker[0])
	}
}

func TestProcessHostnameIncremental_OldDataException(t *testing.T) {
	mockSrc := NewMockStorageClient()
	mockDst := NewMockStorageClient()

	// Add file older than 2025-01-01
	mockSrc.AddObject("hostname=example.com/date=2024-12-31.json", 10, []byte("old"))

	cfg := &config.Config{Incremental: true}
	dumper := NewDumper(mockSrc, mockDst, cfg)

	err := dumper.processHostnameIncremental(context.Background(), "example.com", "2026-05-28", "2026-05-27")
	if err == nil {
		t.Fatalf("Expected an error for files older than 2025-01-01, but got nil")
	}
}
