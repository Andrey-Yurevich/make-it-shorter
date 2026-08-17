package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// The button catalog is the only data both sides of the product share. It is read
// once at start and never changes afterwards: the enum of the tool schema and the
// id -> description table in the prompt are built from it and must stay byte-identical
// between requests, or the prompt cache is lost.
//
// The file lives in the repository root and is packaged next to the binary by
// make-release.sh. It is read rather than embedded because go:embed cannot reach
// outside the module directory, and a second copy inside apps/backend would make
// two sources of truth out of one.

type catalogAction struct {
	ID          string `json:"id"`
	Since       int    `json:"since"`
	Description string `json:"description"`
	Instruction string `json:"instruction"`
	Deprecated  bool   `json:"deprecated"`
}

type buttonCatalog struct {
	Version int             `json:"version"`
	Actions []catalogAction `json:"actions"`

	byID map[string]catalogAction

	// activeIDs and descriptionTable are the two static shapes the prompt needs:
	// the enum of the tool schema and the table that tells the model what each id means.
	// Deprecated entries appear in neither, but stay in byID — a deprecated id that
	// somehow reaches phase 2 still has an instruction to work from.
	activeIDs        []string
	descriptionTable string
}

func loadCatalog(path string) (*buttonCatalog, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	cat := &buttonCatalog{}
	if err := json.Unmarshal(raw, cat); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if err := validateCatalog(cat); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}

	cat.byID = make(map[string]catalogAction, len(cat.Actions))
	table := strings.Builder{}
	for _, action := range cat.Actions {
		cat.byID[action.ID] = action
		if action.Deprecated {
			continue
		}
		cat.activeIDs = append(cat.activeIDs, action.ID)
		table.WriteString(action.ID)
		table.WriteString(" — ")
		table.WriteString(action.Description)
		table.WriteString("\n")
	}
	cat.descriptionTable = table.String()

	return cat, nil
}

// validateCatalog is the build test of the spec, run at start as well: a catalog
// that breaks these rules produces buttons without labels on someone's screen.
func validateCatalog(cat *buttonCatalog) error {
	if cat.Version < 1 {
		return fmt.Errorf("version must be at least 1, got %d", cat.Version)
	}

	seen := map[string]bool{}
	maxSince := 0
	for _, action := range cat.Actions {
		if action.ID == "" {
			return fmt.Errorf("an action has an empty id")
		}
		if seen[action.ID] {
			return fmt.Errorf("duplicate id %q", action.ID)
		}
		seen[action.ID] = true

		if action.Since < 1 {
			return fmt.Errorf("%s: since must be at least 1, got %d", action.ID, action.Since)
		}
		if action.Since > cat.Version {
			return fmt.Errorf("%s: since %d is above catalog version %d", action.ID, action.Since, cat.Version)
		}
		if strings.TrimSpace(action.Description) == "" {
			return fmt.Errorf("%s: description is empty", action.ID)
		}
		if strings.TrimSpace(action.Instruction) == "" {
			return fmt.Errorf("%s: instruction is empty", action.ID)
		}

		if action.Since > maxSince {
			maxSince = action.Since
		}
	}

	// The invariant holds once there is anything to hold it: an empty catalog is
	// the state the skeleton is written against, and it has no maximum since.
	if len(cat.Actions) > 0 && maxSince != cat.Version {
		return fmt.Errorf("version is %d but the highest since is %d", cat.Version, maxSince)
	}
	return nil
}

// filterActionIDs keeps the ids that exist in the catalog and that the client's
// catalog version knows about, then cuts the list to maxActions.
//
// The first check is insurance — the enum already guarantees it. The second is
// real version compatibility: an older client has no label for a newer id. The cut
// is the expensive one, because every surviving id becomes a model call.
func filterActionIDs(cat *buttonCatalog, ids []string, clientCatalogVersion, maxActions int) []string {
	kept := []string{}
	seen := map[string]bool{}
	for _, id := range ids {
		action, known := cat.byID[id]
		if !known || seen[id] || action.Since > clientCatalogVersion {
			continue
		}
		seen[id] = true
		kept = append(kept, id)
		if len(kept) == maxActions {
			break
		}
	}
	return kept
}
