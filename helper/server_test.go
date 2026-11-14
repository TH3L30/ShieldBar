package main

import (
	"errors"
	"testing"
)

type fakeBackend struct {
	entries  []networkEntry
	disabled []string
	enabled  []string
	fail     map[string]error
}

func (f *fakeBackend) List() ([]networkEntry, error) {
	result := make([]networkEntry, len(f.entries))
	copy(result, f.entries)
	return result, nil
}

func (f *fakeBackend) Disable(entry networkEntry) error {
	if err := f.fail[entry.Name]; err != nil {
		return err
	}
	f.disabled = append(f.disabled, entry.Name)
	return nil
}

func (f *fakeBackend) Enable(entry networkEntry) error {
	if err := f.fail[entry.Name]; err != nil {
		return err
	}
	f.enabled = append(f.enabled, entry.Name)
	return nil
}

func testConfig(t *testing.T) Config {
	t.Helper()
	return Config{
		Protocol:   protocolVersion,
		AllowedUID: 0,
		AllowedGID: 0,
		StateDir:   t.TempDir(),
		Socket:     t.TempDir() + "/test.sock",
	}
}

func TestDisableSnapshotsAndMarksTriggered(t *testing.T) {
	cfg := testConfig(t)
	backend := &fakeBackend{
		entries: []networkEntry{
			{Name: "en0", Kind: "iface", Up: true},
			{Name: "en1", Kind: "iface", Up: false},
		},
	}

	response, err := performDisable(cfg, backend)
	if err != nil {
		t.Fatal(err)
	}
	if !response.OK || !response.Triggered {
		t.Fatalf("unexpected response: %+v", response)
	}
	if len(backend.disabled) != 1 || backend.disabled[0] != "en0" {
		t.Fatalf("unexpected disabled interfaces: %v", backend.disabled)
	}

	state, err := loadState(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !state.Triggered || len(state.Entries) != 1 || state.Entries[0].Name != "en0" {
		t.Fatalf("unexpected state: %+v", state)
	}
}

func TestDisableIsIdempotent(t *testing.T) {
	cfg := testConfig(t)
	backend := &fakeBackend{
		entries: []networkEntry{{Name: "en0", Kind: "iface", Up: true}},
	}

	if _, err := performDisable(cfg, backend); err != nil {
		t.Fatal(err)
	}
	response, err := performDisable(cfg, backend)
	if err != nil {
		t.Fatal(err)
	}
	if !response.OK || !response.Triggered {
		t.Fatalf("unexpected response: %+v", response)
	}
	if len(backend.disabled) != 1 {
		t.Fatalf("interface disabled twice: %v", backend.disabled)
	}
}

func TestRestoreOnlyEnablesSnapshot(t *testing.T) {
	cfg := testConfig(t)
	backend := &fakeBackend{
		entries: []networkEntry{
			{Name: "en0", Kind: "iface", Up: true},
			{Name: "en1", Kind: "iface", Up: false},
		},
	}

	if _, err := performDisable(cfg, backend); err != nil {
		t.Fatal(err)
	}
	response, err := performRestore(cfg, backend)
	if err != nil {
		t.Fatal(err)
	}
	if !response.OK || response.Triggered {
		t.Fatalf("unexpected response: %+v", response)
	}
	if len(backend.enabled) != 1 || backend.enabled[0] != "en0" {
		t.Fatalf("unexpected restored interfaces: %v", backend.enabled)
	}

	state, err := loadState(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if state.Triggered {
		t.Fatal("state should be cleared")
	}
}

func TestPartialDisableKeepsRecoverableState(t *testing.T) {
	cfg := testConfig(t)
	backend := &fakeBackend{
		entries: []networkEntry{
			{Name: "en0", Kind: "iface", Up: true},
			{Name: "en1", Kind: "iface", Up: true},
		},
		fail: map[string]error{"en1": errors.New("permission denied")},
	}

	response, err := performDisable(cfg, backend)
	if err != nil {
		t.Fatal(err)
	}
	if response.OK || !response.Triggered {
		t.Fatalf("unexpected response: %+v", response)
	}
	if response.Message == "" {
		t.Fatal("expected a partial failure message")
	}

	state, err := loadState(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !state.Triggered || len(state.Entries) != 2 {
		t.Fatalf("unexpected state: %+v", state)
	}
}

func TestFailedRestoreKeepsStateForRetry(t *testing.T) {
	cfg := testConfig(t)
	backend := &fakeBackend{
		entries: []networkEntry{{Name: "en0", Kind: "iface", Up: true}},
	}

	if _, err := performDisable(cfg, backend); err != nil {
		t.Fatal(err)
	}
	backend.fail = map[string]error{"en0": errors.New("still busy")}

	response, err := performRestore(cfg, backend)
	if err != nil {
		t.Fatal(err)
	}
	if response.OK || !response.Triggered {
		t.Fatalf("unexpected response: %+v", response)
	}

	state, err := loadState(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !state.Triggered {
		t.Fatal("state must remain triggered for a retry")
	}
}
