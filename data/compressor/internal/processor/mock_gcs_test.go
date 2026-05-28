package processor

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"sync"

	"cloud.google.com/go/storage"
)

type mockWriteCloser struct {
	*bytes.Buffer
	onClose func(b []byte)
}

func (m *mockWriteCloser) Close() error {
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
	WriteTracker []string
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

	if m.ErrRead != nil {
		return nil, m.ErrRead
	}

	content, ok := m.Files[name]
	if !ok {
		return nil, fmt.Errorf("object %s not found", name)
	}
	return io.NopCloser(bytes.NewReader(content)), nil
}

func (m *MockStorageClient) WriteObject(ctx context.Context, name string) io.WriteCloser {
	m.mu.Lock()
	m.WriteTracker = append(m.WriteTracker, name)
	m.mu.Unlock()

	return &mockWriteCloser{
		Buffer: bytes.NewBuffer(nil),
		onClose: func(b []byte) {
			m.mu.Lock()
			m.Objects[name] = &storage.ObjectAttrs{Name: name, Size: int64(len(b))}
			m.Files[name] = b
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
