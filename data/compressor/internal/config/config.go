package config

import (
	"flag"
	"os"
)

type Config struct {
	BucketName      string
	OutBucket       string
	SourcePrefix    string
	Hostname        string
	Incremental     bool
	DryRun          bool
	HostWorkers     int
	DownloadWorkers int
	CompressWorkers int
	ListingRanges   int
	CpuProfile      string
	MemProfile      string
}

func Parse() *Config {
	cfg := &Config{}

	flag.StringVar(&cfg.BucketName, "in-bucket", os.Getenv("GCS_BUCKET"), "Source GCS bucket name (or GCS_BUCKET env var)")
	flag.StringVar(&cfg.OutBucket, "out-bucket", os.Getenv("GCS_OUT_BUCKET"), "Destination GCS bucket name (defaults to source bucket)")
	flag.StringVar(&cfg.SourcePrefix, "source-prefix", "", "Prefix for source files (e.g., 'raw/')")
	flag.StringVar(&cfg.Hostname, "hostname", "", "Process only this hostname (e.g. 'rejestr.io'). Skips discovery, so it does not pay for listing every other host.")
	flag.BoolVar(&cfg.Incremental, "incremental", false, "Create incremental block dumps per hostname")
	flag.BoolVar(&cfg.DryRun, "dry-run", false, "Do not write any files to GCS")
	flag.IntVar(&cfg.HostWorkers, "host-workers", 5, "Number of concurrent hostnames to process")
	flag.IntVar(&cfg.DownloadWorkers, "download-workers", 10, "Number of concurrent file downloads per dump")
	flag.IntVar(&cfg.CompressWorkers, "compress-workers", 5, "Number of concurrent dump generations per hostname")
	flag.IntVar(&cfg.ListingRanges, "listing-ranges", 16, "List a big hostname as this many name ranges at once, split where its archives' index.txt says (1 lists it in one go)")
	flag.StringVar(&cfg.CpuProfile, "cpuprofile", "", "Write cpu profile to file")
	flag.StringVar(&cfg.MemProfile, "memprofile", "", "Write memory profile to file")

	flag.Parse()

	if cfg.OutBucket == "" {
		cfg.OutBucket = cfg.BucketName
	}

	return cfg
}
