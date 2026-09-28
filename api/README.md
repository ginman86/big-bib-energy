# API

Go, one `http.Handler` (`internal/app`) served two ways:

- **Lambda** (`cmd/lambda`): behind CloudFront at `/api/*`, via a Function URL with IAM auth
  (only CloudFront, signing with OAC, can call it). `internal/lambdaurl` adapts Function URL
  events to `net/http`.
- **Locally** (`cmd/local`): `go run ./cmd/local` listens on `127.0.0.1:8787`, and Vite proxies
  `/api` to it during `npm run dev`.

```sh
go test ./...
# Lambda build (CI does this before terraform apply):
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -trimpath -ldflags="-s -w" -o dist/bootstrap ./cmd/lambda
```

Browser POST/PUT requests must send `x-amz-content-sha256` (the hex SHA-256 of the body):
CloudFront's OAC signs requests to the Lambda URL but doesn't hash request bodies itself.
