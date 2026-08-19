package main

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// One table, two kinds of record told apart by the key prefix:
//
//	quota#<deviceId>#<YYYY-MM-DD>   daily counter, TTL +48h
//	device#<deviceId>               per-device overrides, no TTL, created by hand
//
// Nothing here holds user text. The device id and a counter is the whole of it.

// fetchDeviceOverride reads the hand-made overrides for this device. There is no
// self-service API for them and there will not be one: an endpoint that lets you
// raise your own limits is the hole itself.
func fetchDeviceOverride(ctx context.Context, deviceID string) (deviceOverride, error) {
	out, err := dynamoClient.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(cfg.tableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: "device#" + deviceID},
		},
	})
	if err != nil {
		return deviceOverride{}, err
	}

	override := deviceOverride{}
	if item, ok := out.Item["model"].(*types.AttributeValueMemberS); ok {
		override.model = item.Value
	}
	override.maxSummaryTokens = numberAttribute(out.Item, "maxSummaryTokens")
	override.dailyQuota = numberAttribute(out.Item, "dailyQuota")
	return override, nil
}

func numberAttribute(item map[string]types.AttributeValue, name string) int {
	attribute, ok := item[name].(*types.AttributeValueMemberN)
	if !ok {
		return 0
	}
	value, err := strconv.Atoi(attribute.Value)
	if err != nil {
		return 0
	}
	return value
}

// chargeQuota increments the daily counter and reports whether the request fits under
// the limit. One conditional UpdateItem, never a read followed by a write: parallel
// requests would walk straight past a limit checked that way.
//
// It runs before Bedrock is called, which is why a request that later fails upstream
// does not get its quota back. Refunding would mean a compensating write on the
// failure path that can itself fail, for an event that is rare when the service works
// and beside the point when it does not.
func chargeQuota(ctx context.Context, deviceID string, dailyQuota int) (bool, error) {
	now := time.Now()
	// The day boundary is local midnight in the configured zone, taken from the IANA
	// database by name. A fixed offset would break twice a year on daylight saving.
	day := now.In(cfg.quotaLocation).Format("2006-01-02")
	expiresAt := now.Add(48 * time.Hour).Unix()

	_, err := dynamoClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(cfg.tableName),
		Key: map[string]types.AttributeValue{
			"pk": &types.AttributeValueMemberS{Value: "quota#" + deviceID + "#" + day},
		},
		UpdateExpression:    aws.String("SET #count = if_not_exists(#count, :zero) + :one, #ttl = if_not_exists(#ttl, :expires)"),
		ConditionExpression: aws.String("attribute_not_exists(#count) OR #count < :limit"),
		ExpressionAttributeNames: map[string]string{
			"#count": "count", // reserved word in DynamoDB, hence the alias
			"#ttl":   "ttl",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":zero":    &types.AttributeValueMemberN{Value: "0"},
			":one":     &types.AttributeValueMemberN{Value: "1"},
			":limit":   &types.AttributeValueMemberN{Value: strconv.Itoa(dailyQuota)},
			":expires": &types.AttributeValueMemberN{Value: strconv.FormatInt(expiresAt, 10)},
		},
	})

	var limitReached *types.ConditionalCheckFailedException
	if errors.As(err, &limitReached) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}
