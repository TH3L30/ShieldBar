package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const (
	helperVersion   = "1.1.2"
	protocolVersion = 1
)

type Request struct {
	Command  string `json:"command"`
	Protocol int    `json:"protocol"`
}

type Response struct {
	OK         bool     `json:"ok"`
	Protocol   int      `json:"protocol"`
	Version    string   `json:"version,omitempty"`
	State      string   `json:"state,omitempty"`
	Triggered  bool     `json:"triggered"`
	Interfaces []string `json:"interfaces,omitempty"`
	Message    string   `json:"message,omitempty"`
}

type Config struct {
	Protocol   int    `json:"protocol"`
	AllowedUID int    `json:"allowedUid"`
	AllowedGID int    `json:"allowedGid"`
	AllowedSID string `json:"allowedSid,omitempty"`
	Socket     string `json:"socket"`
	StateDir   string `json:"stateDir"`
}

type networkEntry struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
	Up   bool   `json:"up"`
}

type persistedState struct {
	Triggered   bool           `json:"triggered"`
	TriggeredAt int64          `json:"triggeredAt,omitempty"`
	Entries     []networkEntry `json:"entries,omitempty"`
}

func configLocation() string {
	if value := os.Getenv("SHIELDBAR_HELPER_CONFIG"); value != "" {
		return value
	}
	return defaultConfigPath()
}

func stateLocation(cfg Config) string {
	return filepath.Join(cfg.StateDir, "state.json")
}

func loadConfig() (Config, error) {
	path := configLocation()
	raw, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("read helper config: %w", err)
	}

	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return Config{}, fmt.Errorf("parse helper config: %w", err)
	}
	if cfg.Protocol != protocolVersion {
		return Config{}, fmt.Errorf("unsupported helper protocol %d", cfg.Protocol)
	}
	if cfg.Socket == "" || cfg.StateDir == "" {
		return Config{}, errors.New("helper config is incomplete")
	}
	return cfg, nil
}

func writeConfig(cfg Config) error {
	path := configLocation()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return writeJSONAtomic(path, cfg, 0o600)
}

func loadState(cfg Config) (persistedState, error) {
	raw, err := os.ReadFile(stateLocation(cfg))
	if errors.Is(err, os.ErrNotExist) {
		return persistedState{}, nil
	}
	if err != nil {
		return persistedState{}, err
	}

	var state persistedState
	if err := json.Unmarshal(raw, &state); err != nil {
		return persistedState{}, err
	}
	return state, nil
}

func saveState(cfg Config, state persistedState) error {
	if err := os.MkdirAll(cfg.StateDir, 0o700); err != nil {
		return err
	}
	return writeJSONAtomic(stateLocation(cfg), state, 0o600)
}

func clearState(cfg Config) error {
	err := os.Remove(stateLocation(cfg))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func writeJSONAtomic(path string, value any, mode os.FileMode) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')

	temporary := fmt.Sprintf("%s.%d.tmp", path, time.Now().UnixNano())
	if err := os.WriteFile(temporary, raw, mode); err != nil {
		return err
	}
	if err := os.Chmod(temporary, mode); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}
