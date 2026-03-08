package main

import (
	"log"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

// FilespaceMount represents a discovered LucidLink filespace mount.
type FilespaceMount struct {
	InstanceID string
	MountPoint string
	Name       string // parsed from lucid list output
	Port       int    // LucidLink client API port (from lucid list)
}

// discoverMounts uses `lucid list` to get instance IDs and ports, then
// `lucid --instance <id> status` to parse each mount point.
func discoverMounts(lucidBin string) []FilespaceMount {
	// Step 1: Get instance list (includes ports)
	out, err := exec.Command(lucidBin, "list").CombinedOutput()
	if err != nil {
		log.Printf("mount discovery: lucid list failed: %v (%s)", err, strings.TrimSpace(string(out)))
		return nil
	}

	instances := parseInstanceList(string(out))
	if len(instances) == 0 {
		log.Printf("mount discovery: no instances found in lucid list output")
		return nil
	}

	// Step 2: Get mount point for each instance
	var mounts []FilespaceMount
	for _, inst := range instances {
		mount := getInstanceMount(lucidBin, inst.id)
		if mount != nil {
			mount.Port = inst.port
			mounts = append(mounts, *mount)
		}
	}

	return mounts
}

// instanceInfo holds parsed data from a single lucid list row.
type instanceInfo struct {
	id   string
	name string
	port int
}

// parseInstanceList parses `lucid list` output to extract instance ID, name, and port.
// Example output:
//   INSTANCE ID        FILESPACE                    PORT        MODE
//   2045               connect-us.lucid-demo        9823        live
func parseInstanceList(output string) []instanceInfo {
	var result []instanceInfo
	lines := strings.Split(strings.TrimSpace(output), "\n")

	// Regex: instance_id  filespace_name  port  mode
	lineRe := regexp.MustCompile(`^\s*(\d+)\s+(\S+)\s+(\d+)\s+(\S+)`)

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "INSTANCE") || strings.HasPrefix(line, "---") {
			continue
		}
		if m := lineRe.FindStringSubmatch(line); len(m) > 3 {
			port, _ := strconv.Atoi(m[3])
			result = append(result, instanceInfo{
				id:   m[1],
				name: m[2],
				port: port,
			})
		}
	}
	return result
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
