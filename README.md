# darkroom

A [Claude Code](https://claude.com/claude-code) mod that puts the images Claude works on right in the chat.

![darkroom in a Claude Code session: the grey line under a command and its film strip](docs/strip.png)

Every image Claude reads, writes or makes (screenshots, renders, diagrams, exports) and every image you paste gets a grey line under its row:

```
● darkroom: 7 images — click to show
```

Click it and a film strip unrolls. The first time, the prints develop under a red safelight. Click a print and it opens in a viewer, in the chat itself.

![The develop, frame by frame, then the picture](docs/develop.png)

## What it does

- **Finds the images.** A Read of an image, a Write or Edit of one, a command or an MCP tool that creates one: the file goes on the roll. A command that only names an image (an `ls`, a grep hit) does not: the file must change during the call.
- **The strip.** Thumbnails side by side, a page at a time. Rest the pointer on one for half a second: `⧉ image` and `⎘ path` copy it without opening it. A click in the strip beside the thumbnails folds it.
- **The viewer.** A dark panel, one size per row, so nothing moves while you browse. Click the right half of the picture for the next one, the left half for the one before, beside it to close.
- **Keys**, once a click gave the strip or the viewer the focus: `←` `→` (or `h` `l`) browse, `i` copies the image, `c` its path, `o` opens it, `x` closes.
- **Pasted images.** While you write, the images you pasted show right above the prompt box, and their `[Image #N]` markers turn amber.
- **`/darkroom`** shows the whole roll in the chat.

## Settings

```
/darkroom settings
/darkroom set opener feh --scale-down   # what opens an image, the path added last; auto: open on macOS, xdg-open elsewhere
/darkroom set develop off               # no safelight develop
/darkroom set auto-show on              # the strip unrolls without a click
```

They are rows in `/config` too.

## Requirements

- Claude Code 2.1.287 or newer. Clicks and hover need the fullscreen terminal.
- ImageMagick 7 (`magick`) or 6 (`convert`, `identify`).
- Real pictures need a terminal with the kitty graphics protocol: Ghostty or kitty, on Linux (Wayland or X11) or macOS. Elsewhere (another terminal, tmux, ssh) darkroom paints the pictures in half-block cells.
- Copying an image uses `wl-copy` on Wayland, `xclip` on X11 and `osascript` on macOS.

## Install

```
claude plugin marketplace add govlog/claude-darkroom
claude plugin install darkroom@claude-darkroom
```

Or run it from a clone: `claude --plugin-dir /path/to/claude-darkroom`.

## How it works

- A `tool.call` hook looks for image paths in each call's arguments and, for commands and MCP tools, in its output. ImageMagick reads the size, converts a non-PNG file to a cached PNG (`~/.cache/claude-darkroom`) and prints the small pixel grid the develop and the cell fallback paint from.
- The rows are `ui.render` hooks on tool results, tool groups, your messages and the output of `/darkroom`. The pictures are `Image` elements that the terminal reads from disk; a clear `Client` layer over them takes the clicks, the hover and the keys.
- Nothing leaves your machine.

## What it runs and touches

Everything stays on your machine; darkroom sends nothing anywhere.

- **Runs**, by argument vector: ImageMagick (`magick`, or `convert` and `identify`) on the images it finds; `uname -s` and `id -u` once per session; `sh -c` with a fixed script for the clipboard (`osascript`, `wl-copy` or `xclip`) and to start your opener (`open`, `xdg-open` or the one you set) detached, the image path always passed as an argument.
- **Reads** the images a tool call names, the images you paste from the engine's folder for them, and these variables: `TERM`, `TERM_PROGRAM`, `KITTY_WINDOW_ID`, `GHOSTTY_RESOURCES_DIR`, `TMUX`, `SSH_CONNECTION`, `HOME`, `TMPDIR`, `XDG_CACHE_HOME`.
- **Writes** PNG copies of non-PNG images to `~/.cache/claude-darkroom` (or `$XDG_CACHE_HOME/claude-darkroom`), and a small pixel grid per image in the session's state.

## Limits

- A mod sees no click on the other rows of the chat. A viewer closes on a click beside its picture, when another viewer opens, and when you send a prompt.
- A path with a space in it is not picked up. A relative path is resolved against the session's folder.
- Pasted images are read from the folder the engine keeps them in (`<tmp>/claude-<uid>/<project>/<session>/images/`), which no API names.
- In an expanded tool group (ctrl+o) the rows show no line; the folded group and standalone results do.
- Images over 64 megapixels or 64 MB are left out. darkroom decodes images with ImageMagick: treat untrusted files as you would in any viewer.

## Develop

```
claude plugin validate .
claude plugin test .
```

## License

MIT
