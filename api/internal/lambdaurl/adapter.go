// Package lambdaurl runs a standard net/http handler behind a Lambda Function URL, so the same
// router serves both Lambda and a local dev server.
package lambdaurl

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/aws/aws-lambda-go/events"
)

// Handler adapts h to the Function URL event format.
func Handler(h http.Handler) func(context.Context, events.LambdaFunctionURLRequest) (events.LambdaFunctionURLResponse, error) {
	return func(ctx context.Context, e events.LambdaFunctionURLRequest) (events.LambdaFunctionURLResponse, error) {
		req, err := toRequest(ctx, e)
		if err != nil {
			return events.LambdaFunctionURLResponse{StatusCode: http.StatusBadRequest, Body: "bad request"}, nil
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return toResponse(rec.Result())
	}
}

func toRequest(ctx context.Context, e events.LambdaFunctionURLRequest) (*http.Request, error) {
	body := []byte(e.Body)
	if e.IsBase64Encoded {
		b, err := base64.StdEncoding.DecodeString(e.Body)
		if err != nil {
			return nil, err
		}
		body = b
	}
	u := url.URL{Path: e.RawPath, RawQuery: e.RawQueryString}
	req, err := http.NewRequestWithContext(ctx, e.RequestContext.HTTP.Method, u.String(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	for k, v := range e.Headers {
		req.Header.Set(k, v)
	}
	// Function URLs move cookies out of the headers into their own list.
	if len(e.Cookies) > 0 {
		req.Header.Set("Cookie", strings.Join(e.Cookies, "; "))
	}
	req.Host = e.Headers["host"]
	req.RemoteAddr = e.RequestContext.HTTP.SourceIP
	return req, nil
}

func toResponse(res *http.Response) (events.LambdaFunctionURLResponse, error) {
	body, err := io.ReadAll(res.Body)
	if err != nil {
		return events.LambdaFunctionURLResponse{}, err
	}
	out := events.LambdaFunctionURLResponse{StatusCode: res.StatusCode, Headers: map[string]string{}}
	for k, vs := range res.Header {
		if http.CanonicalHeaderKey(k) == "Set-Cookie" {
			out.Cookies = append(out.Cookies, vs...)
			continue
		}
		out.Headers[k] = strings.Join(vs, ", ")
	}
	if utf8.Valid(body) {
		out.Body = string(body)
	} else {
		out.Body = base64.StdEncoding.EncodeToString(body)
		out.IsBase64Encoded = true
	}
	return out, nil
}
