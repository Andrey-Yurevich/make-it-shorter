package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The build test of the spec: the catalog that ships must satisfy every invariant.
// A broken catalog means buttons without labels on someone's screen.
func TestRepositoryCatalogIsValid(t *testing.T) {
	cat, err := loadCatalog(filepath.Join("..", "..", "catalog.json"))
	if err != nil {
		t.Fatalf("catalog.json in the repository root is not valid: %v", err)
	}
	if cat.Version < 1 {
		t.Fatalf("version must be at least 1, got %d", cat.Version)
	}
}

func TestValidateCatalog(t *testing.T) {
	cases := []struct {
		name    string
		json    string
		wantErr bool
	}{
		{
			name: "empty catalog is valid, it is what the skeleton runs on",
			json: `{"version": 1, "actions": []}`,
		},
		{
			name: "version equals the highest since",
			json: `{"version": 2, "actions": [
				{"id": "a", "since": 1, "description": "d", "instruction": "i"},
				{"id": "b", "since": 2, "description": "d", "instruction": "i"}]}`,
		},
		{
			name:    "version above the highest since",
			json:    `{"version": 3, "actions": [{"id": "a", "since": 1, "description": "d", "instruction": "i"}]}`,
			wantErr: true,
		},
		{
			name:    "since above version",
			json:    `{"version": 1, "actions": [{"id": "a", "since": 2, "description": "d", "instruction": "i"}]}`,
			wantErr: true,
		},
		{
			name: "duplicate id",
			json: `{"version": 1, "actions": [
				{"id": "a", "since": 1, "description": "d", "instruction": "i"},
				{"id": "a", "since": 1, "description": "d", "instruction": "i"}]}`,
			wantErr: true,
		},
		{
			name:    "empty description",
			json:    `{"version": 1, "actions": [{"id": "a", "since": 1, "description": " ", "instruction": "i"}]}`,
			wantErr: true,
		},
		{
			name:    "empty instruction",
			json:    `{"version": 1, "actions": [{"id": "a", "since": 1, "description": "d", "instruction": ""}]}`,
			wantErr: true,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "catalog.json")
			if err := os.WriteFile(path, []byte(testCase.json), 0o600); err != nil {
				t.Fatal(err)
			}
			_, err := loadCatalog(path)
			if testCase.wantErr && err == nil {
				t.Fatalf("expected an error, got none")
			}
			if !testCase.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

// A deprecated entry stays in the file and keeps a usable instruction, but is offered
// to neither the enum nor the prompt table.
func TestDeprecatedActionsAreNotOffered(t *testing.T) {
	cat := loadTestCatalog(t, `{"version": 2, "actions": [
		{"id": "kept", "since": 1, "description": "keep me", "instruction": "i"},
		{"id": "gone", "since": 2, "description": "drop me", "instruction": "i", "deprecated": true}]}`)

	if len(cat.activeIDs) != 1 || cat.activeIDs[0] != "kept" {
		t.Fatalf("activeIDs = %v, want [kept]", cat.activeIDs)
	}
	if strings.Contains(cat.descriptionTable, "drop me") {
		t.Fatalf("a deprecated description reached the prompt table")
	}
	if cat.byID["gone"].Instruction == "" {
		t.Fatalf("a deprecated action lost its instruction, so phase 2 could not answer it")
	}
}

func TestFilterActionIDs(t *testing.T) {
	cat := loadTestCatalog(t, `{"version": 3, "actions": [
		{"id": "old", "since": 1, "description": "d", "instruction": "i"},
		{"id": "new", "since": 3, "description": "d", "instruction": "i"}]}`)

	cases := []struct {
		name           string
		ids            []string
		catalogVersion int
		maxActions     int
		want           []string
	}{
		{name: "unknown ids are dropped", ids: []string{"old", "invented"}, catalogVersion: 3, maxActions: 5, want: []string{"old"}},
		{name: "an old client does not get a newer id", ids: []string{"old", "new"}, catalogVersion: 1, maxActions: 5, want: []string{"old"}},
		{name: "a current client gets both", ids: []string{"old", "new"}, catalogVersion: 3, maxActions: 5, want: []string{"old", "new"}},
		{name: "duplicates collapse", ids: []string{"old", "old"}, catalogVersion: 3, maxActions: 5, want: []string{"old"}},
		{name: "the list is cut to maxActions", ids: []string{"old", "new"}, catalogVersion: 3, maxActions: 1, want: []string{"old"}},
		{name: "no ids means an empty list, never a default set", ids: nil, catalogVersion: 3, maxActions: 5, want: []string{}},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := filterActionIDs(cat, testCase.ids, testCase.catalogVersion, testCase.maxActions)
			if len(got) != len(testCase.want) {
				t.Fatalf("got %v, want %v", got, testCase.want)
			}
			for i := range got {
				if got[i] != testCase.want[i] {
					t.Fatalf("got %v, want %v", got, testCase.want)
				}
			}
		})
	}
}

func loadTestCatalog(t *testing.T, contents string) *buttonCatalog {
	t.Helper()
	path := filepath.Join(t.TempDir(), "catalog.json")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	cat, err := loadCatalog(path)
	if err != nil {
		t.Fatal(err)
	}
	return cat
}
