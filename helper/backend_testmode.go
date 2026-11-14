//go:build testmode

package main

import (
	"fmt"
	"os"
	"strings"
)

// Test builds never touch a real network path outside the sbtest/feth/bridge
// prefixes, so CI can exercise the real OS commands without cutting its own
// management interface.
func newBackend(_ Config) (networkBackend, error) {
	return testBackend{}, nil
}

type testBackend struct{}

func testAllowed(name string) bool {
	return strings.HasPrefix(name, "sbtest") ||
		strings.HasPrefix(name, "feth") ||
		strings.HasPrefix(name, "bridge")
}

func (testBackend) List() ([]networkEntry, error) {
	if os.Getenv("SHIELDBAR_HELPER_FAKE") == "1" {
		return []networkEntry{
			{Name: "sbtest0", Kind: "iface", Up: true},
			{Name: "sbtest1", Kind: "iface", Up: false},
		}, nil
	}
	return listOSEntries(testAllowed)
}

func (testBackend) Disable(entry networkEntry) error {
	if !testAllowed(entry.Name) {
		return fmt.Errorf("test mode refuses non-test interface %q", entry.Name)
	}
	if os.Getenv("SHIELDBAR_HELPER_FAKE") == "1" {
		return nil
	}
	return setOSEntry(entry, false)
}

func (testBackend) Enable(entry networkEntry) error {
	if !testAllowed(entry.Name) {
		return fmt.Errorf("test mode refuses non-test interface %q", entry.Name)
	}
	if os.Getenv("SHIELDBAR_HELPER_FAKE") == "1" {
		return nil
	}
	return setOSEntry(entry, true)
}
