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
	
	// Discover already processed dumps
	processed := make(map[string]bool)
	dumpsPrefix := fmt.Sprintf("%sby-hostname/", d.cfg.DumpPrefix)
	dumpObjects, err := d.client.ListObjects(ctx, dumpsPrefix)
	if err != nil {
		return fmt.Errorf("failed to list dumps: %w", err)
	}

	// Dump format: dumps/by-hostname/<hostname>/<date>.tar.gz
	dumpRegex := regexp.MustCompile(fmt.Sprintf(`%sby-hostname/([^/]+)/([^.]+)\.tar\.gz`, regexp.QuoteMeta(d.cfg.DumpPrefix)))
	for _, obj := range dumpObjects {
		matches := dumpRegex.FindStringSubmatch(obj.Name)
		if len(matches) == 3 {
			hostname := matches[1]
			date := matches[2]
			processed[hostname+"|"+date] = true
		}
	}

	log.Printf("Found %d already processed hostname+date combinations", len(processed))

	// Discover source files
	sourceObjects, err := d.client.ListObjects(ctx, d.cfg.SourcePrefix)
	if err != nil {
		return fmt.Errorf("failed to list source objects: %w", err)
	}

	// Source format: hostname=<hostname>/date=<date>.<ext>
	sourceRegex := regexp.MustCompile(`hostname=([^/]+)/date=([^.]+)(?:\..+)?$`)
	
	byDate := make(map[string][]FileInfo)
	byHostname := make(map[string]map[string][]FileInfo)

	for _, obj := range sourceObjects {
		matches := sourceRegex.FindStringSubmatch(obj.Name)
		if len(matches) != 3 {
			continue
		}
		
		hostname := matches[1]
		date := matches[2]

		// Ignore current date
		if date == today {
			continue
		}

		// Check if already processed
		if processed[hostname+"|"+date] {
			continue
		}

		info := FileInfo{
			Name:     obj.Name,
			Hostname: hostname,
			Date:     date,
			Size:     obj.Size,
		}

		byDate[date] = append(byDate[date], info)
		
		if byHostname[hostname] == nil {
			byHostname[hostname] = make(map[string][]FileInfo)
		}
		byHostname[hostname][date] = append(byHostname[hostname][date], info)
	}

	log.Printf("Found %d dates and %d hostnames to process", len(byDate), len(byHostname))

	// Process Date Dumps
	for date, files := range byDate {
		if err := d.processDateDump(ctx, date, files); err != nil {
			log.Printf("Error processing date dump %s: %v", date, err)
		}
	}

	// Process Hostname Dumps
	for hostname, datesMap := range byHostname {
		for date, files := range datesMap {
			if err := d.processHostnameDump(ctx, hostname, date, files); err != nil {
				log.Printf("Error processing hostname dump %s %s: %v", hostname, date, err)
			}
		}
	}

	log.Println("Run completed successfully")
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
