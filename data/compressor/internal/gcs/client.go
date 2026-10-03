package gcs

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"

	"cloud.google.com/go/storage"
	"google.golang.org/api/iterator"
)

type Client struct {
	client *storage.Client
	bucket *storage.BucketHandle
}

func NewClient(ctx context.Context, bucketName string) (*Client, error) {
	c, err := storage.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create storage client: %w", err)
	}
	return &Client{
		client: c,
		bucket: c.Bucket(bucketName),
	}, nil
}

func (c *Client) Close() error {
	return c.client.Close()
}

// listAttrs are the only object attributes a listing asks for. Without a
// selection GCS returns all of them (checksums, links, metadata and so on)
// for every object, and a run lists every object of every host it archives.
var listAttrs = []string{"Name", "Size", "Updated"}

func newQuery(prefix, delimiter string) (*storage.Query, error) {
	q := &storage.Query{Prefix: prefix, Delimiter: delimiter}
	if err := q.SetAttrSelection(listAttrs); err != nil {
		return nil, fmt.Errorf("failed to select listing fields: %w", err)
	}
	return q, nil
}

func (c *Client) ListObjects(ctx context.Context, prefix string) ([]*storage.ObjectAttrs, error) {
	q, err := newQuery(prefix, "")
	if err != nil {
		return nil, err
	}
	var objects []*storage.ObjectAttrs
	it := c.bucket.Objects(ctx, q)
	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to list objects: %w", err)
		}
		// Skip directories (if any exist as zero-byte objects)
		if strings.HasSuffix(attrs.Name, "/") {
			continue
		}
		objects = append(objects, attrs)
	}
	return objects, nil
}

func (c *Client) ListPrefixes(ctx context.Context, prefix string) ([]string, error) {
	// The selection keeps prefixes: the client always asks for them
	// alongside the selected object fields.
	q, err := newQuery(prefix, "/")
	if err != nil {
		return nil, err
	}
	var prefixes []string
	it := c.bucket.Objects(ctx, q)
	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to list prefixes: %w", err)
		}
		if attrs.Prefix != "" {
			prefixes = append(prefixes, attrs.Prefix)
		}
	}
	return prefixes, nil
}

func (c *Client) ReadObject(ctx context.Context, name string) (io.ReadCloser, error) {
	r, err := c.bucket.Object(name).NewReader(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create reader for %s: %w", name, err)
	}
	return r, nil
}

func (c *Client) WriteObject(ctx context.Context, name string) io.WriteCloser {
	return c.bucket.Object(name).NewWriter(ctx)
}

func (c *Client) ObjectExists(ctx context.Context, name string) (bool, error) {
	_, err := c.bucket.Object(name).Attrs(ctx)
	if err != nil {
		if errors.Is(err, storage.ErrObjectNotExist) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
