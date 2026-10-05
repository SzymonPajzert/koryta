package processor

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

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
		Incremental:  true,
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
		t.Fatalf("Expected incremental dump %s to exist, but it doesn't", destPath)
	}

	// And that it reads back whole, the way the Python mirror opens it:
	// index.txt first, then every file up to yesterday and nothing from today.
	members := readTarGz(t, mockDst.file(destPath))
	if len(members) == 0 || members[0].name != "index.txt" {
		t.Fatalf("Expected index.txt as the first member, got %v", members)
	}
	index := strings.Fields(members[0].content)
	sort.Strings(index)
	wantIndex := []string{
		"hostname=example.com/date=2026-05-01.json",
		"hostname=example.com/date=2026-05-02.json",
	}
	if !reflect.DeepEqual(index, wantIndex) {
		t.Errorf("index.txt lists %v, want %v", index, wantIndex)
	}
	wantFiles := map[string]string{
		"example.com/date=2026-05-01.json": "data1",
		"example.com/date=2026-05-02.json": "data2",
	}
	if got := filesIn(t, members); !reflect.DeepEqual(got, wantFiles) {
		t.Errorf("Archive holds %v, want %v", got, wantFiles)
	}
}

type tarMember struct {
	name, content string
}

// readTarGz unpacks an archive, failing the test unless both the tar and the
// gzip stream around it are complete.
func readTarGz(t *testing.T, archive []byte) []tarMember {
	t.Helper()
	gr, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		t.Fatalf("Archive is not gzip: %v", err)
	}
	tr := tar.NewReader(gr)
	var members []tarMember
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("Archive is not a complete tar: %v", err)
		}
		content, err := io.ReadAll(tr)
		if err != nil {
			t.Fatalf("Reading %s from the archive: %v", hdr.Name, err)
		}
		members = append(members, tarMember{hdr.Name, string(content)})
	}
	// Read on to the gzip trailer, which is where its checksum is verified.
	if _, err := io.Copy(io.Discard, gr); err != nil {
		t.Fatalf("Archive's gzip stream is incomplete: %v", err)
	}
	return members
}

