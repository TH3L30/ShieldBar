package main

const (
	helperStateDirectory = "/var/lib/shieldbar-helper"
	helperSocketPath     = "/run/shieldbar-helper.sock"
)

func defaultStateDir() string {
	return helperStateDirectory
}

func defaultConfigPath() string {
	return helperStateDirectory + "/config.json"
}

func defaultSocketPath() string {
	return helperSocketPath
}
