package main

import (
	"fmt"
	"os"
	"os/exec"
)

const (
	helperLabel   = "com.local.shieldbar.helper"
	helperDest    = "/Library/PrivilegedHelperTools/com.local.shieldbar.helper"
	helperPlist   = "/Library/LaunchDaemons/com.local.shieldbar.helper.plist"
	helperLogFile = "/var/log/com.local.shieldbar.helper.log"
)

func installPlatform(_ Config) error {
	source, err := os.Executable()
	if err != nil {
		return err
	}

	_ = exec.Command("launchctl", "bootout", "system/"+helperLabel).Run()

	if err := copyExecutable(source, helperDest); err != nil {
		return err
	}

	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>%s</string>
  <key>ProgramArguments</key>
  <array>
    <string>%s</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>%s</string>
  <key>StandardErrorPath</key>
  <string>%s</string>
</dict>
</plist>
`, helperLabel, helperDest, helperLogFile, helperLogFile)

	if err := os.WriteFile(helperPlist, []byte(plist), 0o644); err != nil {
		return err
	}

	output, err := exec.Command(
		"launchctl", "bootstrap", "system", helperPlist,
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v: %s", err, output)
	}
	return nil
}

func uninstallPlatform() error {
	_ = exec.Command("launchctl", "bootout", "system/"+helperLabel).Run()
	_ = os.Remove(helperPlist)
	_ = os.Remove(helperDest)
	_ = os.RemoveAll(defaultStateDir())
	return nil
}
