//go:build !windows

package main

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
)

func listen(cfg Config) (net.Listener, error) {
	if err := os.MkdirAll(filepath.Dir(cfg.Socket), 0o755); err != nil {
		return nil, err
	}
	_ = os.Remove(cfg.Socket)

	listener, err := net.Listen("unix", cfg.Socket)
	if err != nil {
		return nil, err
	}

	if err := os.Chmod(cfg.Socket, 0o660); err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("chmod socket: %w", err)
	}
	if os.Geteuid() == 0 && cfg.AllowedGID >= 0 {
		if err := os.Chown(cfg.Socket, 0, cfg.AllowedGID); err != nil {
			_ = listener.Close()
			return nil, fmt.Errorf("chown socket: %w", err)
		}
	}
	return listener, nil
}
