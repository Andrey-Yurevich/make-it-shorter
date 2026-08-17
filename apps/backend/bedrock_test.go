package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
)

// The tool schema must be byte-identical from one request to the next. It is built from
// a Go map, and a map has no order, so the guarantee rests entirely on the smithy
// encoder sorting keys. If that ever stops being true nothing breaks visibly: the
// grammar is recompiled and the prompt cache is lost, and only the bill says so.
func TestToolSchemaSerializesIdentically(t *testing.T) {
	cfg = &config{maxActions: 5}
	cat := loadTestCatalog(t, `{"version": 1, "actions": [
		{"id": "whats_the_catch", "since": 1, "description": "d", "instruction": "i"},
		{"id": "who_says_so", "since": 1, "description": "d", "instruction": "i"}]}`)

	schema := toolSchemaOf(t, buildToolDefinition(cat))
	first, err := schema.MarshalSmithyDocument()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 50; i++ {
		again, err := schema.MarshalSmithyDocument()
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(first, again) {
			t.Fatalf("the schema serialized differently on run %d:\n%s\n%s", i, first, again)
		}
	}

	// The enum is the whole point of the schema: an id outside it cannot be generated.
	serialized := string(first)
	for _, want := range []string{`"whats_the_catch"`, `"who_says_so"`, `"other"`} {
		if !strings.Contains(serialized, want) {
			t.Errorf("schema is missing %s:\n%s", want, serialized)
		}
	}
}

// maxItems and strict cannot coexist: Bedrock refuses a tool spec carrying both with
// "For 'array' type, property 'maxItems' is not supported", and it refuses it on every
// request, so putting it back is a total outage rather than a degraded result. The
// count ceiling lives in the prompt, and filterActionIDs still enforces it for real.
func TestToolSchemaHasNoMaxItems(t *testing.T) {
	cfg = &config{maxActions: 3}
	cat := loadTestCatalog(t, `{"version": 1, "actions": [
		{"id": "a", "since": 1, "description": "d", "instruction": "i"}]}`)

	schema, err := toolSchemaOf(t, buildToolDefinition(cat)).MarshalSmithyDocument()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(schema), "maxItems") {
		t.Errorf("maxItems is back in the schema, which Bedrock rejects alongside strict:\n%s", schema)
	}
}

// A deprecated id is offered to nobody: it is absent from the enum as it is from the
// prompt table.
func TestToolSchemaExcludesDeprecatedIDs(t *testing.T) {
	cfg = &config{maxActions: 5}
	cat := loadTestCatalog(t, `{"version": 2, "actions": [
		{"id": "kept", "since": 1, "description": "d", "instruction": "i"},
		{"id": "gone", "since": 2, "description": "d", "instruction": "i", "deprecated": true}]}`)

	schema, err := toolSchemaOf(t, buildToolDefinition(cat)).MarshalSmithyDocument()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(schema), `"gone"`) {
		t.Errorf("a deprecated id reached the enum:\n%s", schema)
	}
}

func toolSchemaOf(t *testing.T, tool types.Tool) documentSchema {
	t.Helper()
	spec, ok := tool.(*types.ToolMemberToolSpec)
	if !ok {
		t.Fatalf("the tool must be a tool spec")
	}
	if spec.Value.Strict == nil || !*spec.Value.Strict {
		t.Fatalf("strict must be on: it is what makes an id outside the enum impossible to generate")
	}
	schema, ok := spec.Value.InputSchema.(*types.ToolInputSchemaMemberJson)
	if !ok {
		t.Fatalf("the input schema must be JSON")
	}
	return schema.Value
}

type documentSchema interface {
	MarshalSmithyDocument() ([]byte, error)
}
