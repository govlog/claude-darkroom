<p align="center">
  <img src="docs/banner.png" alt="darkroom: the images Claude works on, right in your Claude Code chat" width="100%">
</p>

<p align="center">
  <a href="#install"><img alt="Claude Code mod" src="docs/badges/claude-code.png" height="23"></a>
  <a href="#the-kitty-graphics-protocol"><img alt="kitty graphics protocol: Ghostty, kitty" src="docs/badges/kitty.png" height="23"></a>
  <img alt="Linux and macOS" src="docs/badges/platforms.png" height="23">
  <img alt="MIT license" src="docs/badges/license.png" height="23">
</p>

<p align="center">
  Every image Claude reads, writes or makes, and every image you paste,<br>
  shows up <b>in the chat itself</b>: a grey line under the row, a film strip, a viewer one click away.
</p>

![A Claude Code session: the film strip of the six images Claude just made, and the viewer open on one of them](docs/viewer.png)

## Install

In Claude Code, type:

```
/plugin marketplace add govlog/claude-darkroom
/plugin install darkroom@claude-darkroom
```

Then start a new session. PNG images, the screenshots and renders you see most, work as they are: darkroom decodes them itself. For JPEG, GIF, WebP, AVIF, SVG, BMP and TIFF it also needs ImageMagick:

```
brew install imagemagick        # macOS
sudo apt install imagemagick    # Debian, Ubuntu
```

### The kitty graphics protocol

> [!IMPORTANT]
> darkroom shows **real pictures** through the **kitty graphics protocol**: it tells the terminal which image file to draw and where, and the terminal draws its pixels right in the chat. Use a terminal that speaks it: **Ghostty** or **kitty**, on Linux or macOS.
>
> Any other terminal, tmux or an ssh session gets the pictures in half-block cells instead: coarser, but everything else works.

## What you get

### A line under every row that holds images

![A Claude Code session: Claude runs a script that makes six images, and the grey line darkroom: 6 images shows under its row](docs/line.png)

A screenshot Claude read, a chart a script rendered, an export an MCP tool saved: the row gets a grey line. Click it and the film strip unrolls. The first time, the prints develop under a red safelight.

![The film strip of the six images, unrolled under the grey line](docs/strip.png)

### Copy without opening

![The hover menu of a print, its path entry lit in amber](docs/hover.png)

Rest the pointer on a print for half a second: `⧉ image` puts the picture itself on the clipboard, `⎘ path` its path.

### A viewer in the chat

Click a print and it opens in a dark panel under the strip, as in the picture at the top. Click the right half of the picture for the next one, the left half for the one before, and beside it to close. The panel keeps one size, so the buttons stay under your pointer.

### Your pasted images, before you send

![A pasted image shown above the prompt box, its marker in amber](docs/paste.png)

The images you paste show right above the prompt box, and their `[Image #N]` markers turn amber. Once sent, your message gets its grey line too.

## Clicks and keys

| | |
|---|---|
| Click the grey line | unroll or fold the strip |
| Click a print | open it in the viewer |
| Click the right or left half of the picture | the next or the previous one |
| Click beside the picture | close the viewer |
| <kbd>←</kbd> <kbd>→</kbd> (or <kbd>h</kbd> <kbd>l</kbd>) | browse, once a click gave the strip or the viewer the focus |
| <kbd>i</kbd> · <kbd>c</kbd> · <kbd>o</kbd> · <kbd>x</kbd> | copy the image · copy its path · open it · close |
| `/darkroom` | the whole roll of the session |

## Settings

```
/darkroom settings                      # what is set now
/darkroom set auto-show on              # unroll the strips without a click
/darkroom set develop off               # skip the safelight develop
/darkroom set opener feh --scale-down   # what opens an image; auto: open on macOS, xdg-open elsewhere
```

A setting takes effect at once and is kept for the next sessions, in the plugin's own store.

## Requirements

| | |
|---|---|
| Claude Code | 2.1.287 or newer. Clicks and hover need a session that reports the mouse (fullscreen mode). |
| ImageMagick | only for JPEG, GIF, WebP, AVIF, SVG, BMP and TIFF: 7 (`magick`), or 6 (`convert`, `identify`) |
| Terminal | the kitty graphics protocol for real pictures: Ghostty or kitty, on Linux (Wayland or X11) or macOS |
| Clipboard | to copy an image: `wl-copy` on Wayland, `xclip` on X11, `osascript` on macOS |

<details>
<summary><b>How it works</b></summary>

- A `tool.call` hook looks for image paths in each call's arguments and, for commands and MCP tools, in its output. A path counts only if the call read it, wrote it, or changed it: an `ls` that lists images does not put them on the roll.
- A PNG is read and decoded by darkroom itself, inside the mod's sandbox: its size from its header, and the small pixel grid the develop and the half-block fallback paint from. The terminal draws the picture straight from the file.
- Any other format goes to ImageMagick, under the policy darkroom ships: it reads the size, writes a PNG copy into Claude Code's own temporary folder and prints the pixel grid.
- The rows are `ui.render` hooks on tool results, tool groups, your messages and the output of `/darkroom`. Each picture is an `Image` element: Claude Code passes it to the terminal with the kitty graphics protocol. A clear `Client` layer over the pictures and the viewer's toolbar takes the clicks, the hover and the keys, and never draws, so the pictures stay. A press over it never reaches the transcript: a quick click or one that slips never selects text.

