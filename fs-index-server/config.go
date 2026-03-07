package main

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port          int
	DBPath        string
	MountPrefix   string
	CrawlEnabled  bool
	CrawlWorkers  int
	CrawlMaxDepth int
	CrawlRateMs   int
	LucidBin      string // Path to lucid CLI binary
}

func LoadConfig() *Config {
	return &Config{
		Port:          envInt("FS_INDEX_PORT", 3201),
		DBPath:        envStr("FS_INDEX_DB_PATH", ""),
		MountPrefix:   envStr("FS_INDEX_MOUNT_PREFIX", ""),
		CrawlEnabled:  envBool("FS_INDEX_CRAWL_ENABLED", true),
		CrawlWorkers:  envInt("FS_INDEX_CRAWL_WORKERS", 16),
		CrawlMaxDepth: envInt("FS_INDEX_CRAWL_MAX_DEPTH", 10),
		CrawlRateMs:   envInt("FS_INDEX_CRAWL_RATE_MS", 0),
		LucidBin:      envStr("FS_INDEX_LUCID_BIN", "lucid"),
	}
}

func envStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	switch strings.ToLower(v) {
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	}
	return fallback
}
