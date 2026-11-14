//go:build darwin

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

	var credentials *unix.Xucred
	var controlErr error
	if err := raw.Control(func(fd uintptr) {
		credentials, controlErr = unix.GetsockoptXucred(
			int(fd),
			unix.SOL_LOCAL,
			unix.LOCAL_PEERCRED,
		)
	}); err != nil {
		return false
	}
	if controlErr != nil || credentials == nil {
		return false
	}
	return int(credentials.Uid) == cfg.AllowedUID
}
