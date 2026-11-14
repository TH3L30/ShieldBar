package main

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
)

type networkBackend interface {
	List() ([]networkEntry, error)
	Disable(networkEntry) error
	Enable(networkEntry) error
}

func listOSEntries(allow func(string) bool) ([]networkEntry, error) {
	switch runtime.GOOS {
	case "linux":
		return listLinuxEntries(allow)
	case "darwin":
		return listDarwinEntries(allow)
	case "windows":
		return listWindowsEntries(allow)
	default:
		return nil, fmt.Errorf("unsupported platform %s", runtime.GOOS)
	}
}

func setOSEntry(entry networkEntry, up bool) error {
	switch runtime.GOOS {
	case "linux":
		state := "down"
		if up {
			state = "up"
		}
		output, err := exec.Command("ip", "link", "set", "dev", entry.Name, state).CombinedOutput()
		if err != nil {
			return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(output)))
		}
		return nil
	case "darwin":
		if entry.Kind == "service" {
			state := "off"
			if up {
				state = "on"
			}
			output, err := exec.Command("networksetup", "-setnetworkserviceenabled", entry.Name, state).CombinedOutput()
			if err != nil {
				return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(output)))
			}
			return nil
		}
		state := "down"
		if up {
			state = "up"
		}
		output, err := exec.Command("ifconfig", entry.Name, state).CombinedOutput()
		if err != nil {
			return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(output)))
		}
		return nil
	case "windows":
		command := "Disable-NetAdapter"
		if up {
			command = "Enable-NetAdapter"
		}
		script := fmt.Sprintf(
			"$ErrorActionPreference='Stop'; %s -Name '%s' -Confirm:$false",
			command,
			strings.ReplaceAll(entry.Name, "'", "''"),
		)
		output, err := exec.Command(
			"powershell.exe",
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy", "Bypass",
			"-Command", script,
		).CombinedOutput()
		if err != nil {
			return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(output)))
		}
		return nil
	default:
		return fmt.Errorf("unsupported platform %s", runtime.GOOS)
	}
}

var linuxLinkPattern = regexp.MustCompile(`^\d+:\s+([^:@\s]+)(?:@[^:]+)?:\s+<([^>]*)>`)

func listLinuxEntries(allow func(string) bool) ([]networkEntry, error) {
	output, err := exec.Command("ip", "-o", "link", "show").Output()
	if err != nil {
		return nil, fmt.Errorf("ip link show: %w", err)
	}

	entries := make([]networkEntry, 0)
	for _, line := range strings.Split(string(output), "\n") {
		match := linuxLinkPattern.FindStringSubmatch(strings.TrimSpace(line))
		if match == nil {
			continue
		}
		name := match[1]
		if name == "lo" || !allow(name) {
			continue
		}
		flags := match[2]
		entries = append(entries, networkEntry{
			Name: name,
			Kind: "iface",
			Up:   strings.Contains(flags, "UP"),
		})
	}
	return entries, nil
}

var darwinInterfacePattern = regexp.MustCompile(`^([a-zA-Z0-9._-]+): flags=([0-9a-f]+)<([^>]*)>`)

func listDarwinEntries(allow func(string) bool) ([]networkEntry, error) {
	entries := make([]networkEntry, 0)

	servicesOutput, serviceErr := exec.Command("networksetup", "-listallnetworkservices").Output()
	if serviceErr == nil {
		for _, raw := range strings.Split(string(servicesOutput), "\n") {
			service := strings.TrimSpace(raw)
			if service == "" || strings.Contains(service, "denotes") {
				continue
			}
			if strings.HasPrefix(service, "*") {
				// Already disabled before we touched anything.
				continue
			}
			if !allow(service) {
				continue
			}
			enabled, err := exec.Command(
				"networksetup", "-getnetworkserviceenabled", service,
			).Output()
			if err != nil {
				continue
			}
			entries = append(entries, networkEntry{
				Name: service,
				Kind: "service",
				Up:   strings.EqualFold(strings.TrimSpace(string(enabled)), "enabled"),
			})
		}
	}

	interfacesOutput, err := exec.Command("ifconfig", "-a").Output()
	if err != nil {
		return nil, fmt.Errorf("ifconfig -a: %w", err)
	}

	for _, line := range strings.Split(string(interfacesOutput), "\n") {
		match := darwinInterfacePattern.FindStringSubmatch(strings.TrimSpace(line))
		if match == nil {
			continue
		}
		name := match[1]
		if name == "lo0" || !allow(name) {
			continue
		}
		entries = append(entries, networkEntry{
			Name: name,
			Kind: "iface",
			Up:   strings.Contains(match[3], "UP"),
		})
	}

	return entries, nil
}

type windowsAdapter struct {
	NetConnectionID string `json:"NetConnectionID"`
}

func listWindowsEntries(allow func(string) bool) ([]networkEntry, error) {
	script := `$ErrorActionPreference='Stop'; ` +
		`Get-CimInstance Win32_NetworkAdapter | ` +
		`Where-Object { $_.NetConnectionID -ne $null -and $_.NetEnabled -eq $true } | ` +
		`Select-Object NetConnectionID | ConvertTo-Json -Compress`

	output, err := exec.Command(
		"powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-ExecutionPolicy", "Bypass",
		"-Command", script,
	).Output()
	if err != nil {
		return nil, fmt.Errorf("enumerate adapters: %w", err)
	}

	trimmed := strings.TrimSpace(string(output))
	if trimmed == "" || trimmed == "null" {
		return []networkEntry{}, nil
	}

	var adapters []windowsAdapter
	if strings.HasPrefix(trimmed, "{") {
		var single windowsAdapter
		if err := json.Unmarshal([]byte(trimmed), &single); err != nil {
			return nil, fmt.Errorf("parse adapter: %w", err)
		}
		adapters = []windowsAdapter{single}
	} else if err := json.Unmarshal([]byte(trimmed), &adapters); err != nil {
		return nil, fmt.Errorf("parse adapters: %w", err)
	}

	entries := make([]networkEntry, 0, len(adapters))
	for _, adapter := range adapters {
		name := strings.TrimSpace(adapter.NetConnectionID)
		if name == "" || strings.Contains(strings.ToLower(name), "loopback") || !allow(name) {
			continue
		}
		entries = append(entries, networkEntry{Name: name, Kind: "adapter", Up: true})
	}
	return entries, nil
}
