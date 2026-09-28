// Local dev server on :8787. `npm run dev` proxies /api here.
package main

import (
	"flag"
	"log"
	"net/http"

	"github.com/ginman86/big-bib-energy/api/internal/app"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8787", "listen address")
	flag.Parse()
	a := app.New(app.Config{Version: "local"})
	log.Printf("Big Bib Energy API on http://%s", *addr)
	log.Fatal(http.ListenAndServe(*addr, a.Handler()))
}
