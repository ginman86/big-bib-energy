package store

import (
	"context"
	"errors"
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
//	pk=ATHLETE#<id>  sk=RIDE#…    rides
//	pk=ATHLETE#<id>  sk=WORKOUT#… custom workouts (incl. tombstones)
//	pk=SESSION#<sha> sk=SESSION   athleteId, ttl
type Dynamo struct {
	DB    *dynamodb.Client
	Table string
}

func athleteKey(id int64) string { return "ATHLETE#" + fmtInt(id) }
func fmtInt(id int64) string     { return strconv.FormatInt(id, 10) }

// rideSK sorts rides by start time; the ID keeps same-second starts distinct.
func rideSK(startedAt time.Time, id string) string {
	return "RIDE#" + startedAt.UTC().Format(time.RFC3339) + "#" + id
}
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

func (d *Dynamo) PutRide(ctx context.Context, r *Ride) error {
	item, err := attributevalue.MarshalMap(r)
	if err != nil {
		return err
	}
	for k, v := range key(athleteKey(r.AthleteID), rideSK(r.StartedAt, r.ID)) {
		item[k] = v
	}
	_, err = d.DB.PutItem(ctx, &dynamodb.PutItemInput{TableName: &d.Table, Item: item})
	return err
}

func (d *Dynamo) PutRideIfAbsent(ctx context.Context, r *Ride) (bool, error) {
	item, err := attributevalue.MarshalMap(r)
	if err != nil {
		return false, err
	}
	for k, v := range key(athleteKey(r.AthleteID), rideSK(r.StartedAt, r.ID)) {
		item[k] = v
	}
	_, err = d.DB.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: &d.Table, Item: item, ConditionExpression: aws.String("attribute_not_exists(pk)"),
	})
	var exists *types.ConditionalCheckFailedException
	if errors.As(err, &exists) {
		return false, nil
	}
	return err == nil, err
}

func (d *Dynamo) GetRide(ctx context.Context, athleteID int64, startedAt time.Time, id string) (*Ride, error) {
	out, err := d.DB.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: &d.Table, Key: key(athleteKey(athleteID), rideSK(startedAt, id)), ConsistentRead: aws.Bool(true),
	})
	if err != nil || out.Item == nil {
		return nil, err
	}
	var r Ride
	if err := attributevalue.UnmarshalMap(out.Item, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func (d *Dynamo) ListRides(ctx context.Context, athleteID int64, since time.Time) ([]Ride, error) {
	var out []Ride
	var start map[string]types.AttributeValue
	for {
		res, err := d.DB.Query(ctx, &dynamodb.QueryInput{
			TableName:              &d.Table,
			KeyConditionExpression: aws.String("pk = :pk AND sk BETWEEN :from AND :to"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":pk":   &types.AttributeValueMemberS{Value: athleteKey(athleteID)},
				":from": &types.AttributeValueMemberS{Value: "RIDE#" + since.UTC().Format(time.RFC3339)},
				":to":   &types.AttributeValueMemberS{Value: "RIDE#~"},
			},
			ExclusiveStartKey: start,
		})
		if err != nil {
			return nil, err
		}
		var page []Ride
		if err := attributevalue.UnmarshalListOfMaps(res.Items, &page); err != nil {
			return nil, err
		}
		out = append(out, page...)
		if res.LastEvaluatedKey == nil {
			return out, nil
		}
		start = res.LastEvaluatedKey
	}
}

func customSK(kind, id string) string { return kind + "#" + id }

func (d *Dynamo) ListCustom(ctx context.Context, athleteID int64, kind string) ([]CustomItem, error) {
	var out []CustomItem
	var start map[string]types.AttributeValue
	for {
		res, err := d.DB.Query(ctx, &dynamodb.QueryInput{
			TableName:              &d.Table,
			KeyConditionExpression: aws.String("pk = :pk AND begins_with(sk, :w)"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":pk": &types.AttributeValueMemberS{Value: athleteKey(athleteID)},
				":w":  &types.AttributeValueMemberS{Value: customSK(kind, "")},
			},
			ExclusiveStartKey: start,
		})
		if err != nil {
			return nil, err
		}
		var page []CustomItem
		if err := attributevalue.UnmarshalListOfMaps(res.Items, &page); err != nil {
			return nil, err
		}
		for i := range page {
			page[i].Kind = kind
		}
		out = append(out, page...)
		if res.LastEvaluatedKey == nil {
			return out, nil
		}
		start = res.LastEvaluatedKey
	}
}

func (d *Dynamo) GetCustom(ctx context.Context, athleteID int64, kind, id string) (*CustomItem, error) {
	out, err := d.DB.GetItem(ctx, &dynamodb.GetItemInput{TableName: &d.Table, Key: key(athleteKey(athleteID), customSK(kind, id)), ConsistentRead: aws.Bool(true)})
	if err != nil || out.Item == nil {
		return nil, err
	}
	var w CustomItem
	if err := attributevalue.UnmarshalMap(out.Item, &w); err != nil {
		return nil, err
	}
	w.Kind = kind
	return &w, nil
}

func (d *Dynamo) PutCustom(ctx context.Context, w *CustomItem) error {
	item, err := attributevalue.MarshalMap(w)
	if err != nil {
		return err
	}
	for k, v := range key(athleteKey(w.AthleteID), customSK(w.Kind, w.ID)) {
		item[k] = v
	}
	_, err = d.DB.PutItem(ctx, &dynamodb.PutItemInput{TableName: &d.Table, Item: item})
	return err
}
