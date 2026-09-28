// Lambda entrypoint (provided.al2023, arm64). Build: GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -o bootstrap ./cmd/lambda
package main

import (
	"context"
	"log"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/ssm"

	"github.com/ginman86/big-bib-energy/api/internal/app"
	"github.com/ginman86/big-bib-energy/api/internal/lambdaurl"
	"github.com/ginman86/big-bib-energy/api/internal/secrets"
	"github.com/ginman86/big-bib-energy/api/internal/store"
	"github.com/ginman86/big-bib-energy/api/internal/strava"
)

func main() {
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Fatal(err)
	}
	st := &store.Dynamo{DB: dynamodb.NewFromConfig(cfg), Table: os.Getenv("TABLE")}
	sc := strava.New(os.Getenv("STRAVA_CLIENT_ID"), secrets.SSM(ssm.NewFromConfig(cfg), os.Getenv("STRAVA_SECRET_PARAM")))
	a := app.New(app.Config{Version: os.Getenv("VERSION"), Origins: []string{os.Getenv("SITE_ORIGIN")}}, st, sc)
	lambda.Start(lambdaurl.Handler(a.Handler()))
}
