//go:build windows

package main

import (
	"net"

	"github.com/Microsoft/go-winio"
)

func listen(cfg Config) (net.Listener, error) {
	descriptor := "D:P(A;;GA;;;SY)"
	if cfg.AllowedSID != "" {
		descriptor += "(A;;GA;;;" + cfg.AllowedSID + ")"
	}
	return winio.ListenPipe(cfg.Socket, &winio.PipeConfig{
		SecurityDescriptor: descriptor,
		MessageMode:        false,
	})
}

func authorize(_ net.Conn, _ Config) bool {
	// The named-pipe DACL is the authentication boundary on Windows.
	return true
}
