package main

import (
	"cloud.google.com/go/storage"
	"fmt"
)

func main() {
	q := &storage.Query{MatchGlob: "**/date=2026-05-23*"}
	fmt.Println(q.MatchGlob)
}
