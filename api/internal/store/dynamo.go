package store

import (
	"context"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// Dynamo is the single-table DynamoDB Store:
//
//	pk=ATHLETE#<id>  sk=PROFILE   athlete + Strava tokens
//	pk=ATHLETE#<id>  sk=RIDE#…    rides (later milestones)
//	pk=SESSION#<sha> sk=SESSION   athleteId, ttl
type Dynamo struct {
	DB    *dynamodb.Client
	Table string
}

func athleteKey(id int64) string { return "ATHLETE#" + strconv.FormatInt(id, 10) }
func sessionKey(h string) string { return "SESSION#" + h }

func key(pk, sk string) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"pk": &types.AttributeValueMemberS{Value: pk},
		"sk": &types.AttributeValueMemberS{Value: sk},
	}
}

func (d *Dynamo) GetAthlete(ctx context.Context, id int64) (*Athlete, error) {
	out, err := d.DB.GetItem(ctx, &dynamodb.GetItemInput{TableName: &d.Table, Key: key(athleteKey(id), "PROFILE"), ConsistentRead: aws.Bool(true)})
	if err != nil || out.Item == nil {
		return nil, err
	}
	var a Athlete
	if err := attributevalue.UnmarshalMap(out.Item, &a); err != nil {
		return nil, err
	}
	return &a, nil
}

func (d *Dynamo) PutAthlete(ctx context.Context, a *Athlete) error {
	item, err := attributevalue.MarshalMap(a)
	if err != nil {
		return err
	}
	for k, v := range key(athleteKey(a.ID), "PROFILE") {
		item[k] = v
	}
	_, err = d.DB.PutItem(ctx, &dynamodb.PutItemInput{TableName: &d.Table, Item: item})
	return err
}

// DeleteAthlete removes every item under the athlete. Their other sessions expire via TTL; the
// app deletes the caller's own session.
func (d *Dynamo) DeleteAthlete(ctx context.Context, id int64) error {
	pk := athleteKey(id)
	var start map[string]types.AttributeValue
	for {
		out, err := d.DB.Query(ctx, &dynamodb.QueryInput{
			TableName:                 &d.Table,
			KeyConditionExpression:    aws.String("pk = :pk"),
			ExpressionAttributeValues: map[string]types.AttributeValue{":pk": &types.AttributeValueMemberS{Value: pk}},
			ProjectionExpression:      aws.String("pk, sk"),
			ExclusiveStartKey:         start,
		})
		if err != nil {
			return err
		}
		for i := 0; i < len(out.Items); i += 25 {
			batch := out.Items[i:min(i+25, len(out.Items))]
			reqs := make([]types.WriteRequest, len(batch))
			for j, it := range batch {
				reqs[j] = types.WriteRequest{DeleteRequest: &types.DeleteRequest{Key: it}}
			}
			if _, err := d.DB.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{RequestItems: map[string][]types.WriteRequest{d.Table: reqs}}); err != nil {
				return err
			}
		}
		if out.LastEvaluatedKey == nil {
			return nil
		}
		start = out.LastEvaluatedKey
	}
}

type sessionItem struct {
	AthleteID int64 `dynamodbav:"athleteId"`
	TTL       int64 `dynamodbav:"ttl"`
}

func (d *Dynamo) PutSession(ctx context.Context, hash string, athleteID int64, expires time.Time) error {
	item, err := attributevalue.MarshalMap(sessionItem{athleteID, expires.Unix()})
	if err != nil {
		return err
	}
	for k, v := range key(sessionKey(hash), "SESSION") {
		item[k] = v
	}
	_, err = d.DB.PutItem(ctx, &dynamodb.PutItemInput{TableName: &d.Table, Item: item})
	return err
}

func (d *Dynamo) GetSession(ctx context.Context, hash string, now time.Time) (int64, bool, error) {
	out, err := d.DB.GetItem(ctx, &dynamodb.GetItemInput{TableName: &d.Table, Key: key(sessionKey(hash), "SESSION")})
	if err != nil || out.Item == nil {
		return 0, false, err
	}
	var s sessionItem
	if err := attributevalue.UnmarshalMap(out.Item, &s); err != nil {
		return 0, false, err
	}
	// TTL deletion is lazy (can lag by days), so check expiry ourselves.
	if now.Unix() >= s.TTL {
		return 0, false, nil
	}
	return s.AthleteID, true, nil
}

func (d *Dynamo) DeleteSession(ctx context.Context, hash string) error {
	_, err := d.DB.DeleteItem(ctx, &dynamodb.DeleteItemInput{TableName: &d.Table, Key: key(sessionKey(hash), "SESSION")})
	return err
}
