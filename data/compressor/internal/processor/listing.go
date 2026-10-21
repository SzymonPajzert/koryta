package processor

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/storage"
	"golang.org/x/sync/errgroup"
)

// Listing a host is all waiting: GCS answers one page of 1,000 names after
// another, about 1.3 s a page on a normal night. On 2026-10-09 and 10-20 it took
// 10-25 s a page, and api-krs.ms.gov.pl, about 45 pages, was still being listed
// when the night's 20 minutes for the host ran out, before a single file was
// read. Listed as ranges at once the waits overlap, as they do in the pipelines,
// which list the same two hosts as sixteen ranges (stores/storage.py): 66 s and
// 150 s on 10-20.
//
// Where to split comes from the names the host's archives already hold. Each
// one starts with an index.txt of every object in it, and the chain from
// 2025-01-01 names nearly all the host has - all but what was crawled since the
// newest archive - so the ranges come out about even without anything kept
// between runs, on the first night on a new machine too. Bounds only decide
// how evenly the work is shared: the ranges run from one bound to the next,
// the first and the last are open, so any bounds cover the prefix whole.

// defaultListingRanges is how many ranges a host is listed in when the config
// does not say.
const defaultListingRanges = 16

// listingSplitFrom is how many names the archives must hold for the host to be
// split: four pages, under two minutes in one listing even on a slow night.
const listingSplitFrom = 4000

// indexesRead is how many archives' indexes are read for the bounds: the
// largest, which name most of what the host holds. api-krs.ms.gov.pl had 16
// archives on 2026-10-21, all but three of them a day's crawl.
const indexesRead = 8

// listSource lists every object under prefix in the source bucket, in name
// order, as one listing would: as ranges at once when the host's archives say
// where to split it, and in one go when they cannot.
func (d *Dumper) listSource(ctx context.Context, prefix string, archives []*storage.ObjectAttrs) ([]*storage.ObjectAttrs, error) {
	started := time.Now()
	bounds := d.rangeBounds(ctx, prefix, archives)
	var objects []*storage.ObjectAttrs
	var err error
	if len(bounds) == 0 {
		objects, err = d.client.ListObjects(ctx, prefix)
	} else {
		log.Printf("Listing %s as %d ranges at once", prefix, len(bounds)+1)
		objects, err = d.listRanges(ctx, prefix, bounds)
	}
	if err != nil {
		return nil, err
	}
	// What a slow night shows first: ~1 min for either host on a normal one.
	log.Printf("Listed %d objects under %s in %v", len(objects), prefix, time.Since(started).Round(time.Second))
	return objects, nil
}

// listRanges lists prefix as the ranges between bounds, all at once, and
// joins them in order. One range that fails fails the listing: a listing with
// a range missing would archive the rest, and the next incremental run starts
// after that archive, so whatever the range held would never be archived.
func (d *Dumper) listRanges(ctx context.Context, prefix string, bounds []string) ([]*storage.ObjectAttrs, error) {
	edges := append(append([]string{""}, bounds...), "")
	parts := make([][]*storage.ObjectAttrs, len(edges)-1)
	g, gCtx := errgroup.WithContext(ctx)
	for i := range parts {
		g.Go(func() error {
			objects, err := d.client.ListObjectsRange(gCtx, prefix, edges[i], edges[i+1])
			if err != nil {
				return fmt.Errorf("failed to list %s from %q to %q: %w", prefix, edges[i], edges[i+1], err)
			}
			parts[i] = objects
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}
	var objects []*storage.ObjectAttrs
	for _, part := range parts {
		objects = append(objects, part...)
	}
	return objects, nil
}

// rangeBounds is where to split the listing of prefix: every nth of the names
// the largest of the host's archives list, or none to list it in one go - when
// the config asks for one range, or the archives name too few objects, or none
// of their indexes can be read.
func (d *Dumper) rangeBounds(ctx context.Context, prefix string, archives []*storage.ObjectAttrs) []string {
	n := d.cfg.ListingRanges
	if n <= 0 {
		n = defaultListingRanges
	}
	if n == 1 {
		return nil
	}

	var largest []*storage.ObjectAttrs
	for _, a := range archives {
		if strings.HasSuffix(a.Name, ".tar.gz") {
			largest = append(largest, a)
		}
	}
	sort.SliceStable(largest, func(i, j int) bool { return largest[i].Size > largest[j].Size })
	if len(largest) > indexesRead {
		largest = largest[:indexesRead]
	}

	var mu sync.Mutex
	known := make(map[string]bool)
	var wg sync.WaitGroup
	for _, a := range largest {
		wg.Add(1)
		go func() {
			defer wg.Done()
			names, err := d.archiveIndex(ctx, a.Name)
			if err != nil {
				// Only the split is lost: the bounds come from the indexes
				// that can be read, or the host is listed in one go.
				log.Printf("Could not read the index of %s, so it does not help split the listing: %v", a.Name, err)
				return
			}
			mu.Lock()
			defer mu.Unlock()
			for _, name := range names {
				if strings.HasPrefix(name, prefix) {
					known[name] = true
				}
			}
		}()
	}
	wg.Wait()

	if len(known) < listingSplitFrom {
		return nil
	}
	names := make([]string, 0, len(known))
	for name := range known {
		names = append(names, name)
	}
	sort.Strings(names)
	return boundsOf(names, n)
}

// boundsOf splits sorted, distinct names into n ranges of about as many names
// each: the n-1 names the ranges after the first start at.
func boundsOf(names []string, n int) []string {
	if len(names) < n {
		return nil
	}
	bounds := make([]string, 0, n-1)
	for i := 1; i < n; i++ {
		bounds = append(bounds, names[len(names)*i/n])
	}
	return bounds
}

// archiveIndex is the names an archive's index.txt lists, read off the start
// of the archive: every archive the compressor writes has it as its first
// member, so the rest of the archive is never downloaded.
func (d *Dumper) archiveIndex(ctx context.Context, name string) ([]string, error) {
	r, err := d.outClient.ReadObject(ctx, name)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	gr, err := gzip.NewReader(r)
	if err != nil {
		return nil, fmt.Errorf("not a gzip stream: %w", err)
	}
	tr := tar.NewReader(gr)
	header, err := tr.Next()
	if err != nil {
		return nil, fmt.Errorf("not a tar archive: %w", err)
	}
	if header.Name != "index.txt" {
		return nil, fmt.Errorf("starts with %s, not index.txt", header.Name)
	}
	// Reads to the end of the member, not of the archive.
	content, err := io.ReadAll(tr)
	if err != nil {
		return nil, fmt.Errorf("failed to read index.txt: %w", err)
	}
	// One name a line, as createTarGz's callers write it; a name may hold a space.
	var names []string
	for _, line := range strings.Split(string(content), "\n") {
		if line != "" {
			names = append(names, line)
		}
	}
	return names, nil
}
