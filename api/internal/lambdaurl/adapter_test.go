package lambdaurl

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func event(method, path, query, body string, b64 bool) events.LambdaFunctionURLRequest {
	e := events.LambdaFunctionURLRequest{
		RawPath:         path,
		RawQueryString:  query,
		Body:            body,
		IsBase64Encoded: b64,
		Headers:         map[string]string{"content-type": "application/json", "host": "bigbib.ginman.dev"},
		Cookies:         []string{"bbe_session=abc", "other=1"},
	}
	e.RequestContext.HTTP.Method = method
	return e
}

func TestRoundTrip(t *testing.T) {
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/echo" || r.URL.Query().Get("x") != "1" {
			t.Errorf("got %s %s?%s", r.Method, r.URL.Path, r.URL.RawQuery)
		}
		if c, err := r.Cookie("bbe_session"); err != nil || c.Value != "abc" {
			t.Errorf("cookie: %v %v", c, err)
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("content-type %q", r.Header.Get("Content-Type"))
		}
		b, _ := io.ReadAll(r.Body)
		http.SetCookie(w, &http.Cookie{Name: "bbe_session", Value: "new", HttpOnly: true})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write(b)
	})
	res, err := Handler(h)(context.Background(), event("POST", "/api/echo", "x=1", `{"hi":true}`, false))
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 201 || res.Body != `{"hi":true}` || res.IsBase64Encoded {
		t.Errorf("response %+v", res)
	}
	if len(res.Cookies) != 1 || res.Cookies[0] != "bbe_session=new; HttpOnly" {
		t.Errorf("cookies %v", res.Cookies)
	}
	if _, ok := res.Headers["Set-Cookie"]; ok {
		t.Error("Set-Cookie should move to Cookies, not headers")
	}
}

func TestBinaryBodies(t *testing.T) {
	fit := []byte{0x0e, 0x20, 0xff, 0xfe, '.', 'F', 'I', 'T'}
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		_, _ = w.Write(b)
	})
	res, _ := Handler(h)(context.Background(), event("POST", "/api/rides", "", base64.StdEncoding.EncodeToString(fit), true))
	got, _ := base64.StdEncoding.DecodeString(res.Body)
	if !res.IsBase64Encoded || string(got) != string(fit) {
		t.Errorf("binary round trip: %+v", res)
	}
}
