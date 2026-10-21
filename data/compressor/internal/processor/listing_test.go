package processor

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"

	"cloud.google.com/go/storage"
	"github.com/koryta/compressor/internal/config"
)

const host = "example.com"
const hostPrefix = "hostname=" + host + "/"

// archiveWithIndex is an archive as the compressor writes one: index.txt
// first, naming every object in it, then the objects.
func archiveWithIndex(t *testing.T, names []string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)
	index := []byte(strings.Join(names, "\n") + "\n")
	if err := tw.WriteHeader(&tar.Header{Name: "index.txt", Size: int64(len(index)), Mode: 0644}); err != nil {
		t.Fatal(err)
	}
	if _, err := tw.Write(index); err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		if err := tw.WriteHeader(&tar.Header{Name: getTarHeaderName(host, name), Size: 1, Mode: 0644}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte("x")); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// crawl is a host shaped like api-krs.ms.gov.pl: a bulletin a day and odpisy
// for both registers of each company, under a long common prefix.
func crawl(companies int, date string) []string {
	var names []string
	for day := range 30 {
		names = append(names, fmt.Sprintf("%sapi/Krs/Biuletyn/2026-04-%02d/date=%s", hostPrefix, day+1, date))
	}
	for i := range companies {
		for _, register := range []string{"P", "S"} {
			names = append(names, fmt.Sprintf("%sapi/krs/OdpisAktualny/%010d/?rejestr=%s/date=%s", hostPrefix, 1000+i*37, register, date))
		}
	}
	return names
}

func addAll(m *MockStorageClient, names []string) {
	for _, name := range names {
		m.AddObject(name, 1, []byte("x"))
	}
}

func namesOf(objects []*storage.ObjectAttrs) []string {
	names := make([]string, len(objects))
	for i, o := range objects {
		names[i] = o.Name
	}
	return names
}

func archivesOf(t *testing.T, m *MockStorageClient) []*storage.ObjectAttrs {
	t.Helper()
	archives, err := m.ListObjects(context.Background(), hostPrefix+"from=")
	if err != nil {
		t.Fatal(err)
	}
	return archives
}

// Split where the archives say, the listing still has to be exactly the one
// listing it replaces: the same names in the same order, those crawled since
// the archives and those before the first bound and after the last included.
func TestListSourceSplitsWhereTheArchivesSay(t *testing.T) {
	ctx := context.Background()
	src, dst := NewMockStorageClient(), NewMockStorageClient()

	archived := crawl(2400, "2026-05-01")
	addAll(src, archived)
	// Crawled since the newest archive, so in no index: some sort before every
	// archived name, some after, some in between.
	addAll(src, []string{
		hostPrefix + "api/Krs/Biuletyn/2026-01-01/date=2026-05-28",
		hostPrefix + "api/krs/OdpisAktualny/0000000001/?rejestr=P/date=2026-05-28",
		hostPrefix + "api/krs/OdpisAktualny/0000050000/?rejestr=P/date=2026-05-28",
		hostPrefix + "api/krs/OdpisAktualny/9999999999/?rejestr=S/date=2026-05-28",
		hostPrefix + "date=2025-10-27/api/krs/OdpisAktualny/0000000002",
	})
	// Not under the prefix: never listed, whatever the bounds.
	src.AddObject("hostname=example.com.pl/date=2026-05-01.json", 1, []byte("x"))

	dst.AddObject(hostPrefix+"from=2025-01-01/date=2026-05-27.tar.gz", 1<<20, archiveWithIndex(t, archived))
	// One the split cannot use costs it nothing.
	dst.AddObject(hostPrefix+"from=2026-05-27/date=2026-05-28.tar.gz", 100, []byte("tarball"))

	dumper := NewDumper(src, dst, &config.Config{ListingRanges: 16})
	objects, err := dumper.listSource(ctx, hostPrefix, archivesOf(t, dst))
	if err != nil {
		t.Fatalf("listSource: %v", err)
	}

	want, _ := src.list(hostPrefix, "", "")
	if got := namesOf(objects); !reflect.DeepEqual(got, namesOf(want)) {
		t.Fatalf("Listed %d names, want the %d one listing gives, in its order", len(got), len(want))
	}
	if n := src.Listings.Load(); n != 0 {
		t.Errorf("Expected no listing in one go, got %d", n)
	}

	ranges := src.ranges()
	if len(ranges) != 16 {
		t.Fatalf("Expected 16 ranges, got %d: %v", len(ranges), ranges)
	}
	sort.Slice(ranges, func(i, j int) bool { return ranges[i][0] < ranges[j][0] })
	if ranges[0][0] != "" || ranges[len(ranges)-1][1] != "" {
		t.Errorf("The first and last ranges have to be open, got %v and %v", ranges[0], ranges[len(ranges)-1])
	}
	for i := 1; i < len(ranges); i++ {
		if ranges[i][0] != ranges[i-1][1] {
			t.Errorf("Range %d starts at %q, not where range %d ended, %q", i, ranges[i][0], i-1, ranges[i-1][1])
		}
	}

	// And about evenly: no range holds twice its share.
	for _, r := range ranges {
		part, _ := src.list(hostPrefix, r[0], r[1])
		if len(part) > 2*len(want)/16 {
			t.Errorf("Range %v holds %d of %d names", r, len(part), len(want))
		}
	}
}

