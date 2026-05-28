package config

import (
	"flag"
	"os"
)

type Config struct {
	BucketName      string
	OutBucket       string
	SourcePrefix    string
	Incremental     bool
	DryRun          bool
	DownloadWorkers int
}

func Parse() *Config {
	cfg := &Config{}

	flag.StringVar(&cfg.BucketName, "in-bucket", os.Getenv("GCS_BUCKET"), "Source GCS bucket name (or GCS_BUCKET env var)")
	flag.StringVar(&cfg.OutBucket, "out-bucket", os.Getenv("GCS_OUT_BUCKET"), "Destination GCS bucket name (defaults to source bucket)")
	flag.StringVar(&cfg.SourcePrefix, "source-prefix", "", "Prefix for source files (e.g., 'raw/')")
	flag.BoolVar(&cfg.Incremental, "incremental", false, "Create incremental block dumps per hostname")
	flag.BoolVar(&cfg.DryRun, "dry-run", false, "Do not write any files to GCS")
	flag.IntVar(&cfg.DownloadWorkers, "download-workers", 10, "Number of concurrent file downloads per dump")

	flag.Parse()

	if cfg.OutBucket == "" {
		cfg.OutBucket = cfg.BucketName
	}

	return cfg
}
