package processor

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"cloud.google.com/go/storage"
	"github.com/koryta/compressor/internal/config"
)

type StorageClient interface {
	ListObjects(ctx context.Context, prefix string) ([]*storage.ObjectAttrs, error)
	ListPrefixes(ctx context.Context, prefix string) ([]string, error)
	ReadObject(ctx context.Context, name string) (io.ReadCloser, error)
	WriteObject(ctx context.Context, name string) io.WriteCloser
	ObjectExists(ctx context.Context, name string) (bool, error)
}

type Dumper struct {
	client    StorageClient
	outClient StorageClient
	cfg       *config.Config
}

func NewDumper(client, outClient StorageClient, cfg *config.Config) *Dumper {
	return &Dumper{
		client:    client,
		outClient: outClient,
		cfg:       cfg,
	}
}

type FileInfo struct {
	Name     string
	Hostname string
	Date     string
	Size     int64
}

func (d *Dumper) Run(ctx context.Context) error {
	log.Println("Starting discovery...")

	now := time.Now().UTC()
	today := now.Format("2006-01-02")
	yesterday := now.AddDate(0, 0, -1).Format("2006-01-02")
	
	// Discover all hostnames using hierarchical listing
	log.Println("Discovering hostnames...")
	prefixes, err := d.client.ListPrefixes(ctx, d.cfg.SourcePrefix+"hostname=")
	if err != nil {
		return fmt.Errorf("failed to list hostnames: %w", err)
	}
	
	var hostnames []string
	for _, p := range prefixes {
		// p is like "hostname=example.com/"
		parts := strings.Split(strings.TrimSuffix(p, "/"), "=")
		if len(parts) == 2 {
			hostnames = append(hostnames, parts[1])
		}
	}
	log.Printf("Found %d hostnames", len(hostnames))

	// Worker pool
	numWorkers := 50
	if len(hostnames) < numWorkers {
		numWorkers = len(hostnames)
	}
	if numWorkers == 0 {
		log.Println("No hostnames found. Run completed successfully.")
		return nil
	}

	workCh := make(chan string, len(hostnames))
	for _, h := range hostnames {
		workCh <- h
	}
	close(workCh)
	
	var wg sync.WaitGroup
	errCh := make(chan error, len(hostnames))
	
	var processedCount int32
	totalHostnames := int32(len(hostnames))

	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for hostname := range workCh {
				var err error
				if d.cfg.HostnameOnly {
					err = d.processHostnameTotal(ctx, hostname, today, yesterday)
				} else {
					err = d.processHostname(ctx, hostname, today)
				}
				
				if err != nil {
					errCh <- fmt.Errorf("failed processing %s: %w", hostname, err)
				}
				
				current := atomic.AddInt32(&processedCount, 1)
				if current%50 == 0 || current == totalHostnames {
					log.Printf("Progress: %d/%d hostnames scanned (%.1f%%)", current, totalHostnames, float64(current)/float64(totalHostnames)*100)
				}
			}
		}()
	}
	
	wg.Wait()
	close(errCh)
	
	var errs []error
	for err := range errCh {
		errs = append(errs, err)
	}
	if len(errs) > 0 {
		log.Printf("Encountered %d errors during hostname processing", len(errs))
		for i, err := range errs {
			if i < 5 {
				log.Println(err)
			}
		}
		if len(errs) > 5 {
			log.Println("... and more")
		}
	}
	
	log.Println("Run completed successfully")
	return nil
}

func (d *Dumper) processHostname(ctx context.Context, hostname, today string) error {
	// Find what's already processed for THIS hostname in the output bucket
	processed := make(map[string]bool)
	dumpsPrefix := fmt.Sprintf("hostname=%s/", hostname)
	dumpObjects, err := d.outClient.ListObjects(ctx, dumpsPrefix)
	if err != nil {
		return err
	}
	
	// Dump format: hostname=<hostname>/date=<date>.tar.gz
	dumpRegex := regexp.MustCompile(`date=([^.]+)\.tar\.gz$`)
	for _, obj := range dumpObjects {
		matches := dumpRegex.FindStringSubmatch(obj.Name)
		if len(matches) == 2 {
			processed[matches[1]] = true
		}
	}
	
	// List files for this hostname in the source bucket
	sourcePrefix := fmt.Sprintf("%shostname=%s/", d.cfg.SourcePrefix, hostname)
	sourceObjects, err := d.client.ListObjects(ctx, sourcePrefix)
	if err != nil {
		return err
	}
	
	// Regex stops matching at the slash or dot so it captures just the date
	sourceRegex := regexp.MustCompile(`date=([^/.]+)`)
	byDate := make(map[string][]FileInfo)
	
	for _, obj := range sourceObjects {
		matches := sourceRegex.FindStringSubmatch(obj.Name)
		if len(matches) != 2 {
			continue
		}
		date := matches[1]
		
		if date == today || processed[date] {
			continue
		}
		
		info := FileInfo{
			Name:     obj.Name,
			Hostname: hostname,
			Date:     date,
			Size:     obj.Size,
		}
		
		byDate[date] = append(byDate[date], info)
	}
	
	if len(byDate) > 0 {
		log.Printf("Hostname %s: found %d new dates to archive", hostname, len(byDate))
	}
	
	// Generate missing hostname dumps
	for date, files := range byDate {
		if err := d.processDump(ctx, hostname, date, files); err != nil {
			return err
		}
	}
	
	return nil
}

