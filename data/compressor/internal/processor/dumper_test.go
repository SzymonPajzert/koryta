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

func TestProcessHostnameTotal(t *testing.T) {
	mockSrc := NewMockStorageClient()
	mockDst := NewMockStorageClient()

	data1 := []byte("data1")
	data2 := []byte("data2")
	todayData := []byte("today_data")

	mockSrc.AddObject("hostname=example.com/date=2026-05-01.json", int64(len(data1)), data1)
	mockSrc.AddObject("hostname=example.com/date=2026-05-02.json", int64(len(data2)), data2)
	mockSrc.AddObject("hostname=example.com/date=2026-05-28.json", int64(len(todayData)), todayData)

	cfg := &config.Config{
		HostnameOnly: true,
		SourcePrefix: "",
	}
	
	dumper := NewDumper(mockSrc, mockDst, cfg)
	
	ctx := context.Background()
	today := "2026-05-28"
	yesterday := "2026-05-27"
	
	err := dumper.processHostnameTotal(ctx, "example.com", today, yesterday)
	if err != nil {
		t.Fatalf("processHostnameTotal failed: %v", err)
	}

	// Verify that a total dump was created
	destPath := "hostname=example.com/total/date=2026-05-27.tar.gz"
	exists, err := mockDst.ObjectExists(ctx, destPath)
	if err != nil {
		t.Fatalf("ObjectExists failed: %v", err)
	}
	if !exists {
		t.Errorf("Expected total dump %s to exist, but it doesn't", destPath)
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
		HostnameOnly: true,
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
