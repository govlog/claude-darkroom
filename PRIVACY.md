# Privacy policy

darkroom is a mod for Claude Code. It runs on your computer, inside Claude Code, and nowhere else.

**It collects nothing.** darkroom has no server, no account, no analytics and no telemetry. It makes no network call. It sends no data to its author or to anyone else.

**What it reads**

- The image files that a tool call of your session reads, writes or makes, the ones Claude passes to darkroom's `show` tool, and the images you paste.
- The text of tool calls (their arguments, and the output of commands and MCP tools) and your draft prompt, only to find image paths and `[Image #N]` markers in them. This text goes no further than darkroom: not to a program, not to Claude, not to the network.
- No environment variable.

**What it keeps**

- A small pixel grid of each image, in the session's state in Claude Code.
- Your darkroom settings, in the plugin's store in Claude Code, until you change them.
- For an image that is not a PNG, ImageMagick writes a PNG copy into Claude Code's own temporary folder, which only you can read.

**What Claude gets back.** From the `show` tool, the names of the images it shows and of the ones it skips, with why. Never their pixels or their content.

**What it gives to other programs.** Only what you ask for: the image or its path to your clipboard when you copy it, the image path to your viewer when you open it. ImageMagick, when installed, gets the path of each image that is not a PNG, to convert it on your machine.

The programs darkroom runs, and the exact commands, are in the README, under [Privacy and security](README.md#privacy-and-security).

**Changes and questions.** The history of this file shows every change. For a question, open an issue on the darkroom repository.
