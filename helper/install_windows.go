package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const windowsTaskName = "ShieldBarProtectionHelper"

func windowsHelperDest() string {
	return filepath.Join(defaultStateDir(), "shieldbar-helper.exe")
}

func installPlatform(_ Config) error {
	source, err := os.Executable()
	if err != nil {
		return err
	}

	_ = exec.Command("schtasks.exe", "/End", "/TN", windowsTaskName).Run()

	if err := copyExecutable(source, windowsHelperDest()); err != nil {
		return err
	}

	taskRun := fmt.Sprintf(`"%s" serve`, windowsHelperDest())
	output, err := exec.Command(
		"schtasks.exe",
		"/Create",
		"/TN", windowsTaskName,
		"/TR", taskRun,
		"/SC", "ONSTART",
		"/RU", "SYSTEM",
		"/RL", "HIGHEST",
		"/F",
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("create scheduled task: %v: %s", err, strings.TrimSpace(string(output)))
	}

	output, err = exec.Command("schtasks.exe", "/Run", "/TN", windowsTaskName).CombinedOutput()
	if err != nil {
		return fmt.Errorf("start scheduled task: %v: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func uninstallPlatform() error {
	_ = exec.Command("schtasks.exe", "/End", "/TN", windowsTaskName).Run()
	_ = exec.Command("schtasks.exe", "/Delete", "/TN", windowsTaskName, "/F").Run()
	_ = os.Remove(windowsHelperDest())
	_ = os.RemoveAll(defaultStateDir())
	return nil
}
