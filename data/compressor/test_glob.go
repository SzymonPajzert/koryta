package main

import (
	"fmt"
	"cloud.google.com/go/storage"
)

func main() {
	q := &storage.Query{MatchGlob: "**/date=2026-05-23*"}
	fmt.Println(q.MatchGlob)
}
