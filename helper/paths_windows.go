package main

import (
	"os"
	"path/filepath"
)

const (
	helperPipeName = `\\.\pipe\shieldbar-protection-helper`
)

func programDataDirectory() string {
	if value := os.Getenv("ProgramData"); value != "" {
		return value
	}
	return `C:\ProgramData`
}

func defaultStateDir() string {
	return filepath.Join(programDataDirectory(), "ShieldBar")
}

func defaultConfigPath() string {
	return filepath.Join(defaultStateDir(), "config.json")
}

func defaultSocketPath() string {
	return helperPipeName
}