</details>

## Privacy and security

darkroom sends nothing anywhere: it makes no network call, and it never puts text in a prompt, runs a tool or runs a command of its own accord.

**Programs it runs, and why.** Each by name with its arguments, the image path always one argument of its own:

- No program for a PNG: darkroom decodes it in its own sandbox, with no access to files, programs or the network beyond what Claude Code hands it.
- ImageMagick (`magick`, or `convert` and `identify`), for the other formats only: to read the size, to convert the image to PNG for the terminal, and to make the small pixel grid. darkroom names the decoder from the file's extension (`JPEG:`, `GIF:`…), so ImageMagick never guesses a format from a file's bytes, and runs it under [`magick/policy.xml`](magick/policy.xml): those formats and nothing else, no delegate program, no network, no indirect file lists, bounded memory, size and time.
- `magick -version`, or else `convert -version`, once per session: to see whether ImageMagick is installed, and which version.
- `id -u`, once per session: to find Claude Code's own temporary folder, `<tmp>/claude-<uid>`, where it keeps your pasted images and where ImageMagick leaves its PNG copies. macOS is told from Linux by a file only macOS has, with no program.
- To copy an image: `osascript` on macOS, run directly. On Linux, `sh -c` with one fixed script, because `wl-copy` reads the picture on its standard input: the script hands it the file (or runs `xclip` on X11), the path passed as an argument, never part of the script.
- Your opener, when you press open: `open` on macOS, `setsid -f xdg-open` on Linux so the viewer outlives the call, or the command you set.

**The exact commands.** Every program darkroom can run, as it runs it: `<image>` is the absolute path of the image, `<png>` the image itself or its PNG copy, `<id>` a hash of the path and its date, `W`×`H` the size of the pixel grid. The path is always one argument of its own, never part of a script:

```sh
# once per session
id -u
magick -version                  # or, without ImageMagick 7: convert -version

# a JPEG, GIF, WebP, AVIF, SVG, BMP or TIFF image, with MAGICK_CONFIGURE_PATH=<plugin>/magick
# (JPEG: stands for the decoder the extension names; ImageMagick 6 runs convert and identify)
magick identify -format '%w %h %m' 'JPEG:<image>[0]'
magick 'JPEG:<image>[0]' -resize '2048x2048>' 'PNG:<tmp>/claude-<uid>/darkroom-<id>.png'
magick 'JPEG:<image>[0]' -background '#141414' -flatten -resize 'WxH!' -depth 8 -compress none ppm:-

# copy image, on macOS
osascript -e 'on run argv' -e 'set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)' -e 'end run' '<png>'
# copy image, on Linux
sh -c '{ if [ -n "$WAYLAND_DISPLAY" ] && command -v wl-copy; then wl-copy --type image/png <"$1"; elif command -v xclip; then xclip -selection clipboard -t image/png -i "$1"; else exit 3; fi; } >/dev/null 2>&1' darkroom '<png>'

# open, on macOS; an opener you set runs in place of open
open '<image>'
# open, on Linux; an opener you set runs in place of xdg-open
setsid -f xdg-open '<image>'
```

**Hooks it uses, and what they do.**

- `tool.call` reads each call's arguments, and the output of commands and MCP tools, for the image paths the call worked on. It never changes or answers a call.
- `prompt.edit` reads your draft for `[Image #N]` markers only, to paint them amber and show their pictures.
- `prompt.submit` clears the pasted thumbnails and closes the open viewers. Your prompt passes on unchanged.
- `command.run` answers `/darkroom` and nothing else.
- `ui.render` and `ui.message` draw the rows and take the clicks, hover and keys over them.

**What it reads and writes.** It reads the images a tool call names, your pasted images, and these variables: `TERM`, `TERM_PROGRAM`, `KITTY_WINDOW_ID`, `GHOSTTY_RESOURCES_DIR`, `TMUX`, `SSH_CONNECTION`, `HOME`, `TMPDIR`. darkroom itself writes no file: it keeps a small pixel grid per image in the session's state and your settings in its store. Only ImageMagick writes, for a non-PNG image: its PNG copy, in Claude Code's own temporary folder, which only you can read.

**The tests.** `tests/` stand in for Claude Code: they answer `process.run`, `tool.call`, the store and the rest, and call `tool.call`, `command.run` and `prompt.submit` the way Claude Code does, to check how the mod reacts. The mod itself makes none of those calls. `demo/make-images.sh` draws the screenshot images with ImageMagick.

<details>
<summary><b>Limits</b></summary>

- A mod sees no click on the other rows of the chat. A viewer closes on a click beside its picture, when another viewer opens, and when you send a prompt.
- A path with a space in it is not picked up. A relative path is resolved against the session's folder.
- Pasted images are read from the folder the engine keeps them in (`<tmp>/claude-<uid>/<project>/<session>/images/`), which no API names.
- In an expanded tool group (ctrl+o) the rows show no line; the folded group and standalone results do.
- Images over 64 megapixels or 64 MB are left out, and a PNG over 4 MB goes to ImageMagick. Treat untrusted image files as you would in any viewer.

</details>

## Develop

```
claude --plugin-dir .          # a session with this checkout loaded; it reloads as you save
claude plugin validate .
claude plugin test .
demo/make-images.sh            # the prints the screenshots show
```

## License

MIT
