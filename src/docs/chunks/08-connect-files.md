# Using LucidLink Connect Files

Files that are linked by the LucidLink Connect API are called "external entries." These files have been linked from an external storage and not inside the standard LucidLink filespace. Thanks to LucidLink Connect, these external entries can appear in the filespace right alongside your LucidLink files. They can be used by any application, but it is important to note a few differences between External Entries and native LucidLink files.

## What's the Same?

External entries are usable in all LucidLink platforms such as desktop, mobile apps, or the web app. You are still able to stream partial files, so jumping to the middle of a long video means you don't need to read the whole file. This also means that LucidLink caching and pinning work the same way you are used to. If your permission level allows, you can move external entries, you can rename them, and you can even delete them.

**Note**: Deleting an external entry does NOT delete it from the external storage, it just removes the entry from the LucidLink filespace.

## What's Different?

External entries are links to outside files, which makes them great for any use case where you need to read or playback but not modify in place. If you copy/paste an external entry into a new folder, the original external entry will remain in place, and the pasted file will be written as a new native LucidLink file inside the standard filespace. You can confirm this by noting that the purple dot icon is not present on the newly pasted file.

If an external entry is a filetype that you would typically modify such as a project file or text document, you will want to first perform a copy operation as external entities cannot be modified. Some file types will allow you to open an external entry and save over the original. In these situations, the application may use a move/rename/delete function which effectively overwrites the original entry. The file that replaces it will be a standard LucidLink entry. Again notice how the purple dot icon disappears if this takes place.

## Permissions

Permissions for external entries function the same way as standard LucidLink files. If a user is given permission to a folder, any external entries added to that folder will be visible by that user.

Administrators may decide to only give "can view" permissions to the folders where the LucidLink Connect files are linked. This will prevent users from moving, renaming, or deleting them.

## Summary

If you see the purple icon next to any of your files, you can typically treat them the same way you would any other file in LucidLink. Just remember the different behavior when it comes to copying or modifying these files.
