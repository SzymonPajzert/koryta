package main

import (
	"context"
	"log"
	"os"

	"github.com/koryta/compressor/internal/config"
	"github.com/koryta/compressor/internal/gcs"
	"github.com/koryta/compressor/internal/processor"
)

func main() {
	cfg := config.Parse()

	if cfg.BucketName == "" {
		log.Fatal("GCS bucket name is required. Set via -bucket flag or GCS_BUCKET environment variable.")
	}

	ctx := context.Background()

	client, err := gcs.NewClient(ctx, cfg.BucketName)
	if err != nil {
		log.Fatalf("Failed to initialize GCS client: %v", err)
	}
	defer client.Close()

	dumper := processor.NewDumper(client, cfg)

	if err := dumper.Run(ctx); err != nil {
		log.Fatalf("Dumper run failed: %v", err)
	}

	log.Println("Compression job finished successfully.")
	os.Exit(0)
}
