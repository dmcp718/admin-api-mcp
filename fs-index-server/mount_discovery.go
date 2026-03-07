package main

import (
	"log"
	"os/exec"
	"regexp"
	"strings"
)

// FilespaceMount represents a discovered LucidLink filespace mount.
type FilespaceMount struct {
	InstanceID string
	MountPoint string
	Name       string // parsed from lucid list output
}

// discoverMounts uses `lucid list` to get instance IDs, then
// `lucid --instance <id> status` to parse each mount point.
func discoverMounts(lucidBin string) []FilespaceMount {
	// Step 1: Get instance list
	out, err := exec.Command(lucidBin, "list").CombinedOutput()
	if err != nil {
		log.Printf("mount discovery: lucid list failed: %v (%s)", err, strings.TrimSpace(string(out)))
		return nil
	}

	instanceIDs := parseInstanceIDs(string(out))
	if len(instanceIDs) == 0 {
		log.Printf("mount discovery: no instances found in lucid list output")
		return nil
	}

	// Step 2: Get mount point for each instance
	var mounts []FilespaceMount
	for _, id := range instanceIDs {
		mount := getInstanceMount(lucidBin, id)
		if mount != nil {
			mounts = append(mounts, *mount)
		}
	}

	return mounts
}

// parseInstanceIDs extracts instance IDs from `lucid list` output.
// The output format varies but typically shows instance IDs as numeric values.
func parseInstanceIDs(output string) []string {
	var ids []string
	lines := strings.Split(strings.TrimSpace(output), "\n")

	// Match lines containing instance IDs — look for numeric ID at start of line
	// or in structured output columns
	idRe := regexp.MustCompile(`^\s*(\d+)\s`)
	nameRe := regexp.MustCompile(`([a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)`)

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "INSTANCE") || strings.HasPrefix(line, "---") {
			continue
		}

		// Try numeric instance ID at start of line
		if m := idRe.FindStringSubmatch(line); len(m) > 1 {
			ids = append(ids, m[1])
			continue
		}

		// Fallback: look for filespace.domain pattern and use it
		if m := nameRe.FindStringSubmatch(line); len(m) > 1 {
			ids = append(ids, m[1])
		}
	}

	return ids
}

// getInstanceMount runs `lucid --instance <id> status` and parses the mount point.
func getInstanceMount(lucidBin, instanceID string) *FilespaceMount {
	out, err := exec.Command(lucidBin, "--instance", instanceID, "status").CombinedOutput()
	if err != nil {
		log.Printf("mount discovery: lucid --instance %s status failed: %v", instanceID, err)
		return nil
	}

	output := string(out)
	mountPoint := parseMountPoint(output)
	if mountPoint == "" {
		log.Printf("mount discovery: no mount point found for instance %s", instanceID)
		return nil
	}

	name := parseFilespaceName(output)
	if name == "" {
		name = instanceID
	}

	return &FilespaceMount{
		InstanceID: instanceID,
		MountPoint: mountPoint,
		Name:       name,
	}
}

// parseMountPoint extracts "Mount point: /path/to/mount" from lucid status output.
func parseMountPoint(output string) string {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Mount point:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "Mount point:"))
		}
	}
	return ""
}

// parseFilespace name extracts "Filespace: name.domain" from lucid status output.
func parseFilespaceNameFromStatus(output string) string {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Filespace:") {
			return strings.TrimSpace(strings.TrimPrefix(line, "Filespace:"))
		}
	}
	return ""
}

// parseFilespace extracts a name from status output, trying multiple patterns.
func parseFilespaceName(output string) string {
	if name := parseFilespaceNameFromStatus(output); name != "" {
		return name
	}
	// Fallback: look for filespace.domain pattern anywhere
	re := regexp.MustCompile(`([a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)`)
	if m := re.FindStringSubmatch(output); len(m) > 1 {
		return m[1]
	}
	return ""
}
