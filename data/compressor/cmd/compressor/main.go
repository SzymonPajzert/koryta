package main

import (
	"context"
	"log"
	"os"
	"runtime"
	"runtime/pprof"

	"github.com/koryta/compressor/internal/config"
	"github.com/koryta/compressor/internal/gcs"
	"github.com/koryta/compressor/internal/processor"
)

func main() {
	cfg := config.Parse()

	if cfg.CpuProfile != "" {
		f, err := os.Create(cfg.CpuProfile)
		if err != nil {
			log.Fatal("could not create CPU profile: ", err)
		}
		defer f.Close()
		if err := pprof.StartCPUProfile(f); err != nil {
			log.Fatal("could not start CPU profile: ", err)
		}
		defer pprof.StopCPUProfile()
	}

	if cfg.BucketName == "" {
		log.Fatal("GCS bucket name is required. Set via -bucket flag or GCS_BUCKET environment variable.")
	}

	ctx := context.Background()

	client, err := gcs.NewClient(ctx, cfg.BucketName)
	if err != nil {
		log.Fatalf("Failed to initialize GCS source client: %v", err)
	}
	defer client.Close()

	outClient, err := gcs.NewClient(ctx, cfg.OutBucket)
	if err != nil {
		log.Fatalf("Failed to initialize GCS dest client: %v", err)
	}
	defer outClient.Close()

	dumper := processor.NewDumper(client, outClient, cfg)

	if err := dumper.Run(ctx); err != nil {
		log.Fatalf("Dumper run failed: %v", err)
	}

	log.Println("Compression job finished successfully.")

	if cfg.MemProfile != "" {
		f, err := os.Create(cfg.MemProfile)
		if err != nil {
			log.Fatal("could not create memory profile: ", err)
		}
		defer f.Close()
		runtime.GC() // get up-to-date statistics
		if err := pprof.WriteHeapProfile(f); err != nil {
			log.Fatal("could not write memory profile: ", err)
		}
	}

	os.Exit(0)
}
