// Package secrets loads the Strava client secret from SSM Parameter Store, once per container.
package secrets

import (
	"context"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
)

// SSM returns a loader that fetches and decrypts the parameter on first use and caches it.
// Failures aren't cached, so a transient SSM error doesn't poison the container.
func SSM(client *ssm.Client, name string) func(context.Context) (string, error) {
	var mu sync.Mutex
	var value string
	return func(ctx context.Context) (string, error) {
		mu.Lock()
		defer mu.Unlock()
		if value != "" {
			return value, nil
		}
		out, err := client.GetParameter(ctx, &ssm.GetParameterInput{Name: aws.String(name), WithDecryption: aws.Bool(true)})
		if err != nil {
			return "", err
		}
		value = aws.ToString(out.Parameter.Value)
		return value, nil
	}
}
