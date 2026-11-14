package main

import (
	"fmt"
	"os"
	"os/exec"
)

const (
	linuxServiceName = "shieldbar-helper"
	linuxHelperDest  = "/usr/local/lib/shieldbar/shieldbar-helper"
	linuxUnitPath    = "/etc/systemd/system/shieldbar-helper.service"
)

func installPlatform(_ Config) error {
	source, err := os.Executable()
	if err != nil {
		return err
	}

	_ = exec.Command("systemctl", "stop", linuxServiceName).Run()

	if err := copyExecutable(source, linuxHelperDest); err != nil {
		return err
	}

	unit := fmt.Sprintf(`[Unit]
Description=ShieldBar network protection helper
After=network.target

[Service]
Type=simple
ExecStart=%s serve
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
`, linuxHelperDest)

	if err := os.WriteFile(linuxUnitPath, []byte(unit), 0o644); err != nil {
		return err
	}

	output, err := exec.Command("systemctl", "daemon-reload").CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl daemon-reload: %v: %s", err, output)
	}
	output, err = exec.Command(
		"systemctl", "enable", "--now", linuxServiceName,
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("systemctl enable: %v: %s", err, output)
	}
	return nil
}

func uninstallPlatform() error {
	_ = exec.Command("systemctl", "stop", linuxServiceName).Run()
	_ = exec.Command("systemctl", "disable", linuxServiceName).Run()
	_ = os.Remove(linuxUnitPath)
	_ = os.Remove(linuxHelperDest)
	_ = os.Remove(defaultSocketPath())
	_ = os.RemoveAll(defaultStateDir())
	_ = exec.Command("systemctl", "daemon-reload").Run()
	return nil
}
