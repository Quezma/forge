// Package web serves the read-only runs API and the embedded dashboard SPA.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Assets returns the built dashboard files (web/dist).
func Assets() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err) // dist is embedded at compile time; Sub only fails on an invalid name
	}
	return sub
}
