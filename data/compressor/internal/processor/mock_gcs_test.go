package processor

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"

	"cloud.google.com/go/storage"
)

// mockWriteCloser behaves like a storage.Writer: the object exists only once
// Close succeeds, a failed upload stays failed, and cancelling the context the
// writer was opened with abandons the upload, so Close then returns the
// context's error and creates nothing.
type mockWriteCloser struct {
	*bytes.Buffer
	ctx        context.Context
	errWrite   error
	writeLimit int
	errClose   error
	err        error
	onClose    func(b []byte)
}

func (m *mockWriteCloser) Write(p []byte) (int, error) {
	if err := m.ctx.Err(); err != nil {
		return 0, err
	}
	if m.err != nil {
		return 0, m.err
	}
	if m.errWrite != nil && m.Len() >= m.writeLimit {
		m.err = m.errWrite
		return 0, m.err
	}
	return m.Buffer.Write(p)
}

func (m *mockWriteCloser) Close() error {
	if err := m.ctx.Err(); err != nil {
		return err
	}
	if m.err != nil {
		return m.err
	}
	if m.errClose != nil {
		return m.errClose
	}
	m.onClose(m.Bytes())
	return nil
}

type MockStorageClient struct {
	mu           sync.RWMutex
	Files        map[string][]byte
	Objects      map[string]*storage.ObjectAttrs
	ErrList      error
	ErrRead      error
	ErrWrite     error
	WriteTracker []string // objects created by a successful Close, in order
	PrefixCalls  atomic.Int32

	// ErrReadFor fails the reads of single objects, by name.
	ErrReadFor map[string]error
	// ErrWriteAfter is how many bytes a writer takes before every Write
	// fails with ErrWrite, the way an upload fails part way through when GCS
	// rejects a chunk.
	ErrWriteAfter int
	// ErrClose fails Close, which is where GCS reports the outcome of an
	// upload small enough to be sent in a single request.
	ErrClose error
}

func NewMockStorageClient() *MockStorageClient {
	return &MockStorageClient{
		Files:   make(map[string][]byte),
		Objects: make(map[string]*storage.ObjectAttrs),
	}
}

func (m *MockStorageClient) AddObject(name string, size int64, content []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Objects[name] = &storage.ObjectAttrs{Name: name, Size: size}
	m.Files[name] = content
}

func (m *MockStorageClient) file(name string) []byte {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.Files[name]
}

func (m *MockStorageClient) written() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return append([]string(nil), m.WriteTracker...)
}

func (m *MockStorageClient) ListObjects(ctx context.Context, prefix string) ([]*storage.ObjectAttrs, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.ErrList != nil {
		return nil, m.ErrList
	}

	var results []*storage.ObjectAttrs
	for name, attr := range m.Objects {
		if strings.HasPrefix(name, prefix) {
			results = append(results, attr)
		}
	}
	return results, nil
}

func (m *MockStorageClient) ListPrefixes(ctx context.Context, prefix string) ([]string, error) {
	m.PrefixCalls.Add(1)
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.ErrList != nil {
		return nil, m.ErrList
	}

	prefixSet := make(map[string]bool)
	for name := range m.Objects {
		if strings.HasPrefix(name, prefix) {
			remainder := name[len(prefix):]
			idx := strings.Index(remainder, "/")
			if idx != -1 {
				prefixSet[prefix+remainder[:idx+1]] = true
			}
		}
	}

	var results []string
	for p := range prefixSet {
		results = append(results, p)
	}
	return results, nil
}

func (m *MockStorageClient) ReadObject(ctx context.Context, name string) (io.ReadCloser, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if m.ErrRead != nil {
		return nil, m.ErrRead
	}
	if err := m.ErrReadFor[name]; err != nil {
		return nil, err
	}

	content, ok := m.Files[name]
	if !ok {
		return nil, fmt.Errorf("object %s not found", name)
	}
	return io.NopCloser(bytes.NewReader(content)), nil
}

func (m *MockStorageClient) WriteObject(ctx context.Context, name string) io.WriteCloser {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return &mockWriteCloser{
		Buffer:     bytes.NewBuffer(nil),
		ctx:        ctx,
		errWrite:   m.ErrWrite,
		writeLimit: m.ErrWriteAfter,
		errClose:   m.ErrClose,
		onClose: func(b []byte) {
			m.mu.Lock()
			m.Objects[name] = &storage.ObjectAttrs{Name: name, Size: int64(len(b))}
			m.Files[name] = b
			m.WriteTracker = append(m.WriteTracker, name)
			m.mu.Unlock()
		},
	}
}

func (m *MockStorageClient) ObjectExists(ctx context.Context, name string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.ErrRead != nil {
		return false, m.ErrRead
	}

	_, ok := m.Objects[name]
	return ok, nil
}
