package processor

import (
	"testing"
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
