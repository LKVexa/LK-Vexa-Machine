# Command catalog — 2.2.2

Generated from the active registry: 61 commands. These operate inside the virtual environment, not a host shell. Aliases may add entry names. Subcommands are described by `man hpu`, `man image`, etc.

| Command | Action | Usage |
|---|---|---|
| `help` | list available commands | help [command] |
| `man` | display the manual for a command | man command |
| `about` | show the HERMIT / SPIRAL architecture | about |
| `clear` | clear the terminal screen | clear |
| `history` | show the command history | history [-c] |
| `env` | print the environment | env |
| `export` | set an environment variable | export NAME[=value] ... |
| `unset` | remove an environment variable | unset NAME ... |
| `alias` | define or list command aliases | alias [name=value ...] |
| `unalias` | remove an alias | unalias name ... |
| `which` | locate a command | which name ... |
| `whoami` | print the current user | whoami |
| `uname` | print system information | uname [-a] |
| `date` | print the current date and time | date |
| `sysinfo` | terminal runtime status | sysinfo |
| `exit` | close the session | exit [code] |
| `pwd` | print working directory | pwd |
| `cd` | change the working directory | cd [dir] |
| `ls` | list directory contents | ls [-l] [-a] [-h] [path...] |
| `tree` | list contents recursively as a tree | tree [path] |
| `find` | search for files by name | find [path] [-name PATTERN] [-type f\|d] |
| `mkdir` | make directories | mkdir [-p] dir... |
| `rmdir` | remove empty directories | rmdir dir... |
| `rm` | remove files or directories | rm [-r] [-f] path... |
| `touch` | create empty files / update mtime | touch file... |
| `cp` | copy files | cp src dst |
| `mv` | move or rename files | mv src dst |
| `stat` | display file status | stat file... |
| `write` | write text into a file (write FILE text...) | write [-a] FILE text... |
| `echo` | write arguments to standard output | echo [-n] [-e] [args...] |
| `printf` | format and print data | printf FORMAT [args...] |
| `cat` | concatenate files and print | cat [-n] [file...] |
| `head` | output the first part of files | head [-n count] [file...] |
| `tail` | output the last part of files | tail [-n count] [file...] |
| `wc` | count lines, words and bytes | wc [-l] [-w] [-c] [file...] |
| `grep` | search for a pattern | grep [-i] [-v] [-n] [-c] PATTERN [file...] |
| `sort` | sort lines of text | sort [-r] [-n] [-u] [file...] |
| `uniq` | report or omit repeated adjacent lines | uniq [-c] [file...] |
| `rev` | reverse characters of each line | rev [file...] |
| `tr` | translate or delete characters | tr [-d] SET1 [SET2] |
| `seq` | print a sequence of numbers | seq [first [incr]] last |
| `true` | do nothing, successfully | true |
| `false` | do nothing, unsuccessfully | false |
| `sleep` | delay for a number of seconds | sleep SECONDS |
| `browser` | control the embedded browser pane | browser <open\|go\|close\|info> [url] |
| `open` | open a URL in the browser pane | open <url> |
| `memstat` | show the volume and page-cache ledger | memstat |
| `image` | compare content against the factory seed (not a signature) | image [verify] |
| `disk` | show the virtual volume volume this server is mounted from | disk |
| `mount` | show the only filesystem mount | mount |
| `cxl` | show this server's memory window as hot and warm tiers | cxl [status] |
| `df` | fabric roster stored on the virtual volume | df [status\|nodes\|where] |
| `fabric` | render the federation on this volume | fabric [status\|topology] |
| `node` | inspect one fabric node on the volume | node <small\|medium\|large\|xlarge> [status] |
| `link` | show the virtual websocket this terminal is attached to | link |
| `poweroff` | flush the virtual volume and cut power | poweroff |
| `reboot` | flush the virtual volume and remount it | reboot |
| `hpu` | run the software TIFF/GIF field and byte-lane simulator | hpu [pattern\|prop\|gs\|gate\|cycle\|diffuse\|bit\|tiff\|gif\|reset] |
| `sync` | flush and verify the IndexedDB write transaction | sync |
| `xpuinfo` | show actual execution backend and simulation limits | xpuinfo |
| `russl` | capture, inspect, edit and explicitly apply corpus-mapped TIFF pixel fields | russl info / capture / verify / hash / get / set / apply / import / inspect / index / inverse / distance / layout |

## RUSSL pixel actions

`russl layout` prints axes, strides and placement. `russl index 0 0 0 0 0` and
`russl inverse 0` convert addresses; `russl distance 0 8` evaluates only the optional
2-adic ordinal metric. `russl get c4 c5 c6 c7 c8` reads the current staged TIFF.
`russl set c4 c5 c6 c7 c8 value` edits real/imaginary sites with explicit Float32
rounding and recomputes derivatives. Direct intensity/phase edits are rejected.

`russl capture` stages the live HPU; `russl verify` validates it; `russl hash` reports
file/sample/logical SHA-256 identities. `russl apply` explicitly changes the live
HPU and resets its spool, recordings, byte lanes/counters and derived caches.
Keep a full backup first. `russl import /virtual/path.tif` validates and stages a
supported atlas from the virtual filesystem; this is not a Windows file path.
The GUI's file picker handles explicitly selected local files. `russl inspect
/virtual/path.tif` describes a TIFF within the generic bounded scalar subset
without applying it. No image metadata is executed.
