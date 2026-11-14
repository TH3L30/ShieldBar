//go:build !testmode

package main

func newBackend(_ Config) (networkBackend, error) {
	return productionBackend{}, nil
}

type productionBackend struct{}

func (productionBackend) List() ([]networkEntry, error) {
	return listOSEntries(func(string) bool { return true })
}

func (productionBackend) Disable(entry networkEntry) error {
	return setOSEntry(entry, false)
}

func (productionBackend) Enable(entry networkEntry) error {
	return setOSEntry(entry, true)
}