// filesIn maps the archived files, everything after index.txt, to their
// contents.
func filesIn(t *testing.T, members []tarMember) map[string]string {
	t.Helper()
	files := make(map[string]string)
	for _, m := range members[1:] {
		if _, dup := files[m.name]; dup {
			t.Errorf("%s is in the archive twice", m.name)
		}
		files[m.name] = m.content
	}
	return files
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
		Incremental:  true,
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

// One bad host must not keep the others from being archived, but it has to
// fail the run: a scheduled job that exits 0 after losing hosts looks healthy.
func TestRunFailsWhenOneHostnameFails(t *testing.T) {
	mockSrc := NewMockStorageClient()
	mockDst := NewMockStorageClient()

	data := []byte("data")
	mockSrc.AddObject("hostname=good.com/date=2026-05-01.json", int64(len(data)), data)
	// Incremental mode refuses a host holding anything dated before 2025.
	mockSrc.AddObject("hostname=bad.com/date=2024-12-31.json", int64(len(data)), data)

	dumper := NewDumper(mockSrc, mockDst, &config.Config{Incremental: true})
	err := dumper.Run(context.Background())
	if err == nil {
		t.Fatal("Run succeeded although bad.com failed")
	}
	if msg := err.Error(); !strings.Contains(msg, "1 of 2 hostnames failed") || !strings.Contains(msg, "bad.com") {
		t.Errorf("Expected the error to count and name the failed host, got: %v", err)
	}

	mockDst.mu.RLock()
	defer mockDst.mu.RUnlock()
	if len(mockDst.WriteTracker) != 1 || !strings.HasPrefix(mockDst.WriteTracker[0], "hostname=good.com/") {
		t.Errorf("Expected good.com to be archived regardless, got %v", mockDst.WriteTracker)
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

func TestRunHostnameFilter(t *testing.T) {
	mockSrc := NewMockStorageClient()
	mockDst := NewMockStorageClient()

	data := []byte("data")
	mockSrc.AddObject("hostname=site1.com/date=2026-05-01.json", int64(len(data)), data)
	mockSrc.AddObject("hostname=rejestr.io/date=2026-05-01.json", int64(len(data)), data)
	mockSrc.AddObject("hostname=site3.com/date=2026-05-01.json", int64(len(data)), data)

	cfg := &config.Config{Incremental: true, Hostname: "rejestr.io"}

	dumper := NewDumper(mockSrc, mockDst, cfg)
	if err := dumper.Run(context.Background()); err != nil {
		t.Fatalf("Run failed: %v", err)
	}

	mockDst.mu.RLock()
	defer mockDst.mu.RUnlock()

	if len(mockDst.WriteTracker) != 1 {
		t.Fatalf("Expected 1 tarball, got %d: %v", len(mockDst.WriteTracker), mockDst.WriteTracker)
	}
	if !strings.Contains(mockDst.WriteTracker[0], "hostname=rejestr.io/") {
		t.Errorf("Expected the rejestr.io dump, got %s", mockDst.WriteTracker[0])
	}
}

// The point of the flag is cost: naming a host has to skip the prefix walk
// over every other one, not merely filter its results afterwards.
func TestRunHostnameFilterSkipsDiscovery(t *testing.T) {
	mockSrc := NewMockStorageClient()
	mockDst := NewMockStorageClient()

	data := []byte("data")
	mockSrc.AddObject("hostname=rejestr.io/date=2026-05-01.json", int64(len(data)), data)

	cfg := &config.Config{Incremental: true, Hostname: "rejestr.io"}

	dumper := NewDumper(mockSrc, mockDst, cfg)
	if err := dumper.Run(context.Background()); err != nil {
		t.Fatalf("Run failed: %v", err)
	}

	if got := mockSrc.PrefixCalls.Load(); got != 0 {
		t.Errorf("Expected no hostname discovery, got %d ListPrefixes calls", got)
	}
}

// A download that fails part way through an archive must not leave the
// archive behind: whatever sits under the final name is what the next
// incremental run builds on.
func TestFailedDownloadPublishesNothing(t *testing.T) {
	ctx := context.Background()
	mockSrc := NewMockStorageClient()
	mockDst := NewMockStorageClient()

	for day := 1; day <= 6; day++ {
		name := fmt.Sprintf("hostname=example.com/date=2026-05-%02d.json", day)
		mockSrc.AddObject(name, 4, []byte("data"))
	}
	errRead := errors.New("read failed")
	mockSrc.ErrReadFor = map[string]error{"hostname=example.com/date=2026-05-04.json": errRead}

	dumper := NewDumper(mockSrc, mockDst, &config.Config{Incremental: true, DownloadWorkers: 2})
	err := dumper.processHostnameIncremental(ctx, "example.com", "2026-05-28", "2026-05-27")
	if !errors.Is(err, errRead) {
		t.Fatalf("Expected the read error, got %v", err)
	}

	destPath := "hostname=example.com/from=2025-01-01/date=2026-05-27.tar.gz"
	if exists, _ := mockDst.ObjectExists(ctx, destPath); exists {
		t.Errorf("A partial archive was published as %s", destPath)
	}
	if written := mockDst.written(); len(written) != 0 {
		t.Errorf("Expected nothing written, got %v", written)
	}
}

func TestRunFailsWhenADownloadFails(t *testing.T) {
	mockSrc := NewMockStorageClient()
	mockDst := NewMockStorageClient()

	for day := 1; day <= 3; day++ {
		for _, host := range []string{"good.com", "bad.com"} {
			name := fmt.Sprintf("hostname=%s/date=2026-05-%02d.json", host, day)
			mockSrc.AddObject(name, 4, []byte("data"))
		}
	}
	errRead := errors.New("read failed")
	mockSrc.ErrReadFor = map[string]error{"hostname=bad.com/date=2026-05-02.json": errRead}

	err := NewDumper(mockSrc, mockDst, &config.Config{Incremental: true}).Run(context.Background())
	if !errors.Is(err, errRead) {
		t.Fatalf("Expected Run to fail with the read error, got %v", err)
	}
	if !strings.Contains(err.Error(), "1 of 2 hostnames failed") {
		t.Errorf("Expected the error to count the failed host, got: %v", err)
	}

	written := mockDst.written()
	if len(written) != 1 || !strings.HasPrefix(written[0], "hostname=good.com/") {
		t.Errorf("Expected only good.com to be archived, got %v", written)
	}
}

// An archive smaller than the writer's 16 MiB chunk goes to GCS in a single
// request made inside Close, so Close is the only place a refused upload
// shows. On a VM with a read-only storage scope that is every such archive.
func TestUploadErrorOnCloseFailsTheRun(t *testing.T) {
	mockSrc := NewMockStorageClient()
	mockDst := NewMockStorageClient()

	data := []byte("data")
	mockSrc.AddObject("hostname=example.com/date=2026-05-01.json", int64(len(data)), data)
	errClose := errors.New("googleapi: Error 403: Provided scope(s) are not authorized, forbidden")
	mockDst.ErrClose = errClose

	err := NewDumper(mockSrc, mockDst, &config.Config{Incremental: true}).Run(context.Background())
	if !errors.Is(err, errClose) {
		t.Fatalf("Expected Run to fail with the upload's error, got %v", err)
	}
	if written := mockDst.written(); len(written) != 0 {
		t.Errorf("Expected nothing written, got %v", written)
	}
}

// The next incremental run starts after the newest archive it finds, so a run
// that fails has to leave that where it was. Otherwise whatever the failed run
// could not archive is skipped for good.
func TestFailedRunDoesNotMoveTheChainForward(t *testing.T) {
	ctx := context.Background()
	mockSrc := NewMockStorageClient()
	mockDst := NewMockStorageClient()

	// The last good run archived everything up to 05-25.
	mockDst.AddObject("hostname=example.com/from=2025-01-01/date=2026-05-25.tar.gz", 100, []byte("tarball"))
	mockSrc.AddObject("hostname=example.com/date=2026-05-26.json", 5, []byte("day26"))
	mockSrc.AddObject("hostname=example.com/date=2026-05-27.json", 5, []byte("day27"))
	mockSrc.ErrReadFor = map[string]error{"hostname=example.com/date=2026-05-26.json": errors.New("read failed")}

	dumper := NewDumper(mockSrc, mockDst, &config.Config{Incremental: true})
	if err := dumper.processHostnameIncremental(ctx, "example.com", "2026-05-28", "2026-05-27"); err == nil {
		t.Fatal("Expected the run with a failed download to fail")
	}

	// A day later the object reads fine.
	mockSrc.mu.Lock()
	mockSrc.ErrReadFor = nil
	mockSrc.mu.Unlock()
	mockSrc.AddObject("hostname=example.com/date=2026-05-28.json", 5, []byte("day28"))
	if err := dumper.processHostnameIncremental(ctx, "example.com", "2026-05-29", "2026-05-28"); err != nil {
		t.Fatalf("Next run failed: %v", err)
	}

	want := "hostname=example.com/from=2026-05-25/date=2026-05-28.tar.gz"
	if written := mockDst.written(); !reflect.DeepEqual(written, []string{want}) {
		t.Fatalf("Expected only %s to be written, got %v", want, written)
	}
	wantFiles := map[string]string{
		"example.com/date=2026-05-26.json": "day26",
		"example.com/date=2026-05-27.json": "day27",
		"example.com/date=2026-05-28.json": "day28",
	}
	if got := filesIn(t, readTarGz(t, mockDst.file(want))); !reflect.DeepEqual(got, wantFiles) {
		t.Errorf("Archive holds %v, want %v", got, wantFiles)
	}
}

// When writing the archive fails, the downloads have to stop with it. The
// workers used to stay blocked sending to a channel nobody read any more,
// holding on to the files they had fetched, for every archive that failed.
func TestWriteErrorStopsTheDownloads(t *testing.T) {
	ctx := context.Background()
	mockSrc := NewMockStorageClient()
	mockDst := NewMockStorageClient()

	// Incompressible and far more than gzip buffers, so the writer is handed
	// bytes, and fails, while files are still being appended.
	rng := rand.NewChaCha8([32]byte{})
	var files []FileInfo
	for i := range 64 {
		data := make([]byte, 32<<10)
		rng.Read(data)
		name := fmt.Sprintf("hostname=example.com/date=2026-05-01/%02d.html", i)
		mockSrc.AddObject(name, int64(len(data)), data)
		files = append(files, FileInfo{Name: name, Hostname: "example.com", Date: "2026-05-01", Size: int64(len(data))})
	}
	errWrite := errors.New("chunk upload failed")
	mockDst.ErrWrite = errWrite
	mockDst.ErrWriteAfter = 64 << 10

	dumper := NewDumper(mockSrc, mockDst, &config.Config{DownloadWorkers: 4})
	before := runtime.NumGoroutine()
	err := dumper.createTarGz(ctx, "hostname=example.com/date=2026-05-01.tar.gz", files, "index\n")
	if !errors.Is(err, errWrite) {
		t.Fatalf("Expected the write error, got %v", err)
	}

	for deadline := time.Now().Add(5 * time.Second); runtime.NumGoroutine() > before; {
		if time.Now().After(deadline) {
			t.Fatalf("%d goroutines left running after createTarGz returned, %d before it started", runtime.NumGoroutine(), before)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if written := mockDst.written(); len(written) != 0 {
		t.Errorf("Expected nothing written, got %v", written)
	}
}
