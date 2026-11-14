package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"strings"
	"time"
)

func serve() {
	log.SetFlags(0)
	log.SetPrefix("shieldbar-helper: ")

	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("%v", err)
	}
	if err := ensureRootDirectory(cfg.StateDir); err != nil {
		log.Fatalf("prepare state directory: %v", err)
	}

	listener, err := listen(cfg)
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	log.Printf("ready (protocol %d, version %s)", protocolVersion, helperVersion)
	for {
		connection, err := listener.Accept()
		if err != nil {
			log.Printf("accept: %v", err)
			continue
		}
		go handleConnection(connection, cfg)
	}
}

func handleConnection(connection net.Conn, cfg Config) {
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(90 * time.Second))

	if !authorize(connection, cfg) {
		_ = writeResponse(connection, Response{
			OK:       false,
			Protocol: protocolVersion,
			Message:  "unauthorized client",
		})
		return
	}

	reader := bufio.NewReader(io.LimitReader(connection, 64*1024))
	line, err := reader.ReadBytes('\n')
	if err != nil && len(line) == 0 {
		return
	}

	var request Request
	if err := json.Unmarshal(line, &request); err != nil {
		_ = writeResponse(connection, Response{
			OK:       false,
			Protocol: protocolVersion,
			Message:  "invalid request",
		})
		return
	}
	if request.Protocol != protocolVersion {
		_ = writeResponse(connection, Response{
			OK:       false,
			Protocol: protocolVersion,
			Message:  fmt.Sprintf("unsupported protocol %d", request.Protocol),
		})
		return
	}

	response, err := handleRequest(cfg, request)
	if err != nil {
		response = Response{
			OK:       false,
			Protocol: protocolVersion,
			Message:  err.Error(),
		}
	}
	_ = writeResponse(connection, response)
}

func handleRequest(cfg Config, request Request) (Response, error) {
	backend, err := newBackend(cfg)
	if err != nil {
		return Response{}, err
	}

	switch strings.ToLower(strings.TrimSpace(request.Command)) {
	case "status":
		return performStatus(cfg, backend)
	case "disable", "disable-network":
		return performDisable(cfg, backend)
	case "restore", "restore-network":
		return performRestore(cfg, backend)
	case "version":
		return Response{
			OK:       true,
			Protocol: protocolVersion,
			Version:  helperVersion,
			State:    "ready",
		}, nil
	default:
		return Response{}, fmt.Errorf("unknown command %q", request.Command)
	}
}

func performStatus(cfg Config, backend networkBackend) (Response, error) {
	state, err := loadState(cfg)
	if err != nil {
		return Response{}, fmt.Errorf("read state: %w", err)
	}

	entries, err := backend.List()
	if err != nil {
		return Response{}, fmt.Errorf("list interfaces: %w", err)
	}

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.Up {
			names = append(names, entry.Name)
		}
	}

	response := Response{
		OK:         true,
		Protocol:   protocolVersion,
		Version:    helperVersion,
		Triggered:  state.Triggered,
		Interfaces: names,
	}
	if state.Triggered {
		response.State = "triggered"
	} else {
		response.State = "ready"
	}
	return response, nil
}

func performDisable(cfg Config, backend networkBackend) (Response, error) {
	state, err := loadState(cfg)
	if err != nil {
		return Response{}, fmt.Errorf("read state: %w", err)
	}
	if state.Triggered {
		return Response{
			OK:        true,
			Protocol:  protocolVersion,
			Version:   helperVersion,
			State:     "triggered",
			Triggered: true,
			Message:   "network is already disabled",
		}, nil
	}

	entries, err := backend.List()
	if err != nil {
		return Response{}, fmt.Errorf("list interfaces: %w", err)
	}

	active := make([]networkEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.Up {
			active = append(active, entry)
		}
	}
	if len(active) == 0 {
		return Response{
			OK:       false,
			Protocol: protocolVersion,
			Message:  "no active network interfaces found",
		}, nil
	}

	// Persist the snapshot before touching anything so a crash can still be
	// recovered from the helper's state file.
	next := persistedState{
		Triggered:   true,
		TriggeredAt: time.Now().Unix(),
		Entries:     active,
	}
	if err := saveState(cfg, next); err != nil {
		return Response{}, fmt.Errorf("save state: %w", err)
	}

	failures := make([]string, 0)
	for _, entry := range active {
		if err := backend.Disable(entry); err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", entry.Name, err))
		}
	}

	response := Response{
		OK:         len(failures) == 0,
		Protocol:   protocolVersion,
		Version:    helperVersion,
		State:      "triggered",
		Triggered:  true,
		Interfaces: namesOf(active),
	}
	if len(failures) > 0 {
		response.Message = "some interfaces could not be disabled: " + strings.Join(failures, "; ")
	}
	return response, nil
}

func performRestore(cfg Config, backend networkBackend) (Response, error) {
	state, err := loadState(cfg)
	if err != nil {
		return Response{}, fmt.Errorf("read state: %w", err)
	}
	if !state.Triggered {
		return Response{
			OK:        true,
			Protocol:  protocolVersion,
			Version:   helperVersion,
			State:     "ready",
			Triggered: false,
			Message:   "network was not disabled",
		}, nil
	}

	failures := make([]string, 0)
	for _, entry := range state.Entries {
		if err := backend.Enable(entry); err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", entry.Name, err))
		}
	}

	if len(failures) > 0 {
		return Response{
			OK:         false,
			Protocol:   protocolVersion,
			Version:    helperVersion,
			State:      "triggered",
			Triggered:  true,
			Interfaces: namesOf(state.Entries),
			Message:    "some interfaces could not be restored: " + strings.Join(failures, "; "),
		}, nil
	}

	if err := clearState(cfg); err != nil {
		return Response{}, fmt.Errorf("clear state: %w", err)
	}

	return Response{
		OK:         true,
		Protocol:   protocolVersion,
		Version:    helperVersion,
		State:      "ready",
		Triggered:  false,
		Interfaces: namesOf(state.Entries),
	}, nil
}

func namesOf(entries []networkEntry) []string {
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name)
	}
	return names
}

func writeResponse(connection net.Conn, response Response) error {
	raw, err := marshalResponse(response)
	if err != nil {
		return err
	}
	_, err = connection.Write(append(raw, '\n'))
	return err
}

func marshalResponse(response Response) ([]byte, error) {
	if response.Protocol == 0 {
		response.Protocol = protocolVersion
	}
	return json.Marshal(response)
}