func (d *Dumper) processHostnameTotal(ctx context.Context, hostname, today, yesterday string) error {
	destPath := fmt.Sprintf("hostname=%s/total/date=%s.tar.gz", hostname, yesterday)
	
	exists, err := d.outClient.ObjectExists(ctx, destPath)
	if err != nil {
		return err
	}
	if exists && !d.cfg.DryRun {
		log.Printf("Total dump %s already exists, skipping", destPath)
		return nil
	}

	maxDumpDate, err := d.getLatestTotalDumpDate(ctx, hostname)
	if err != nil {
		return err
	}

	// List files for this hostname in the source bucket
	sourcePrefix := fmt.Sprintf("%shostname=%s/", d.cfg.SourcePrefix, hostname)
	sourceObjects, err := d.client.ListObjects(ctx, sourcePrefix)
	if err != nil {
		return err
	}

	sourceRegex := regexp.MustCompile(`date=([^/.]+)`)
	var allFiles []FileInfo
	
	for _, obj := range sourceObjects {
		matches := sourceRegex.FindStringSubmatch(obj.Name)
		if len(matches) != 2 {
			continue
		}
		date := matches[1]
		
		if date == today {
			continue
		}
		
		allFiles = append(allFiles, FileInfo{
			Name:     obj.Name,
			Hostname: hostname,
			Date:     date,
			Size:     obj.Size,
		})
	}
	
	if len(allFiles) == 0 {
		return nil
	}

	hasNewData := false
	if maxDumpDate == "" {
		hasNewData = true
	} else {
		for _, f := range allFiles {
			if f.Date > maxDumpDate && f.Date <= yesterday {
				hasNewData = true
				break
			}
		}
	}

	if !hasNewData {
		log.Printf("Hostname %s: no new data since last dump on %s, skipping", hostname, maxDumpDate)
		return nil
	}

	log.Printf("Hostname %s: found %d files for total dump up to %s", hostname, len(allFiles), yesterday)
	
	// Create dump
	var fileList []string
	for _, f := range allFiles {
		fileList = append(fileList, f.Name)
	}
	indexContent := strings.Join(fileList, "\n") + "\n"

	return d.createTarGz(ctx, destPath, allFiles, indexContent)
}

func (d *Dumper) getLatestTotalDumpDate(ctx context.Context, hostname string) (string, error) {
	prefix := fmt.Sprintf("hostname=%s/total/date=", hostname)
	objects, err := d.outClient.ListObjects(ctx, prefix)
	if err != nil {
		return "", err
	}
	
	dumpRegex := regexp.MustCompile(`date=([^.]+)\.tar\.gz$`)
	maxDate := ""
	for _, obj := range objects {
		matches := dumpRegex.FindStringSubmatch(obj.Name)
		if len(matches) == 2 {
			if maxDate == "" || matches[1] > maxDate {
				maxDate = matches[1]
			}
		}
	}
	return maxDate, nil
}

func (d *Dumper) processDump(ctx context.Context, hostname, date string, files []FileInfo) error {
	destPath := fmt.Sprintf("hostname=%s/date=%s.tar.gz", hostname, date)
	
	// List of files/dates included
	var fileList []string
	for _, f := range files {
		fileList = append(fileList, f.Name)
	}
	
	indexContent := strings.Join(fileList, "\n") + "\n"

	return d.createTarGz(ctx, destPath, files, indexContent)
}

func (d *Dumper) createTarGz(ctx context.Context, destPath string, files []FileInfo, indexContent string) error {
	if d.cfg.DryRun {
		log.Printf("[DRY-RUN] Would create %s with %d files", destPath, len(files))
		return nil
	}

	log.Printf("Creating %s...", destPath)
	w := d.outClient.WriteObject(ctx, destPath)
	defer w.Close()

	gw := gzip.NewWriter(w)
	defer gw.Close()

	tw := tar.NewWriter(gw)
	defer tw.Close()

	// Write index file
	indexBytes := []byte(indexContent)
	indexHeader := &tar.Header{
		Name:    "index.txt",
		Size:    int64(len(indexBytes)),
		Mode:    0644,
		ModTime: time.Now(),
	}
	if err := tw.WriteHeader(indexHeader); err != nil {
		return fmt.Errorf("failed to write index header: %w", err)
	}
	if _, err := tw.Write(indexBytes); err != nil {
		return fmt.Errorf("failed to write index content: %w", err)
	}

	// Write actual files
	for _, file := range files {
		if err := d.appendFileToTar(ctx, tw, file); err != nil {
			return err
		}
	}

	return nil
}

func getTarHeaderName(hostname, filename string) string {
	hostnamePrefix := fmt.Sprintf("hostname=%s/", hostname)
	idx := strings.Index(filename, hostnamePrefix)
	
	var relPath string
	if idx != -1 {
		relPath = filename[idx+len(hostnamePrefix):]
	} else {
		parts := strings.Split(filename, "/")
		relPath = parts[len(parts)-1]
	}
	
	return fmt.Sprintf("%s/%s", hostname, relPath)
}

func (d *Dumper) appendFileToTar(ctx context.Context, tw *tar.Writer, file FileInfo) error {
	r, err := d.client.ReadObject(ctx, file.Name)
	if err != nil {
		return fmt.Errorf("failed to read %s: %w", file.Name, err)
	}
	defer r.Close()

	headerName := getTarHeaderName(file.Hostname, file.Name)

	header := &tar.Header{
		Name:    headerName,
		Size:    file.Size,
		Mode:    0644,
		ModTime: time.Now(),
	}

	if err := tw.WriteHeader(header); err != nil {
		return fmt.Errorf("failed to write header for %s: %w", file.Name, err)
	}

	if _, err := io.Copy(tw, r); err != nil {
		return fmt.Errorf("failed to copy content for %s: %w", file.Name, err)
	}

	return nil
}
