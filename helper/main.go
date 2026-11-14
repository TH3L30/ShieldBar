package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

// The install and uninstall commands are always run elevated by the app.
func main() {
	if len(os.Args) < 2 {
		serve()
		return
	}

	switch os.Args[1] {
	case "serve":
		serve()
	case "install":
		runInstall(os.Args[2:])
	case "uninstall":
		runUninstall()
	case "status":
		runStatus()
	case "restore":
		runRestoreCLI()
	case "version":
		fmt.Println(helperVersion)
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n", os.Args[1])
		os.Exit(2)
	}
}

func runInstall(args []string) {
	cfg := Config{
		Protocol:   protocolVersion,
		AllowedUID: -1,
		AllowedGID: -1,
		Socket:     defaultSocketPath(),
		StateDir:   defaultStateDir(),
	}

	for index := 0; index < len(args); index++ {
		value := func() string {
			if index+1 >= len(args) {
				fatalf("missing value for %s", args[index])
			}
			index++
			return args[index]
		}

		switch args[index] {
		case "--uid":
			parsed, err := strconv.Atoi(value())
			if err != nil || parsed < 0 {
				fatalf("invalid --uid")
			}
			cfg.AllowedUID = parsed
		case "--gid":
			parsed, err := strconv.Atoi(value())
			if err != nil || parsed < 0 {
				fatalf("invalid --gid")
			}
			cfg.AllowedGID = parsed
		case "--sid":
			cfg.AllowedSID = strings.TrimSpace(value())
		case "--socket":
			cfg.Socket = value()
		case "--state-dir":
			cfg.StateDir = value()
		default:
			fatalf("unknown install option %q", args[index])
		}
	}

	if os.Geteuid() != 0 {
		fatalf("install must run as root/administrator")
	}
	if runtime.GOOS != "windows" && cfg.AllowedUID < 0 {
		fatalf("--uid is required on this platform")
	}
	if runtime.GOOS == "windows" && strings.TrimSpace(cfg.AllowedSID) == "" {
		fatalf("--sid is required on Windows")
	}

	if err := writeConfig(cfg); err != nil {
		fatalf("write config: %v", err)
	}
	if err := installPlatform(cfg); err != nil {
		fatalf("install helper: %v", err)
	}

	fmt.Printf("ShieldBar helper %s installed\n", helperVersion)
}

func runUninstall() {
	if os.Geteuid() != 0 {
		fatalf("uninstall must run as root/administrator")
	}

	cfg, err := loadConfig()
	if err != nil {
		// Best effort: uninstall must still remove files.
		cfg = Config{StateDir: defaultStateDir(), Socket: defaultSocketPath()}
	}
	restoreDirect(cfg)
	if err := uninstallPlatform(); err != nil {
		fatalf("uninstall helper: %v", err)
	}
	fmt.Println("ShieldBar helper uninstalled")
}

func runStatus() {
	cfg, err := loadConfig()
	if err != nil {
		fatalf("%v", err)
	}
	response, err := handleRequest(cfg, Request{Command: "status", Protocol: protocolVersion})
	if err != nil {
		fatalf("%v", err)
	}
	printResponse(response)
}

func runRestoreCLI() {
	cfg, err := loadConfig()
	if err != nil {
		fatalf("%v", err)
	}
	if os.Geteuid() != 0 {
		fatalf("restore must run as root/administrator")
	}
	response, err := restoreDirect(cfg)
	if err != nil {
		fatalf("%v", err)
	}
	printResponse(response)
}

func restoreDirect(cfg Config) (Response, error) {
	if cfg.StateDir == "" {
		return Response{}, errors.New("no helper state directory")
	}
	backend, err := newBackend(cfg)
	if err != nil {
		return Response{}, err
	}
	return performRestore(cfg, backend)
}

func printResponse(response Response) {
	raw, err := marshalResponse(response)
	if err != nil {
		fatalf("encode response: %v", err)
	}
	fmt.Println(raw)
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}

func ensureRootDirectory(path string) error {
	if err := os.MkdirAll(path, 0o700); err != nil {
		return err
	}
	return os.Chmod(path, 0o700)
}

func copyExecutable(source, destination string) error {
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return err
	}
	raw, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	if err := os.WriteFile(destination, raw, 0o755); err != nil {
		return err
	}
	return os.Chmod(destination, 0o755)
}
