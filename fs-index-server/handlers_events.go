package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

func HandleListEvents(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		category := q.Get("category")
		filespace := q.Get("filespace")
		level := q.Get("level")
		limit, _ := strconv.Atoi(q.Get("limit"))
		beforeID, _ := strconv.ParseInt(q.Get("before"), 10, 64)

		events, err := QueryEvents(db, category, filespace, level, limit, beforeID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if events == nil {
			events = []Event{}
		}
		writeJSON(w, http.StatusOK, events)
	}
}

func HandleSSEEvents(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		q := r.URL.Query()
		category := q.Get("category")
		filespace := q.Get("filespace")
		level := q.Get("level")

		var lastID int64
		db.QueryRow("SELECT COALESCE(MAX(id), 0) FROM event_log").Scan(&lastID)

		fmt.Fprintf(w, ": connected\n\n")
		flusher.Flush()

		ctx := r.Context()
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			query := "SELECT id, timestamp, category, level, filespace, message, detail FROM event_log WHERE id > ?"
			var args []interface{}
			args = append(args, lastID)

			if category != "" {
				query += " AND category = ?"
				args = append(args, category)
			}
			if filespace != "" {
				query += " AND filespace = ?"
				args = append(args, filespace)
			}
			if level != "" {
				query += " AND level = ?"
				args = append(args, level)
			}
			query += " ORDER BY id ASC LIMIT 50"

			rows, err := db.Query(query, args...)
			if err != nil {
				select {
				case <-ctx.Done():
					return
				case <-time.After(5 * time.Second):
					continue
				}
			}

			var newEvents []Event
			for rows.Next() {
				var e Event
				if err := rows.Scan(&e.ID, &e.Timestamp, &e.Category, &e.Level, &e.Filespace, &e.Message, &e.Detail); err != nil {
					continue
				}
				newEvents = append(newEvents, e)
				if e.ID > lastID {
					lastID = e.ID
				}
			}
			rows.Close()

			for _, e := range newEvents {
				data, _ := json.Marshal(e)
				fmt.Fprintf(w, "data: %s\n\n", data)
			}
			if len(newEvents) > 0 {
				flusher.Flush()
			}

			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
		}
	}
}
