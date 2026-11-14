//go:build linux

package main

import (
	"net"

	"golang.org/x/sys/unix"
)

func authorize(connection net.Conn, cfg Config) bool {
	unixConnection, ok := connection.(*net.UnixConn)
	if !ok {
		return false
	}
	raw, err := unixConnection.SyscallConn()
	if err != nil {
		return false
	}

	var credentials *unix.Ucred
	var controlErr error
	if err := raw.Control(func(fd uintptr) {
		credentials, controlErr = unix.GetsockoptUcred(
			int(fd),
			unix.SOL_SOCKET,
			unix.SO_PEERCRED,
		)
	}); err != nil {
		return false
	}
	if controlErr != nil || credentials == nil {
		return false
	}
	return int(credentials.Uid) == cfg.AllowedUID
}
