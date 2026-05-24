package config

import (
	"flag"
	"os"
)

type Config struct {
	BucketName   string
	SourcePrefix string
	DumpPrefix   string
	DryRun       bool
}

func Parse() *Config {
	cfg := &Config{}
	
	flag.StringVar(&cfg.BucketName, "bucket", os.Getenv("GCS_BUCKET"), "GCS bucket name (or GCS_BUCKET env var)")
	flag.StringVar(&cfg.SourcePrefix, "source-prefix", "", "Prefix for source files (e.g., 'raw/')")
	flag.StringVar(&cfg.DumpPrefix, "dump-prefix", "dumps/", "Prefix for dumped archives")
	flag.BoolVar(&cfg.DryRun, "dry-run", false, "Do not write any files to GCS")
	
	flag.Parse()
	
	return cfg
}
