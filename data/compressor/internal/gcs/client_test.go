package gcs

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
)

// Both listings have to ask for the selected fields only, and the delimited
// one still has to get its prefixes back.
func TestListingsSelectFields(t *testing.T) {
	var mu sync.Mutex
	var fields []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		fields = append(fields, r.URL.Query().Get("fields"))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("delimiter") == "/" {
			fmt.Fprint(w, `{"prefixes": ["hostname=a.com/", "hostname=b.com/"]}`)
			return
		}
		fmt.Fprint(w, `{"items": [{"name": "hostname=a.com/date=2026-05-01.json", "size": "4"}]}`)
	}))
	defer srv.Close()
	t.Setenv("STORAGE_EMULATOR_HOST", srv.Listener.Addr().String())

	ctx := context.Background()
	c, err := NewClient(ctx, "bucket")
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer c.Close()

	objects, err := c.ListObjects(ctx, "hostname=a.com/")
	if err != nil {
		t.Fatalf("ListObjects: %v", err)
	}
	if len(objects) != 1 || objects[0].Name != "hostname=a.com/date=2026-05-01.json" || objects[0].Size != 4 {
		t.Errorf("ListObjects returned %+v", objects)
	}
	prefixes, err := c.ListPrefixes(ctx, "hostname=")
	if err != nil {
		t.Fatalf("ListPrefixes: %v", err)
	}
	if want := []string{"hostname=a.com/", "hostname=b.com/"}; !reflect.DeepEqual(prefixes, want) {
		t.Errorf("ListPrefixes returned %v, want %v", prefixes, want)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(fields) != 2 {
		t.Fatalf("Expected two list requests, got %d", len(fields))
	}
	for _, f := range fields {
		// The client writes the item fields in map order.
		start, end := strings.Index(f, "items("), strings.LastIndex(f, ")")
		if start < 0 || end < start || !strings.Contains(f, "prefixes") || !strings.Contains(f, "nextPageToken") {
			t.Errorf("Unexpected field selection %q", f)
			continue
		}
		items := strings.Split(f[start+len("items("):end], ",")
		sort.Strings(items)
		if want := []string{"name", "size", "updated"}; !reflect.DeepEqual(items, want) {
			t.Errorf("Listing asked for item fields %v, want %v", items, want)
		}
	}
}
