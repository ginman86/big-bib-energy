// Lambda entrypoint (provided.al2023, arm64). Build: GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -o bootstrap ./cmd/lambda
package main

import (
	"os"

	"github.com/aws/aws-lambda-go/lambda"

	"github.com/ginman86/big-bib-energy/api/internal/app"
	"github.com/ginman86/big-bib-energy/api/internal/lambdaurl"
)

func main() {
	a := app.New(app.Config{Version: os.Getenv("VERSION")})
	lambda.Start(lambdaurl.Handler(a.Handler()))
}
