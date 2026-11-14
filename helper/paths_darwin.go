package main

const (
	helperStateDirectory = "/var/db/com.local.shieldbar.helper"
	helperSocketPath     = "/var/run/com.local.shieldbar.helper.sock"
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
