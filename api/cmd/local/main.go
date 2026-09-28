// Local dev server on :8787. `npm run dev` proxies /api here.
//
// Uses an in-memory store and the real Strava app. The client secret comes from
// STRAVA_CLIENT_SECRET, or from SSM with your AWS profile:
//
//	AWS_PROFILE=ginman go run ./cmd/local
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/ssm"

	"github.com/ginman86/big-bib-energy/api/internal/app"
	"github.com/ginman86/big-bib-energy/api/internal/secrets"
	"github.com/ginman86/big-bib-energy/api/internal/store"
	"github.com/ginman86/big-bib-energy/api/internal/strava"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8787", "listen address")
	clientID := flag.String("strava-client-id", "282789", "Strava API client ID")
	flag.Parse()

	secret := func(context.Context) (string, error) { return os.Getenv("STRAVA_CLIENT_SECRET"), nil }
	if os.Getenv("STRAVA_CLIENT_SECRET") == "" {
		cfg, err := config.LoadDefaultConfig(context.Background(), config.WithRegion("us-east-1"))
		if err != nil {
			log.Fatal(err)
		}
		secret = secrets.SSM(ssm.NewFromConfig(cfg), "/big-bib-energy/strava-client-secret")
	}

	a := app.New(
		app.Config{Version: "local", Origins: []string{"http://localhost:5173", "http://127.0.0.1:5173"}},
		store.NewMemory(),
		store.NewMemoryBlobs(),
		strava.New(*clientID, secret),
	)
	log.Printf("Big Bib Energy API on http://%s (in-memory store)", *addr)
	log.Fatal(http.ListenAndServe(*addr, a.Handler()))
}
