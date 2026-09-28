package store

import (
	"bytes"
	"context"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Blobs holds .fit files.
type Blobs interface {
	Put(ctx context.Context, key string, data []byte, contentType string) error
}

type S3Blobs struct {
	S3     *s3.Client
	Bucket string
}

func (b *S3Blobs) Put(ctx context.Context, key string, data []byte, contentType string) error {
	_, err := b.S3.PutObject(ctx, &s3.PutObjectInput{
		Bucket: &b.Bucket, Key: aws.String(key), Body: bytes.NewReader(data), ContentType: aws.String(contentType),
	})
	return err
}

type MemoryBlobs struct {
	mu    sync.Mutex
	Items map[string][]byte
}

func NewMemoryBlobs() *MemoryBlobs { return &MemoryBlobs{Items: map[string][]byte{}} }

func (m *MemoryBlobs) Put(_ context.Context, key string, data []byte, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Items[key] = append([]byte(nil), data...)
	return nil
}
