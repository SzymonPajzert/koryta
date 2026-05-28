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

	"github.com/koryta/compressor/internal/config"
	"github.com/koryta/compressor/internal/gcs"
)

type Dumper struct {
	client *gcs.Client
	cfg    *config.Config
}

func NewDumper(client *gcs.Client, cfg *config.Config) *Dumper {
	return &Dumper{
		client: client,
		cfg:    cfg,
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

	today := time.Now().UTC().Format("2006-01-02")
	
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

	byDate := make(map[string][]FileInfo)
	var byDateMutex sync.Mutex
	
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
				if err := d.processHostname(ctx, hostname, today, &byDateMutex, byDate); err != nil {
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
	
	log.Printf("Hostname processing complete. Generating %d date dumps...", len(byDate))
	
	for date, files := range byDate {
		if err := d.processDateDump(ctx, date, files); err != nil {
			log.Printf("Error processing date dump %s: %v", date, err)
		}
	}
	
	log.Println("Run completed successfully")
	return nil
}

func (d *Dumper) processHostname(ctx context.Context, hostname, today string, mu *sync.Mutex, globalByDate map[string][]FileInfo) error {
	// Find what's already processed for THIS hostname
	processed := make(map[string]bool)
	dumpsPrefix := fmt.Sprintf("%sby-hostname/%s/", d.cfg.DumpPrefix, hostname)
	dumpObjects, err := d.client.ListObjects(ctx, dumpsPrefix)
	if err != nil {
		return err
	}
	
	// Dump format: dumps/by-hostname/<hostname>/<date>.tar.gz
	for _, obj := range dumpObjects {
		parts := strings.Split(obj.Name, "/")
		filename := parts[len(parts)-1]
		if strings.HasSuffix(filename, ".tar.gz") {
			date := strings.TrimSuffix(filename, ".tar.gz")
			processed[date] = true
		}
	}
	
	// List files for this hostname
	sourcePrefix := fmt.Sprintf("%shostname=%s/", d.cfg.SourcePrefix, hostname)
	sourceObjects, err := d.client.ListObjects(ctx, sourcePrefix)
	if err != nil {
		return err
	}
	
	sourceRegex := regexp.MustCompile(`date=([^.]+)(?:\..+)?$`)
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
		if err := d.processHostnameDump(ctx, hostname, date, files); err != nil {
			return err
		}
		
		// If successful, add to global date map
		mu.Lock()
		globalByDate[date] = append(globalByDate[date], files...)
		mu.Unlock()
	}
	
	return nil
}

func (d *Dumper) createTarGz(ctx context.Context, destPath string, files []FileInfo, indexContent string) error {
	if d.cfg.DryRun {
		log.Printf("[DRY-RUN] Would create %s with %d files", destPath, len(files))
		return nil
	}

	log.Printf("Creating %s...", destPath)
	w := d.client.WriteObject(ctx, destPath)
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

func (d *Dumper) appendFileToTar(ctx context.Context, tw *tar.Writer, file FileInfo) error {
	r, err := d.client.ReadObject(ctx, file.Name)
	if err != nil {
		return fmt.Errorf("failed to read %s: %w", file.Name, err)
	}
	defer r.Close()

	// Extract filename from the path
	parts := strings.Split(file.Name, "/")
	filename := parts[len(parts)-1]
	
	// Create a logical structure inside the tar
	// e.g. hostname=example.com/date=2026-05-23.json
	headerName := fmt.Sprintf("%s/%s", file.Hostname, filename)

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

func (d *Dumper) processDateDump(ctx context.Context, date string, files []FileInfo) error {
	destPath := fmt.Sprintf("%sby-date/%s.tar.gz", d.cfg.DumpPrefix, date)
	
	// Check if already exists (might have been created but hostname dump failed)
	exists, err := d.client.ObjectExists(ctx, destPath)
	if err != nil {
		return err
	}
	if exists && !d.cfg.DryRun {
		log.Printf("Date dump %s already exists, skipping", destPath)
		return nil
	}

	hostnamesMap := make(map[string]bool)
	for _, f := range files {
		hostnamesMap[f.Hostname] = true
	}
	
	var hostnames []string
	for h := range hostnamesMap {
		hostnames = append(hostnames, h)
	}
	
	indexContent := strings.Join(hostnames, "\n") + "\n"

	return d.createTarGz(ctx, destPath, files, indexContent)
}

func (d *Dumper) processHostnameDump(ctx context.Context, hostname, date string, files []FileInfo) error {
	destPath := fmt.Sprintf("%sby-hostname/%s/%s.tar.gz", d.cfg.DumpPrefix, hostname, date)
	
	// List of files/dates included
	var fileList []string
	for _, f := range files {
		parts := strings.Split(f.Name, "/")
		fileList = append(fileList, parts[len(parts)-1])
	}
	
	indexContent := strings.Join(fileList, "\n") + "\n"

	return d.createTarGz(ctx, destPath, files, indexContent)
}