// Without bounds to trust, the host is listed in one go, as before.
func TestListSourceListsInOneGoWithoutBounds(t *testing.T) {
	archived := crawl(2400, "2026-05-01")
	tests := []struct {
		name     string
		ranges   int
		archives map[string][]byte
	}{
		{name: "no archives", ranges: 16},
		{name: "not an archive", ranges: 16, archives: map[string][]byte{"from=2025-01-01/date=2026-05-27.tar.gz": []byte("tarball")}},
		{name: "an archive without an index first", ranges: 16, archives: map[string][]byte{"from=2025-01-01/date=2026-05-27.tar.gz": func() []byte {
			var buf bytes.Buffer
			gw := gzip.NewWriter(&buf)
			tw := tar.NewWriter(gw)
			_ = tw.WriteHeader(&tar.Header{Name: host + "/a.json", Size: 1, Mode: 0644})
			_, _ = tw.Write([]byte("x"))
			_ = tw.Close()
			_ = gw.Close()
			return buf.Bytes()
		}()}},
		{name: "too few names to split", ranges: 16, archives: map[string][]byte{"from=2025-01-01/date=2026-05-27.tar.gz": archiveWithIndex(t, archived[:listingSplitFrom-1])}},
		{name: "one range asked for", ranges: 1, archives: map[string][]byte{"from=2025-01-01/date=2026-05-27.tar.gz": archiveWithIndex(t, archived)}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := context.Background()
			src, dst := NewMockStorageClient(), NewMockStorageClient()
			addAll(src, archived)
			for name, content := range tt.archives {
				dst.AddObject(hostPrefix+name, int64(len(content)), content)
			}

			dumper := NewDumper(src, dst, &config.Config{ListingRanges: tt.ranges})
			objects, err := dumper.listSource(ctx, hostPrefix, archivesOf(t, dst))
			if err != nil {
				t.Fatalf("listSource: %v", err)
			}
			if len(objects) != len(archived) {
				t.Errorf("Listed %d names, want %d", len(objects), len(archived))
			}
			if n := src.Listings.Load(); n != 1 {
				t.Errorf("Expected one listing in one go, got %d", n)
			}
			if r := src.ranges(); len(r) != 0 {
				t.Errorf("Expected no ranges, got %v", r)
			}
		})
	}
}

// A range that cannot be listed fails the host, and nothing is archived: an
// archive of the other ranges would move the chain past what the failed one
// held, and the next run would never archive it.
func TestFailedRangeFailsTheHost(t *testing.T) {
	ctx := context.Background()
	src, dst := NewMockStorageClient(), NewMockStorageClient()
	archived := crawl(2400, "2026-05-01")
	addAll(src, archived)
	addAll(src, crawl(10, "2026-05-27"))
	dst.AddObject(hostPrefix+"from=2025-01-01/date=2026-05-26.tar.gz", 1<<20, archiveWithIndex(t, archived))

	names := append([]string(nil), archived...)
	sort.Strings(names)
	errList := errors.New("listing timed out")
	src.ErrListFrom = map[string]error{boundsOf(names, 16)[7]: errList}

	dumper := NewDumper(src, dst, &config.Config{Incremental: true, ListingRanges: 16})
	err := dumper.processHostnameIncremental(ctx, host, "2026-05-28", "2026-05-27")
	if !errors.Is(err, errList) {
		t.Fatalf("Expected the range's error, got %v", err)
	}
	if written := dst.written(); len(written) != 0 {
		t.Errorf("Expected nothing written, got %v", written)
	}
}

// Night after night: the archive one run writes is what the next run splits
// its listing by, and that run archives exactly what is new, in name order.
func TestIncrementalRunsSplitByTheChain(t *testing.T) {
	ctx := context.Background()
	src, dst := NewMockStorageClient(), NewMockStorageClient()
	addAll(src, crawl(2400, "2026-05-01"))
	cfg := &config.Config{Incremental: true, ListingRanges: 16, DownloadWorkers: 8, CompressWorkers: 1}
	dumper := NewDumper(src, dst, cfg)

	// The first run has no archive to split by.
	if err := dumper.processHostnameIncremental(ctx, host, "2026-05-02", "2026-05-01"); err != nil {
		t.Fatalf("First run: %v", err)
	}
	if n, r := src.Listings.Load(), src.ranges(); n != 1 || len(r) != 0 {
		t.Fatalf("Expected the first run to list in one go, got %d listings and %d ranges", n, len(r))
	}

	newer := crawl(30, "2026-05-02")
	addAll(src, newer)
	if err := dumper.processHostnameIncremental(ctx, host, "2026-05-03", "2026-05-02"); err != nil {
		t.Fatalf("Second run: %v", err)
	}
	if n, r := src.Listings.Load(), src.ranges(); n != 1 || len(r) != 16 {
		t.Fatalf("Expected the second run to list as 16 ranges, got %d listings and %d ranges", n, len(r))
	}

	second := hostPrefix + "from=2026-05-01/date=2026-05-02.tar.gz"
	members := readTarGz(t, dst.file(second))
	if len(members) == 0 || members[0].name != "index.txt" {
		t.Fatalf("Expected index.txt first in %s", second)
	}
	sort.Strings(newer)
	if index := strings.Split(strings.TrimSuffix(members[0].content, "\n"), "\n"); !reflect.DeepEqual(index, newer) {
		t.Errorf("%s indexes %d names, want the %d crawled on 05-02 in name order", second, len(index), len(newer))
	}
	if got := len(filesIn(t, members)); got != len(newer) {
		t.Errorf("%s holds %d files, want %d", second, got, len(newer))
	}
}

func TestBoundsOf(t *testing.T) {
	names := []string{"a", "b", "c", "d", "e", "f", "g", "h"}
	if got, want := boundsOf(names, 4), []string{"c", "e", "g"}; !reflect.DeepEqual(got, want) {
		t.Errorf("boundsOf(8 names, 4) = %v, want %v", got, want)
	}
	if got := boundsOf(names[:3], 4); got != nil {
		t.Errorf("boundsOf(3 names, 4) = %v, want none", got)
	}
}
