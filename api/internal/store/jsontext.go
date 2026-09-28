package store

import (
	"encoding/json"
	"errors"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// JSONText is raw JSON stored as a readable DynamoDB string. It also reads the binary form
// that json.RawMessage produced before, so existing items keep working.
type JSONText json.RawMessage

func (j JSONText) MarshalJSON() ([]byte, error) {
	if len(j) == 0 {
		return []byte("null"), nil
	}
	return j, nil
}

func (j JSONText) MarshalDynamoDBAttributeValue() (types.AttributeValue, error) {
	if len(j) == 0 {
		return &types.AttributeValueMemberNULL{Value: true}, nil
	}
	return &types.AttributeValueMemberS{Value: string(j)}, nil
}

func (j *JSONText) UnmarshalDynamoDBAttributeValue(av types.AttributeValue) error {
	switch v := av.(type) {
	case *types.AttributeValueMemberS:
		*j = JSONText(v.Value)
	case *types.AttributeValueMemberB:
		*j = JSONText(v.Value)
	case *types.AttributeValueMemberNULL:
		*j = nil
	default:
		return errors.New("store: JSONText must be a string")
	}
	return nil
}

var (
	_ attributevalue.Marshaler   = JSONText(nil)
	_ attributevalue.Unmarshaler = (*JSONText)(nil)
)
